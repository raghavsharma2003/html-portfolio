"""Private MOSS-TTS Local v1.5 Hindi/Hinglish/English evaluation runtime."""

from __future__ import annotations

import asyncio
import base64
import json
import math
import os
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import numpy as np
import perth
import torch
import torchaudio
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from transformers import AutoModel, AutoProcessor

from contract import (
    PATH,
    ServiceError,
    canonical,
    decode_secret,
    response_signature,
    sha256,
    validate_payload,
    verify_transport,
)


MODEL_REPO = "OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5"
MODEL_REVISION = "be7766a6735b98bd793f7c79fb720b4d0f5d13b8"
CODEC_REPO = "OpenMOSS-Team/MOSS-Audio-Tokenizer-v2"
CODEC_REVISION = "f6e20e543b33d2c252a7ef71bdf8aa71e5ff9169"
SOURCE_COMMIT = "58b20a0d5fcc6766658d50967a90a9d890009a46"
MODEL_ROOT = Path(os.getenv("MOSS_TTS_MODEL_ROOT", "/models/moss-tts-local-v1.5"))
CODEC_ROOT = Path(os.getenv("MOSS_TTS_CODEC_ROOT", "/models/moss-audio-tokenizer-v2"))
MODEL_SAMPLE_RATE = 48_000
DELIVERY_SAMPLE_RATE = 24_000
MIN_GPU_MEMORY_BYTES = 22 * 1024**3
MAX_OUTPUT_BYTES = 16 * 1024 * 1024


def _signed_response(request: Request, status: int, payload: dict[str, Any]) -> Response:
    body = canonical(payload)
    nonce = request.headers.get("x-vyakti-nonce", "")
    response = Response(status_code=status, content=body, media_type="application/json")
    response.headers["X-Vyakti-Response-Signature"] = response_signature(
        app.state.transport_secret, request.url.path, nonce, status, sha256(body)
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def _model_manifest() -> dict[str, Any]:
    path = MODEL_ROOT / ".vyakti-model-manifest.json"
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("moss_tts_model_manifest_required") from exc
    expected = {
        "contract": "vyakti-moss-tts-model-manifest/v1",
        "model_repo": MODEL_REPO,
        "model_revision": MODEL_REVISION,
        "codec_repo": CODEC_REPO,
        "codec_revision": CODEC_REVISION,
        "source_commit": SOURCE_COMMIT,
        "license": "Apache-2.0",
    }
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise RuntimeError("moss_tts_model_manifest_mismatch")
    if not isinstance(manifest.get("commitment"), str) or len(manifest["commitment"]) != 64:
        raise RuntimeError("moss_tts_model_commitment_invalid")
    if not isinstance(manifest.get("files"), list) or len(manifest["files"]) < 20:
        raise RuntimeError("moss_tts_model_manifest_incomplete")
    return manifest


def _transport_secret() -> bytes:
    secret_file = os.getenv("MOSS_TTS_HMAC_SECRET_FILE", "").strip()
    if secret_file:
        try:
            return decode_secret(Path(secret_file).read_text(encoding="utf-8").strip())
        except OSError as exc:
            raise RuntimeError("moss_tts_hmac_secret_file_unreadable") from exc
    return decode_secret(os.getenv("MOSS_TTS_HMAC_SECRET", ""))


async def _verified_payload(request: Request) -> dict[str, Any]:
    body = await request.body()
    nonce = verify_transport(app.state.transport_secret, request.method, request.url.path, request.headers, body)
    cutoff = time.time() - 60
    for seen_nonce, seen_at in tuple(app.state.seen_nonces.items()):
        if seen_at < cutoff:
            app.state.seen_nonces.pop(seen_nonce, None)
    if nonce in app.state.seen_nonces:
        raise ServiceError("transport_replay_denied", 409)
    app.state.seen_nonces[nonce] = time.time()
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ServiceError("request_json_invalid") from exc
    return validate_payload(payload)


def _delivery_waveform(value: Any) -> tuple[np.ndarray, int]:
    tensor = torch.as_tensor(value).detach().cpu().to(torch.float32)
    if tensor.ndim == 1:
        tensor = tensor.unsqueeze(0)
    elif tensor.ndim != 2:
        raise ServiceError("moss_tts_audio_invalid", 503)
    if tensor.shape[0] not in (1, 2) and tensor.shape[1] in (1, 2):
        tensor = tensor.transpose(0, 1)
    if tensor.shape[0] not in (1, 2) or not torch.isfinite(tensor).all():
        raise ServiceError("moss_tts_audio_invalid", 503)
    source_channels = int(tensor.shape[0])
    mono = tensor.mean(dim=0, keepdim=True)
    delivered = torchaudio.functional.resample(mono, MODEL_SAMPLE_RATE, DELIVERY_SAMPLE_RATE).squeeze(0).numpy()
    duration_ms = round(delivered.size * 1000 / DELIVERY_SAMPLE_RATE)
    peak = float(np.max(np.abs(delivered))) if delivered.size else 0.0
    rms = float(np.sqrt(np.mean(np.square(delivered)))) if delivered.size else 0.0
    if duration_ms < 500 or duration_ms > 120_000 or peak > 1.05 or rms < 0.00001:
        raise ServiceError("moss_tts_audio_invalid", 503)
    return np.clip(delivered, -1.0, 1.0), source_channels


def _decoded_audio(outputs: Any) -> Any:
    messages = app.state.processor.decode(outputs)
    for message in messages:
        audio_list = getattr(message, "audio_codes_list", None) if message is not None else None
        if audio_list:
            return audio_list[0]
    raise ServiceError("moss_tts_audio_missing", 503)


def _synthesize_sync(value: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    torch.manual_seed(value["seed"])
    np.random.seed(value["seed"])
    torch.cuda.manual_seed_all(value["seed"])
    with tempfile.NamedTemporaryFile(suffix=".wav") as reference_file:
        reference_file.write(value["reference"].audio)
        reference_file.flush()
        conversation = [[app.state.processor.build_user_message(
            text=value["text"],
            reference=[reference_file.name],
            language=value["language_label"],
        )]]
        batch = app.state.processor(conversation, mode="generation")
        with torch.inference_mode():
            outputs = app.state.model.generate(
                input_ids=batch["input_ids"].to("cuda:0"),
                attention_mask=batch["attention_mask"].to("cuda:0"),
                max_new_tokens=app.state.generation_parameters["max_new_tokens"],
                do_sample=True,
                audio_temperature=app.state.generation_parameters["audio_temperature"],
                audio_top_p=app.state.generation_parameters["audio_top_p"],
                audio_top_k=app.state.generation_parameters["audio_top_k"],
                audio_repetition_penalty=app.state.generation_parameters["audio_repetition_penalty"],
            )
        samples, model_channels = _delivery_waveform(_decoded_audio(outputs))

    protected = np.asarray(
        app.state.perth.apply_watermark(samples, watermark=None, sample_rate=DELIVERY_SAMPLE_RATE),
        dtype=np.float32,
    ).reshape(-1)
    if protected.size != samples.size or not np.isfinite(protected).all():
        raise ServiceError("perth_watermark_application_failed", 503)
    score = float(np.mean(app.state.perth.get_watermark(protected, sample_rate=DELIVERY_SAMPLE_RATE, round=False)))
    if not math.isfinite(score) or score < app.state.perth_threshold:
        raise ServiceError("perth_watermark_verification_failed", 503)
    pcm = (np.clip(protected, -1.0, 1.0) * 32767.0).round().astype("<i2").tobytes()
    if not pcm or len(pcm) > MAX_OUTPUT_BYTES:
        raise ServiceError("moss_tts_audio_invalid", 503)
    duration_ms = round(len(pcm) / 2 * 1000 / DELIVERY_SAMPLE_RATE)
    elapsed_ms = max(1, round((time.perf_counter() - started) * 1000))
    return {
        "request_id": value["request_id"],
        "generation_id": value["generation_id"],
        "replica_id": value["replica_id"],
        "audio_base64": base64.b64encode(pcm).decode(),
        "output_sha256": sha256(pcm),
        "sample_rate": DELIVERY_SAMPLE_RATE,
        "model_sample_rate": MODEL_SAMPLE_RATE,
        "model_channels": model_channels,
        "channels": 1,
        "encoding": "pcm_s16le",
        "duration_ms": duration_ms,
        "elapsed_ms": elapsed_ms,
        "real_time_factor": round(elapsed_ms / duration_ms, 6),
        "model": "moss_tts_local_v1_5",
        "model_commitment": app.state.model_commitment,
        "model_repo": MODEL_REPO,
        "model_revision": MODEL_REVISION,
        "codec_repo": CODEC_REPO,
        "codec_revision": CODEC_REVISION,
        "source_commit": SOURCE_COMMIT,
        "license": "Apache-2.0",
        "reference_sha256": value["reference"].sha256,
        "reference_duration_ms": value["reference"].duration_ms,
        "reference_text_sha256": value["reference_text_sha256"],
        "consent_receipt_sha256": value["consent_receipt_sha256"],
        "third_party_policy_receipt_sha256": value["third_party_policy_receipt_sha256"],
        "language_id": value["language_id"],
        "language_label": value["language_label"],
        "script_mode": value["script_mode"],
        "text_sha256": value["text_sha256"],
        "spoken_disclosure": value["disclosure"],
        "clone_mode": value["clone_mode"],
        "evaluation_scope": value["evaluation_scope"],
        "identity_scope": value["identity_scope"],
        "release_eligible": value["release_eligible"],
        "generation_parameters": app.state.generation_parameters,
        "perth_watermark_verified": True,
        "perth_score": round(score, 8),
    }


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.transport_secret = _transport_secret()
    if os.getenv("MOSS_TTS_REQUIRE_CUDA", "true").lower() != "true" or not torch.cuda.is_available():
        raise RuntimeError("moss_tts_cuda_required")
    if torch.cuda.get_device_properties(0).total_memory < MIN_GPU_MEMORY_BYTES:
        raise RuntimeError("moss_tts_gpu_memory_insufficient")
    manifest = _model_manifest()
    application.state.model_commitment = manifest["commitment"]
    torch.backends.cuda.enable_cudnn_sdp(False)
    torch.backends.cuda.enable_flash_sdp(True)
    torch.backends.cuda.enable_mem_efficient_sdp(True)
    torch.backends.cuda.enable_math_sdp(True)
    application.state.processor = AutoProcessor.from_pretrained(
        str(MODEL_ROOT),
        trust_remote_code=True,
        codec_path=str(CODEC_ROOT),
        codec_weight_dtype="bf16",
        codec_attention_implementation="sdpa",
        local_files_only=True,
    )
    application.state.processor.audio_tokenizer = application.state.processor.audio_tokenizer.to("cuda:0")
    application.state.model = AutoModel.from_pretrained(
        str(MODEL_ROOT),
        trust_remote_code=True,
        attn_implementation="sdpa",
        torch_dtype=torch.bfloat16,
        local_files_only=True,
    ).to("cuda:0")
    application.state.model.eval()
    if int(application.state.processor.model_config.sampling_rate) != MODEL_SAMPLE_RATE:
        raise RuntimeError("moss_tts_model_sample_rate_invalid")
    application.state.perth = perth.PerthImplicitWatermarker(device="cuda")
    application.state.perth_threshold = float(os.getenv("MOSS_TTS_PERTH_MIN_SCORE", "0.5"))
    if not 0.5 <= application.state.perth_threshold <= 1.0:
        raise RuntimeError("moss_tts_perth_threshold_invalid")
    application.state.generation_parameters = {
        "audio_temperature": 1.7,
        "audio_top_p": 0.8,
        "audio_top_k": 25,
        "audio_repetition_penalty": 1.0,
        "max_new_tokens": 1024,
        "codec_weight_dtype": "bf16",
        "attention_implementation": "sdpa",
    }
    application.state.seen_nonces = {}
    application.state.gpu_lock = asyncio.Lock()
    application.state.ready = True
    yield
    application.state.ready = False


app = FastAPI(
    title="Vyakti MOSS-TTS v1.5 Evaluation Runtime",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


@app.get("/healthz")
async def health() -> JSONResponse:
    return JSONResponse(
        status_code=200 if getattr(app.state, "ready", False) else 503,
        content={
            "ready": bool(getattr(app.state, "ready", False)),
            "model": "moss_tts_local_v1_5",
            "model_commitment": getattr(app.state, "model_commitment", None),
            "evaluation_only": True,
        },
    )


@app.post(PATH)
async def synthesize(request: Request) -> Response:
    try:
        value = await _verified_payload(request)
        async with app.state.gpu_lock:
            result = await asyncio.to_thread(_synthesize_sync, value)
        return _signed_response(request, 200, result)
    except ServiceError as error:
        return _signed_response(request, error.status, {"error": error.code})
    except Exception as error:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        print(f"[moss-tts] synthesis_failed type={type(error).__name__}", flush=True)
        return _signed_response(request, 503, {"error": "moss_tts_synthesis_failed"})
