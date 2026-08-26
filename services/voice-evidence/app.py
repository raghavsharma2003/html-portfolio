"""Private, immutable voice-evidence extraction for adult self-replicas.

This is an evidence service, not a training or generation endpoint. It accepts
only bounded audio bytes, returns model measurements and derived candidates,
and never receives an account, replica, person, transcript, or provider ID.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import math
import os
import re
import time
import wave
from contextlib import asynccontextmanager
from typing import Any

import numpy as np
import soundfile as sf
import torch
import torchaudio
from df.enhance import enhance as df_enhance
from df.enhance import init_df
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from silero_vad import get_speech_timestamps, load_silero_vad
from speechbrain.inference.classifiers import EncoderClassifier
from speechbrain.inference.separation import SepformerSeparation


PROTOCOL = "vyakti-voice-evidence/v1"
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
SAFE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")
MAX_REQUEST_BYTES = 72 * 1024 * 1024
MAX_AUDIO_BYTES = min(48 * 1024 * 1024, max(1024 * 1024, int(os.getenv("VOICE_EVIDENCE_MAX_AUDIO_BYTES", 32 * 1024 * 1024))))
MAX_DURATION_SECONDS = min(20 * 60, max(10, int(os.getenv("VOICE_EVIDENCE_MAX_DURATION_SECONDS", 10 * 60))))
MAX_CLOCK_SKEW_SECONDS = 60
# The one rate every enrollment-grade WAV this service emits must land at.
# `api/_audio/wav.js`'s `probeEnrollmentWav` (the hard gate every enrollment
# reference passes through before synthesis) requires exactly this rate, mono,
# PCM16 -- and so does `services/open-voice-runtime/app.py`'s
# TARGET_SAMPLE_RATE and `api/_voice/contracts.js`'s VOICE_PCM_FORMAT. Those
# three cannot import each other (two languages, three deploy boundaries), so
# `scripts/check-enrollment-sample-rate.mjs` mirrors this exact line's value
# and asserts it against the other two on every `verify-release.mjs` run --
# the same "mirror it, then assert the mirrors agree" pattern
# `scripts/verify-voice.mjs` already uses for her voice name. If you change
# this number, that gate fails until you change the other two as well.
ENROLLMENT_SAMPLE_RATE = 24_000
MODEL_REVISIONS = {
    "silero-vad": "6.2.1",
    "speechbrain-ecapa": "0f99f2d0ebe89ac095bcc5903c4dd8f72b367286",
    "speechbrain-xvector": "56895a2df401be4150a159f3a1c653f00051d477",
    "speechbrain-sepformer-whamr16k": "21a5b500c6f52fddc387c5d9e5fb13ffd6f039c5",
    "deepfilternet": "deepfilternet3-49c52edc8947ae1f9bf50d81530beaf3a2c3245aeaf34b6f31ff535cd22284d2",
}


class ServiceError(Exception):
    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code = code
        self.status = status


def _secret(name: str) -> bytes:
    raw = os.getenv(name, "")
    try:
        value = bytes.fromhex(raw) if re.fullmatch(r"[0-9a-fA-F]{64,}", raw) else base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    except Exception as exc:
        raise RuntimeError(f"{name.lower()}_invalid") from exc
    if len(value) < 32:
        raise RuntimeError(f"{name.lower()}_required")
    return value


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _signature(secret: bytes, *parts: str) -> str:
    return base64.urlsafe_b64encode(hmac.new(secret, "\n".join(parts).encode(), hashlib.sha256).digest()).rstrip(b"=").decode()


def _signed_response(request: Request, status: int, payload: dict[str, Any]) -> Response:
    body = _canonical(payload)
    nonce = request.headers.get("x-vyakti-nonce", "")
    response = Response(body, status_code=status, media_type="application/json")
    response.headers["X-Vyakti-Response-Signature"] = _signature(
        app.state.transport_secret, PROTOCOL, "response", request.url.path, nonce, str(status), _sha(body)
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


async def _verified_json(request: Request) -> dict[str, Any]:
    body = await request.body()
    if not body or len(body) > MAX_REQUEST_BYTES:
        raise ServiceError("request_size_invalid", 413)
    timestamp = request.headers.get("x-vyakti-timestamp", "")
    nonce = request.headers.get("x-vyakti-nonce", "")
    body_hash = request.headers.get("x-vyakti-content-sha256", "")
    if request.headers.get("x-vyakti-protocol") != PROTOCOL or not re.fullmatch(r"[A-Za-z0-9_-]{20,64}", nonce):
        raise ServiceError("transport_binding_invalid", 401)
    try:
        from datetime import datetime
        issued_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()
    except ValueError as exc:
        raise ServiceError("transport_timestamp_invalid", 401) from exc
    expected = _signature(app.state.transport_secret, PROTOCOL, request.method, request.url.path, timestamp, nonce, body_hash)
    if abs(time.time() - issued_at) > MAX_CLOCK_SKEW_SECONDS or body_hash != _sha(body) or not hmac.compare_digest(expected, request.headers.get("x-vyakti-signature", "")):
        raise ServiceError("transport_signature_invalid", 401)
    cutoff = time.time() - MAX_CLOCK_SKEW_SECONDS
    for seen_nonce, seen_at in tuple(app.state.seen_nonces.items()):
        if seen_at < cutoff:
            app.state.seen_nonces.pop(seen_nonce, None)
    if nonce in app.state.seen_nonces:
        raise ServiceError("transport_replay_denied", 409)
    app.state.seen_nonces[nonce] = time.time()
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ServiceError("request_json_invalid") from exc
    if not isinstance(parsed, dict):
        raise ServiceError("request_json_invalid")
    return parsed


def _decode_audio(entry: dict[str, Any], target_rate: int = 16_000) -> tuple[torch.Tensor, int]:
    digest = str(entry.get("sha256", ""))
    try:
        payload = base64.b64decode(entry.get("audio_base64", ""), validate=True)
    except Exception as exc:
        raise ServiceError("audio_base64_invalid", 422) from exc
    if not payload or len(payload) > MAX_AUDIO_BYTES or not SHA_RE.fullmatch(digest) or _sha(payload) != digest:
        raise ServiceError("audio_integrity_invalid", 422)
    try:
        samples, sample_rate = sf.read(io.BytesIO(payload), dtype="float32", always_2d=True)
    except Exception as exc:
        raise ServiceError("audio_decode_failed", 422) from exc
    if sample_rate < 8_000 or sample_rate > 192_000 or samples.shape[0] == 0:
        raise ServiceError("audio_format_invalid", 422)
    waveform = torch.from_numpy(samples.mean(axis=1)).float()
    if waveform.numel() / sample_rate > MAX_DURATION_SECONDS:
        raise ServiceError("audio_duration_invalid", 422)
    if not torch.isfinite(waveform).all():
        raise ServiceError("audio_samples_invalid", 422)
    peak = waveform.abs().max().item()
    if peak > 1.1:
        raise ServiceError("audio_samples_invalid", 422)
    if sample_rate != target_rate:
        waveform = torchaudio.functional.resample(waveform, sample_rate, target_rate)
    return waveform.contiguous(), target_rate


def _wav_bytes(waveform: torch.Tensor, sample_rate: int) -> bytes:
    samples = (waveform.detach().cpu().flatten().clamp(-1, 1).numpy() * 32767).round().astype("<i2").tobytes()
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(sample_rate)
        target.writeframes(samples)
    return output.getvalue()


def _embedding(model: EncoderClassifier, waveform: torch.Tensor) -> list[float]:
    if waveform.numel() < 16_000:
        waveform = torch.nn.functional.pad(waveform, (0, 16_000 - waveform.numel()))
    with torch.inference_mode():
        vector = model.encode_batch(waveform.unsqueeze(0).to(app.state.device), normalize=True).detach().cpu().reshape(-1)
    norm = vector.norm().item()
    if not math.isfinite(norm) or norm < 1e-8:
        raise ServiceError("speaker_embedding_invalid", 503)
    return [round(float(value), 8) for value in (vector / norm).tolist()]


def _cosine(left: list[float], right: list[float]) -> float:
    return float(np.dot(np.asarray(left), np.asarray(right)))


def _diarize(payload: dict[str, Any]) -> dict[str, Any]:
    inputs = payload.get("inputs")
    if not isinstance(inputs, list) or len(inputs) != 1:
        raise ServiceError("diarization_input_invalid", 422)
    waveform, rate = _decode_audio(inputs[0])
    timestamps = get_speech_timestamps(
        waveform, app.state.vad, sampling_rate=rate, threshold=0.5,
        min_speech_duration_ms=350, min_silence_duration_ms=180, speech_pad_ms=80,
    )
    if not timestamps:
        raise ServiceError("no_speech_detected", 422)
    chunks: list[dict[str, Any]] = []
    for span in timestamps:
        start, end = int(span["start"]), int(span["end"])
        for offset in range(start, end, rate * 8):
            chunk_end = min(end, offset + rate * 8)
            if chunk_end - offset < rate // 2:
                continue
            chunks.append({"start": offset, "end": chunk_end, "embedding": _embedding(app.state.ecapa, waveform[offset:chunk_end])})
    if not chunks:
        raise ServiceError("insufficient_speech", 422)
    centroids: list[list[float]] = []
    counts: list[int] = []
    for chunk in chunks:
        similarities = [_cosine(chunk["embedding"], centroid) for centroid in centroids]
        best = int(np.argmax(similarities)) if similarities else -1
        if best < 0 or similarities[best] < app.state.cluster_threshold or len(centroids) < 1:
            if len(centroids) < app.state.max_speakers:
                centroids.append(chunk["embedding"])
                counts.append(1)
                chunk["speaker"] = len(centroids) - 1
                continue
        if best < 0:
            best = 0
        chunk["speaker"] = best
        counts[best] += 1
        updated = np.asarray(centroids[best]) * (counts[best] - 1) + np.asarray(chunk["embedding"])
        updated /= max(np.linalg.norm(updated), 1e-8)
        centroids[best] = updated.tolist()
    segments = []
    for chunk in chunks:
        similarity = _cosine(chunk["embedding"], centroids[chunk["speaker"]])
        segments.append({
            "start_ms": round(chunk["start"] * 1000 / rate),
            "end_ms": round(chunk["end"] * 1000 / rate),
            "speaker_key": f"cluster-{chunk['speaker'] + 1}",
            "confidence": round(max(0.0, min(1.0, (similarity + 1) / 2)), 6),
            # No target anchor is available in source processing. A human must
            # identify the subject cluster; pretending otherwise would poison identity.
            "target_likelihood": 0.5,
            "overlap": False,
        })
    return {"segments": segments, "target_anchor_used": False, "overlap_detector": "not_available", "model_revisions": MODEL_REVISIONS}


def _separate(payload: dict[str, Any]) -> dict[str, Any]:
    inputs = payload.get("inputs")
    if not isinstance(inputs, list) or len(inputs) != 1:
        raise ServiceError("separation_input_invalid", 422)
    waveform, rate = _decode_audio(inputs[0])
    with torch.inference_mode():
        estimate = app.state.separator.separate_batch(waveform.unsqueeze(0).to(app.state.device)).detach().cpu()
    if estimate.ndim != 3:
        raise ServiceError("separation_output_invalid", 503)
    if estimate.shape[1] < estimate.shape[2]:
        estimate = estimate.transpose(1, 2)
    candidates = []
    for index in range(min(2, estimate.shape[2])):
        audio = _wav_bytes(estimate[0, :, index], rate)
        candidates.append({
            "variant_key": f"speaker-{index + 1}", "audio_base64": base64.b64encode(audio).decode(),
            "sha256": _sha(audio), "mime": "audio/wav", "duration_ms": round(estimate.shape[1] * 1000 / rate),
            "input_sha256": inputs[0]["sha256"], "transform_name": "sepformer-whamr16k",
            "transform_version": MODEL_REVISIONS["speechbrain-sepformer-whamr16k"],
            "parameters": {"speakers": 2, "sample_rate": rate}, "quality": {"subject_selection_required": True},
        })
    if len(candidates) != 2:
        raise ServiceError("separation_output_invalid", 503)
    return {"candidates": candidates, "model_revisions": MODEL_REVISIONS}


def _enhance(payload: dict[str, Any]) -> dict[str, Any]:
    inputs = payload.get("inputs")
    if not isinstance(inputs, list) or not 1 <= len(inputs) <= 4:
        raise ServiceError("enhancement_input_invalid", 422)
    candidates = []
    for input_index, entry in enumerate(inputs):
        # DeepFilterNet3 is trained at 48 kHz and only ever runs at 48 kHz --
        # that is not a choice this function makes, it is the model's own
        # native rate, so decoding and enhancing both stay at 48_000.
        waveform, _ = _decode_audio(entry, target_rate=48_000)
        source = waveform.unsqueeze(0)
        for variant, attenuation in (("identity-preserving", 12.0), ("noise-suppressing", None)):
            with torch.inference_mode():
                enhanced = df_enhance(app.state.df_model, app.state.df_state, source, atten_lim_db=attenuation)
            # The WAV this function EMITS is a different question from the rate
            # DeepFilterNet runs at, and the two used to be silently conflated:
            # every enhance artifact shipped at the model's native 48 kHz, while
            # every consumer that turns an enrollment reference into synthesised
            # audio -- `probeEnrollmentWav` (called from the Chatterbox preview
            # provider, the Personal Voice provider and Mirror Call's own
            # conditioning probe) -- has always hard-required 24 kHz mono PCM16
            # and rejected anything else with `wav_format_unsupported`. Nothing
            # in this file ever produced that rate, so every "Preview my voice"
            # call was destined to fail the moment a real enhance artifact
            # reached it. Resampling here, once, with a proper anti-aliasing
            # filter (`torchaudio.functional.resample`, the same function this
            # module already uses in `_decode_audio` for every other rate
            # conversion) is the fix: it happens exactly once, server-side,
            # right after the highest-fidelity signal DeepFilterNet produces,
            # rather than as a second, hand-rolled decimation bolted onto the
            # Vercel API layer with no anti-aliasing filter, which would
            # degrade the voice silently on every single preview.
            resampled = torchaudio.functional.resample(enhanced.squeeze(0), 48_000, ENROLLMENT_SAMPLE_RATE)
            audio = _wav_bytes(resampled, ENROLLMENT_SAMPLE_RATE)
            candidates.append({
                "variant_key": f"input-{input_index + 1}-{variant}", "audio_base64": base64.b64encode(audio).decode(),
                "sha256": _sha(audio), "mime": "audio/wav",
                "duration_ms": round(resampled.numel() * 1000 / ENROLLMENT_SAMPLE_RATE),
                "input_sha256": entry["sha256"], "transform_name": "deepfilternet3",
                "transform_version": MODEL_REVISIONS["deepfilternet"],
                "parameters": {"attenuation_limit_db": attenuation, "sample_rate": ENROLLMENT_SAMPLE_RATE,
                                "enhancement_sample_rate": 48_000},
                "quality": {"identity_preservation_candidate": attenuation is not None},
            })
    return {"candidates": candidates, "model_revisions": MODEL_REVISIONS}


def _signal_quality(waveform: torch.Tensor, rate: int) -> dict[str, Any]:
    absolute = waveform.abs()
    rms = float(torch.sqrt(torch.mean(waveform.square()) + 1e-12))
    clipping = float((absolute >= 0.999).float().mean())
    timestamps = get_speech_timestamps(waveform, app.state.vad, sampling_rate=rate)
    speech_samples = sum(int(item["end"]) - int(item["start"]) for item in timestamps)
    nonspeech_parts = []
    cursor = 0
    for item in timestamps:
        start, end = int(item["start"]), int(item["end"])
        if start > cursor:
            nonspeech_parts.append(waveform[cursor:start])
        cursor = max(cursor, end)
    if cursor < waveform.numel():
        nonspeech_parts.append(waveform[cursor:])
    nonspeech = torch.cat(nonspeech_parts) if nonspeech_parts else torch.empty(0)
    noise_rms = float(torch.sqrt(torch.mean(nonspeech.square()) + 1e-12)) if nonspeech.numel() else 1e-6
    return {
        "duration_ms": round(waveform.numel() * 1000 / rate), "usable_speech_ms": round(speech_samples * 1000 / rate),
        "voiced_ratio": round(speech_samples / max(1, waveform.numel()), 8), "rms_dbfs": round(20 * math.log10(max(rms, 1e-8)), 6),
        "estimated_snr_db": round(20 * math.log10(max(rms, 1e-8) / max(noise_rms, 1e-8)), 6),
        "clipping_ratio": round(clipping, 8),
    }


def _measure(payload: dict[str, Any]) -> dict[str, Any]:
    inputs = payload.get("inputs")
    if not isinstance(inputs, list) or not 1 <= len(inputs) <= 4:
        raise ServiceError("voice_quality_input_invalid", 422)
    embeddings, per_input = [], []
    for entry in inputs:
        waveform, rate = _decode_audio(entry)
        signal_quality = _signal_quality(waveform, rate)
        speech_ms = signal_quality["usable_speech_ms"]
        confidence = round(max(0.0, min(1.0, speech_ms / 10_000)), 6)
        input_key = str(entry.get("input_key", ""))
        if not SAFE_ID_RE.fullmatch(input_key):
            raise ServiceError("voice_quality_input_key_invalid", 422)
        lineage = {"input_key": input_key}
        embeddings.extend([
            {**lineage, "family": "speechbrain-ecapa-voxceleb", "vector": _embedding(app.state.ecapa, waveform), "confidence": confidence},
            {**lineage, "family": "speechbrain-xvector-voxceleb", "vector": _embedding(app.state.xvector, waveform), "confidence": confidence},
        ])
        per_input.append({"input_key": input_key, **signal_quality})
    confidence = min(item["confidence"] for item in embeddings)
    return {
        "embeddings": embeddings, "confidence": confidence,
        "measurements": {"per_input": per_input, "speaker_identity_families": 2, "behavioral_prosody_requires_transcript_alignment": True},
        "quality": {"per_input": per_input, "held_out_cross_source_calibration_required": True},
        "model_revisions": MODEL_REVISIONS,
    }


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.transport_secret = _secret("AZURE_VOICE_EVIDENCE_HMAC_SECRET")
    application.state.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if os.getenv("VOICE_EVIDENCE_REQUIRE_CUDA", "true").lower() != "false" and application.state.device.type != "cuda":
        raise RuntimeError("voice_evidence_cuda_required")
    root = os.getenv("VOICE_EVIDENCE_MODEL_ROOT", "/models/voice-evidence")
    run_opts = {"device": str(application.state.device)}
    # Both speaker-embedding hyperparams.yaml files hard-code
    # `pretrained_path` to their Hugging Face repo id, and their Pretrainer
    # resolves every checkpoint against that variable rather than against
    # `source`. Pointing `source` at the baked-in directory is therefore not
    # enough: without this override SpeechBrain still reaches for
    # huggingface.co and dies under HF_HUB_OFFLINE=1. Sepformer needs no
    # override -- its Pretrainer declares no `paths:` block, so it already
    # resolves relative to `source`.
    application.state.ecapa = EncoderClassifier.from_hparams(
        source=f"{root}/ecapa", run_opts=run_opts,
        overrides={"pretrained_path": f"{root}/ecapa"})
    application.state.xvector = EncoderClassifier.from_hparams(
        source=f"{root}/xvector", run_opts=run_opts,
        overrides={"pretrained_path": f"{root}/xvector"})
    application.state.separator = SepformerSeparation.from_hparams(source=f"{root}/sepformer", run_opts=run_opts)
    application.state.vad = load_silero_vad(onnx=False)
    deepfilter_root = f"{root}/deepfilter/DeepFilterNet3"
    application.state.df_model, application.state.df_state, _ = init_df(model_base_dir=deepfilter_root, log_level="ERROR")[:3]
    application.state.max_speakers = min(8, max(1, int(os.getenv("VOICE_EVIDENCE_MAX_SPEAKERS", "4"))))
    application.state.cluster_threshold = float(os.getenv("VOICE_EVIDENCE_CLUSTER_COSINE_THRESHOLD", "0.68"))
    if not 0.4 <= application.state.cluster_threshold <= 0.9:
        raise RuntimeError("voice_evidence_cluster_threshold_invalid")
    application.state.seen_nonces = {}
    application.state.ready = True
    yield
    application.state.ready = False


app = FastAPI(title="Vyakti Voice Evidence", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.get("/healthz")
async def health() -> JSONResponse:
    return JSONResponse(status_code=200 if getattr(app.state, "ready", False) else 503, content={"ready": bool(getattr(app.state, "ready", False)), "model_revisions": MODEL_REVISIONS})


@app.post("/v1/analyze")
async def analyze(request: Request) -> Response:
    try:
        payload = await _verified_json(request)
        operation = payload.get("operation")
        if operation not in {"diarize", "separate", "enhance", "voice_quality"}:
            raise ServiceError("operation_denied", 403)
        handler = {"diarize": _diarize, "separate": _separate, "enhance": _enhance, "voice_quality": _measure}[operation]
        return _signed_response(request, 200, handler(payload))
    except ServiceError as error:
        return _signed_response(request, error.status, {"error": error.code})
    except Exception:
        return _signed_response(request, 503, {"error": "voice_evidence_failed"})
