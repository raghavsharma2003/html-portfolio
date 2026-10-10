"""Private, watermarked Qwen3-TTS 1.7B English evaluation runtime."""

from __future__ import annotations

import asyncio
import base64
import io
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
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from qwen_tts import Qwen3TTSModel

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


MODEL_REPO = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
MODEL_REVISION = "fd4b254389122332181a7c3db7f27e918eec64e3"
SOURCE_COMMIT = "022e286b98fbec7e1e916cb940cdf532cd9f488e"
MODEL_ROOT = Path(os.getenv("QWEN3_TTS_MODEL_ROOT", "/models/qwen3-tts-1.7b-base"))
TARGET_SAMPLE_RATE = 24_000
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
        raise RuntimeError("qwen3_model_manifest_required") from exc
    expected = {
        "contract": "vyakti-qwen3-tts-model-manifest/v1",
        "model_repo": MODEL_REPO,
        "model_revision": MODEL_REVISION,
        "source_commit": SOURCE_COMMIT,
    }
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise RuntimeError("qwen3_model_manifest_mismatch")
    if not isinstance(manifest.get("commitment"), str) or len(manifest["commitment"]) != 64:
        raise RuntimeError("qwen3_model_commitment_invalid")
    return manifest


async def _verified_payload(request: Request) -> dict[str, Any]:
    body = await request.body()
    nonce = verify_transport(
        app.state.transport_secret, request.method, request.url.path, request.headers, body
    )
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


def _waveform(value: Any, sample_rate: int) -> np.ndarray:
    if sample_rate != TARGET_SAMPLE_RATE:
        raise ServiceError("qwen3_sample_rate_invalid", 503)
    if isinstance(value, torch.Tensor):
        value = value.detach().to(dtype=torch.float32, device="cpu").numpy()
    samples = np.asarray(value, dtype=np.float32).reshape(-1)
    if not samples.size or not np.isfinite(samples).all():
        raise ServiceError("qwen3_audio_invalid", 503)
    duration_ms = round(samples.size * 1000 / sample_rate)
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(np.square(samples))))
    if duration_ms < 500 or duration_ms > 120_000 or peak > 1.05 or rms < 0.00001:
        raise ServiceError("qwen3_audio_invalid", 503)
    return np.clip(samples, -1.0, 1.0)


def _synthesize_sync(value: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    torch.manual_seed(value["seed"])
    np.random.seed(value["seed"])
    torch.cuda.manual_seed_all(value["seed"])
    with tempfile.NamedTemporaryFile(suffix=".wav") as reference_file:
        reference_file.write(value["reference"].audio)
        reference_file.flush()
        with torch.inference_mode():
            wavs, sample_rate = app.state.model.generate_voice_clone(
                text=value["text"],
                language="English",
                ref_audio=reference_file.name,
                ref_text=value["reference_text"],
                x_vector_only_mode=False,
                non_streaming_mode=True,
                do_sample=True,
                top_k=50,
                top_p=1.0,
                temperature=0.9,
                repetition_penalty=1.05,
                subtalker_dosample=True,
                subtalker_top_k=50,
                subtalker_top_p=1.0,
                subtalker_temperature=0.9,
                max_new_tokens=2_048,
            )
    if not isinstance(wavs, list) or len(wavs) != 1:
        raise ServiceError("qwen3_audio_invalid", 503)
    samples = _waveform(wavs[0], int(sample_rate))
    protected = np.asarray(
        app.state.perth.apply_watermark(samples, watermark=None, sample_rate=TARGET_SAMPLE_RATE),
        dtype=np.float32,
    ).reshape(-1)
    if protected.size != samples.size or not np.isfinite(protected).all():
        raise ServiceError("perth_watermark_application_failed", 503)
    score = float(np.mean(app.state.perth.get_watermark(protected, sample_rate=TARGET_SAMPLE_RATE, round=False)))
    if not math.isfinite(score) or score < app.state.perth_threshold:
        raise ServiceError("perth_watermark_verification_failed", 503)
    pcm = (np.clip(protected, -1.0, 1.0) * 32767.0).round().astype("<i2").tobytes()
    if not pcm or len(pcm) > MAX_OUTPUT_BYTES:
        raise ServiceError("qwen3_audio_invalid", 503)
    duration_ms = round(len(pcm) / 2 * 1000 / TARGET_SAMPLE_RATE)
    elapsed_ms = max(1, round((time.perf_counter() - started) * 1000))
    return {
        "request_id": value["request_id"],
        "generation_id": value["generation_id"],
        "audio_base64": base64.b64encode(pcm).decode(),
        "output_sha256": sha256(pcm),
        "sample_rate": TARGET_SAMPLE_RATE,
        "channels": 1,
        "encoding": "pcm_s16le",
        "duration_ms": duration_ms,
        "elapsed_ms": elapsed_ms,
        "real_time_factor": round(elapsed_ms / duration_ms, 6),
        "model": "qwen3-tts-12hz-1.7b-base",
        "model_commitment": app.state.model_commitment,
        "model_repo": MODEL_REPO,
        "model_revision": MODEL_REVISION,
        "source_commit": SOURCE_COMMIT,
        "reference_sha256": value["reference"].sha256,
        "reference_duration_ms": value["reference"].duration_ms,
        "reference_text_sha256": value["reference_text_sha256"],
        "consent_receipt_sha256": value["consent_receipt_sha256"],
        "language_id": "en",
        "clone_mode": "icl",
        "generation_parameters": app.state.generation_parameters,
        "perth_watermark_verified": True,
        "perth_score": round(score, 8),
    }


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.transport_secret = decode_secret(os.getenv("QWEN3_TTS_HMAC_SECRET", ""))
    if os.getenv("QWEN3_TTS_REQUIRE_CUDA", "true").lower() != "true" or not torch.cuda.is_available():
        raise RuntimeError("qwen3_cuda_required")
    manifest = _model_manifest()
    application.state.model_commitment = manifest["commitment"]
    application.state.model = Qwen3TTSModel.from_pretrained(
        str(MODEL_ROOT),
        device_map="cuda:0",
        dtype=torch.float16,
        attn_implementation="sdpa",
        local_files_only=True,
    )
    application.state.perth = perth.PerthImplicitWatermarker(device="cuda")
    application.state.perth_threshold = float(os.getenv("QWEN3_TTS_PERTH_MIN_SCORE", "0.5"))
    if not 0.5 <= application.state.perth_threshold <= 1.0:
        raise RuntimeError("qwen3_perth_threshold_invalid")
    application.state.generation_parameters = {
        "do_sample": True,
        "top_k": 50,
        "top_p": 1.0,
        "temperature": 0.9,
        "repetition_penalty": 1.05,
        "subtalker_temperature": 0.9,
        "max_new_tokens": 2_048,
    }
    application.state.seen_nonces = {}
    application.state.gpu_lock = asyncio.Lock()
    application.state.ready = True
    yield
    application.state.ready = False


app = FastAPI(
    title="Vyakti Qwen3-TTS English Evaluation Runtime",
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
            "model": "qwen3-tts-12hz-1.7b-base",
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
        print(f"[qwen3-tts] synthesis_failed type={type(error).__name__}", flush=True)
        return _signed_response(request, 503, {"error": "qwen3_synthesis_failed"})
