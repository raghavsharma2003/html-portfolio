"""Per-speaker LoRA fine-tune of Chatterbox Multilingual V3, one speaker, one run.

Input is a single JSON bundle (fetched from a pre-signed URL): the consented
reference WAV, a list of transcribed segments, and hyperparameters. Output is
one adapter blob in the `vyakti-lora/v1` format that
`services/open-voice-runtime/lora.py` can load, plus a JSON report of what
actually happened during training.

Runs as a batch job on the same GPU workload profile as the runtime, from an
image derived from the runtime image, so the model weights, the pinned
Chatterbox commit and the LoRA implementation are literally the same bytes on
both sides.

Three things this deliberately does NOT do
------------------------------------------
1. **It does not touch `s3gen` or `ve`.** `lora.TARGET_SUFFIXES` enforces that.
   Fine-tuning the voice encoder would improve the fidelity number by fitting
   the grader, which is the one result that would be worthless.
2. **It does not synthesize anything.** It produces weights. Every claim about
   how those weights sound or score is made by the runtime and the evidence
   service, through the ordinary admission path, with the watermark verified —
   never here, where nothing is watching.
3. **It does not hold a long-lived credential.** It gets pre-signed URLs, uses
   them, and exits.

Consent
-------
The bundle must carry `consent.is_self` and `consent.has_source_rights`. This
is a backstop, not the gate — the studio's consent record is the gate — but a
training job is the last place a mis-scoped recording can be stopped before it
becomes weights, and weights cannot be un-trained.
"""

from __future__ import annotations

import base64
import json
import math
import os
import sys
import time
import urllib.request
from typing import Any

import numpy as np
import torch
import torch.nn.functional as F

sys.path.insert(0, "/srv/open-voice")

import lora  # noqa: E402  (path is set above; the runtime's own module)
from chatterbox.mtl_tts import ChatterboxMultilingualTTS, punc_norm  # noqa: E402
from chatterbox.models.s3gen import S3GEN_SR  # noqa: E402
from chatterbox.models.s3tokenizer import S3_SR  # noqa: E402

MODEL_ROOT = os.getenv("OPEN_VOICE_MODEL_ROOT", "/models/chatterbox-multilingual-v3")
MIN_SEGMENT_MS = 1_000
MAX_SEGMENT_MS = 30_000


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=600) as response:
        return response.read()


def put(url: str, body: bytes, content_type: str) -> int:
    request = urllib.request.Request(url, data=body, method="PUT", headers={
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": content_type,
        "Content-Length": str(len(body)),
    })
    with urllib.request.urlopen(request, timeout=600) as response:
        return response.status


def wav_pcm(blob: bytes) -> tuple[np.ndarray, int]:
    """Read canonical PCM16 WAV by walking the RIFF chunk list.

    Not a fixed 44-byte offset: ffmpeg writes a LIST/INFO chunk between `fmt `
    and `data`, and reading past it returns metadata as audio. That exact bug
    already produced a run of four 6-byte "reference windows" once
    (`scripts/first-clone.mjs`), so it is not a hypothetical.
    """
    if blob[:4] != b"RIFF" or blob[8:12] != b"WAVE":
        raise ValueError("bundle_reference_not_riff_wave")
    cursor, rate, data = 12, None, None
    while cursor + 8 <= len(blob):
        kind = blob[cursor:cursor + 4]
        size = int.from_bytes(blob[cursor + 4:cursor + 8], "little")
        if kind == b"fmt ":
            fmt = blob[cursor + 8:cursor + 8 + size]
            channels = int.from_bytes(fmt[2:4], "little")
            rate = int.from_bytes(fmt[4:8], "little")
            bits = int.from_bytes(fmt[14:16], "little")
            if int.from_bytes(fmt[0:2], "little") != 1 or channels != 1 or bits != 16:
                raise ValueError("bundle_reference_not_mono_pcm16")
        elif kind == b"data":
            data = blob[cursor + 8:cursor + 8 + size]
        cursor += 8 + size + (size % 2)
    if rate is None or data is None:
        raise ValueError("bundle_reference_chunks_missing")
    return np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0, rate


def resample(samples: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    if source_rate == target_rate:
        return samples
    import librosa
    return librosa.resample(samples, orig_sr=source_rate, target_sr=target_rate)


def main() -> int:
    bundle_url = os.environ["FT_BUNDLE_URL"]
    report_url = os.environ["FT_REPORT_URL"]
    # `{"<epoch>": "<url>"}`. More than one is the point: how MUCH fine-tuning
    # helps is a curve, and a GPU wake costs ~35 warm syntheses
    # (AZURE-DEPLOY-STATE.md §9), so taking one point per run would be paying
    # the expensive part of the experiment over and over to learn less.
    adapter_urls = {int(k): v for k, v in json.loads(os.environ["FT_ADAPTER_URLS"]).items()}
    if not adapter_urls:
        raise SystemExit("no_adapter_destinations")

    started = time.time()
    log("fetching bundle")
    bundle = json.loads(fetch(bundle_url))

    consent = bundle.get("consent") or {}
    if not (consent.get("is_self") is True and consent.get("has_source_rights") is True):
        raise SystemExit("consent_not_attested: refusing to train on unattested audio")

    adapter_id = str(bundle["adapter_id"])
    rank = int(bundle.get("rank", 16))
    alpha = float(bundle.get("alpha", 32.0))
    epochs = max(adapter_urls)
    learning_rate = float(bundle.get("learning_rate", 1e-4))
    text_loss_weight = float(bundle.get("text_loss_weight", 0.1))
    exaggeration = float(bundle.get("exaggeration", 0.5))
    seed = int(bundle.get("seed", 12345))

    torch.manual_seed(seed)
    np.random.seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)

    reference = base64.b64decode(bundle["reference_wav_base64"], validate=True)
    samples, rate = wav_pcm(reference)
    log(f"reference {len(samples) / rate:.1f} s @ {rate} Hz")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if os.getenv("FT_REQUIRE_CUDA", "true").lower() != "false" and device.type != "cuda":
        raise SystemExit("finetune_cuda_required")
    log(f"device {device} {torch.cuda.get_device_name(0) if device.type == 'cuda' else ''}")

    log("loading model")
    model = ChatterboxMultilingualTTS.from_local(MODEL_ROOT, device, t3_model="v3")
    t3 = model.t3

    # Conditioning is computed ONCE from the whole reference and held fixed for
    # every step. It is the same call the runtime makes per request, so what the
    # adapter learns is conditioned on exactly the vector synthesis will supply
    # — training against a different conditioning than inference uses is the
    # classic way to produce an adapter that helps on paper and not in the lane.
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".wav") as handle:
        handle.write(reference)
        handle.flush()
        model.prepare_conditionals(handle.name, exaggeration=exaggeration)
    cond = model.conds.t3
    # `prepare_conditioning` caches an embedding on the cond object the first
    # time; do it now so the cache is built outside the loop and identical
    # across steps.
    cond.cond_prompt_speech_emb = None

    language = str(bundle.get("language_id", "hi")).lower()
    hp = t3.hp
    s3_tokenizer = model.s3gen.tokenizer

    log("tokenizing segments")
    dataset: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for index, segment in enumerate(bundle["segments"]):
        text = str(segment.get("text", "")).strip()
        t0, t1 = int(segment["t0"]), int(segment["t1"])
        if not text or not MIN_SEGMENT_MS <= (t1 - t0) <= MAX_SEGMENT_MS:
            skipped.append({"index": index, "reason": "segment_bounds", "ms": t1 - t0})
            continue
        clip = samples[int(t0 / 1000 * rate):int(t1 / 1000 * rate)]
        clip16 = resample(clip, rate, S3_SR)
        tokens, lengths = s3_tokenizer.forward([clip16])
        # The S3 tokenizer returns CUDA tensors; the text side returns CPU ones.
        # Everything is normalised to CPU here and moved to the device once,
        # below, so there is exactly one place a device is chosen.
        speech = torch.atleast_2d(tokens)[0][: int(lengths[0])].to("cpu", torch.long)
        speech = torch.cat([
            torch.tensor([hp.start_speech_token], dtype=torch.long),
            speech,
            torch.tensor([hp.stop_speech_token], dtype=torch.long),
        ])
        text_tokens = model.tokenizer.text_to_tokens(punc_norm(text), language_id=language)[0].to("cpu", torch.long)
        text_tokens = torch.cat([
            torch.tensor([hp.start_text_token], dtype=torch.long),
            text_tokens,
            torch.tensor([hp.stop_text_token], dtype=torch.long),
        ])
        if speech.numel() > hp.max_speech_tokens or text_tokens.numel() > hp.max_text_tokens:
            skipped.append({"index": index, "reason": "token_budget"})
            continue
        dataset.append({
            "index": index,
            "text_tokens": text_tokens.to(device)[None],
            "speech_tokens": speech.to(device)[None],
            "ms": t1 - t0,
            "text_len": int(text_tokens.numel()),
            "speech_len": int(speech.numel()),
        })
        log(f"  segment {index}: {t1 - t0} ms, {int(text_tokens.numel())} text tok, {int(speech.numel())} speech tok")
    if not dataset:
        raise SystemExit("no_trainable_segments")
    trained_ms = sum(item["ms"] for item in dataset)
    log(f"{len(dataset)} segment(s), {trained_ms / 1000:.1f} s of speech, {len(skipped)} skipped")

    # Freeze the whole model, then inject. Freezing FIRST means a bug in the
    # injection can only produce an adapter that does nothing — never a silently
    # full fine-tuned checkpoint escaping as if it were a small adapter.
    for parameter in model.t3.parameters():
        parameter.requires_grad_(False)
    handle = lora.inject(t3, rank, alpha)
    trainable = [p for module in handle.modules.values() for p in (module.lora_a, module.lora_b)]
    for parameter in trainable:
        parameter.requires_grad_(True)
    parameter_count = sum(p.numel() for p in trainable)
    base_count = sum(p.numel() for p in model.t3.parameters())
    log(f"LoRA r={rank} alpha={alpha} on {len(handle.modules)} projections: "
        f"{parameter_count:,} trainable of {base_count:,} ({100 * parameter_count / base_count:.3f}%)")

    t3.train()
    optimizer = torch.optim.AdamW(trainable, lr=learning_rate, weight_decay=0.0, betas=(0.9, 0.95))
    total_steps = epochs * len(dataset)
    warmup = max(1, total_steps // 20)

    def lr_at(step: int) -> float:
        if step < warmup:
            return learning_rate * (step + 1) / warmup
        progress = (step - warmup) / max(1, total_steps - warmup)
        return learning_rate * 0.5 * (1 + math.cos(math.pi * progress))

    base_meta = {
        "adapter_id": adapter_id,
        "base_model": "chatterbox-multilingual-v3",
        "base_model_commitment": bundle.get("base_model_commitment", ""),
        "reference_sha256": bundle.get("reference_sha256", ""),
        "trained_speech_ms": trained_ms,
        "segments": len(dataset),
        "rank": rank,
        "alpha": alpha,
        "learning_rate": learning_rate,
        "seed": seed,
        "language_id": language,
        "exaggeration": exaggeration,
    }
    checkpoints: list[dict[str, Any]] = []

    def save(epoch: int) -> None:
        blob = lora.serialize(handle, {**base_meta, "epochs": epoch})
        digest = lora.adapter_sha256(blob)
        weights = torch.cat([p.detach().reshape(-1) for p in trainable])
        put(adapter_urls[epoch], blob, "application/octet-stream")
        checkpoints.append({
            "epoch": epoch, "adapter_sha256": digest, "adapter_bytes": len(blob),
            "adapter_weight_l2": round(float(weights.norm()), 6),
            "speech_loss": history[-1]["speech_loss"] if history else None,
        })
        log(f"  checkpoint e{epoch}: {len(blob):,} bytes sha256 {digest} |w| {float(weights.norm()):.4f}")

    log(f"training {epochs} epochs x {len(dataset)} segments = {total_steps} steps; "
        f"checkpoints at {sorted(adapter_urls)}")
    history: list[dict[str, Any]] = []
    step = 0
    order = list(range(len(dataset)))
    rng = np.random.default_rng(seed)
    for epoch in range(epochs):
        rng.shuffle(order)
        epoch_speech, epoch_text = 0.0, 0.0
        for position in order:
            item = dataset[position]
            for group in optimizer.param_groups:
                group["lr"] = lr_at(step)
            # `prepare_conditioning` MEMOISES this embedding onto the cond object
            # the first time it is None. Left cached it would be a tensor from
            # step 0's graph, reused at step 1 — a backward through a freed
            # graph. Cleared every step, it is recomputed from frozen weights,
            # which costs almost nothing and is always in the current graph.
            cond.cond_prompt_speech_emb = None
            out = t3.forward(
                t3_cond=cond,
                text_tokens=item["text_tokens"],
                text_token_lens=torch.tensor([item["text_len"]], device=device),
                speech_tokens=item["speech_tokens"],
                speech_token_lens=torch.tensor([item["speech_len"]], device=device),
                training=True,
            )
            # NEXT-token prediction, explicitly shifted. `T3.loss` upstream does
            # not shift and calls cross_entropy with (B, seq, vocab) against
            # (B, seq) — which does not even broadcast. It is not used here and
            # the loss is computed directly instead; see the README.
            speech_logits = out.speech_logits[:, :-1].transpose(1, 2)
            speech_target = item["speech_tokens"][:, 1:]
            text_logits = out.text_logits[:, :-1].transpose(1, 2)
            text_target = item["text_tokens"][:, 1:]
            loss_speech = F.cross_entropy(speech_logits, speech_target)
            loss_text = F.cross_entropy(text_logits, text_target)
            loss = loss_speech + text_loss_weight * loss_text
            if not torch.isfinite(loss):
                raise SystemExit(f"loss_not_finite at step {step}")
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            grad_norm = torch.nn.utils.clip_grad_norm_(trainable, 1.0)
            optimizer.step()
            epoch_speech += float(loss_speech)
            epoch_text += float(loss_text)
            step += 1
        row = {
            "epoch": epoch,
            "speech_loss": round(epoch_speech / len(dataset), 6),
            "text_loss": round(epoch_text / len(dataset), 6),
            "lr": round(lr_at(step - 1), 8),
            "grad_norm": round(float(grad_norm), 6),
        }
        history.append(row)
        if epoch % 5 == 0 or epoch == epochs - 1:
            log(f"  epoch {epoch:3d}  speech {row['speech_loss']:.4f}  text {row['text_loss']:.4f}  lr {row['lr']:.2e}")
        if (epoch + 1) in adapter_urls:
            save(epoch + 1)

    train_seconds = round(time.time() - started, 1)
    if len(checkpoints) != len(adapter_urls):
        raise SystemExit(f"checkpoints_missing: wrote {len(checkpoints)} of {len(adapter_urls)}")

    report = {
        "adapter_id": adapter_id,
        "checkpoints": checkpoints,
        "trainable_parameters": parameter_count,
        "base_parameters": base_count,
        "targets": sorted(handle.modules),
        "dataset": [{k: v for k, v in item.items() if k in ("index", "ms", "text_len", "speech_len")} for item in dataset],
        "skipped": skipped,
        "trained_speech_ms": trained_ms,
        "first_epoch": history[0],
        "last_epoch": history[-1],
        "history": history,
        "train_seconds": train_seconds,
        "device": torch.cuda.get_device_name(0) if device.type == "cuda" else "cpu",
        "meta": base_meta,
    }
    put(report_url, json.dumps(report, indent=2).encode(), "application/json")
    log(f"uploaded adapter and report in {train_seconds} s")
    handle.remove()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
