"""Private, owner-bound VoxCPM2 Hindi/Hinglish/English evaluation runtime."""

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
from voxcpm import VoxCPM

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


MODEL_REPO = "openbmb/VoxCPM2"
MODEL_REVISION = "32279effe8c19989596f05d353d1447f51d9e915"
SOURCE_COMMIT = "f5a1c6a6b901bc732e20f0d59a369f6829ad717a"
MODEL_ROOT = Path(os.getenv("VOXCPM2_MODEL_ROOT", "/models/voxcpm2"))
MODEL_SAMPLE_RATE = 48_000
DELIVERY_SAMPLE_RATE = 24_000
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
        raise RuntimeError("voxcpm2_model_manifest_required") from exc
    expected = {
        "contract": "vyakti-voxcpm2-model-manifest/v1",
        "model_repo": MODEL_REPO,
        "model_revision": MODEL_REVISION,
        "source_commit": SOURCE_COMMIT,
        "license": "Apache-2.0",
    }
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise RuntimeError("voxcpm2_model_manifest_mismatch")
    if not isinstance(manifest.get("commitment"), str) or len(manifest["commitment"]) != 64:
        raise RuntimeError("voxcpm2_model_commitment_invalid")
    return manifest


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


def _output_waveform(value: Any, source_rate: int) -> np.ndarray:
    if source_rate != MODEL_SAMPLE_RATE:
        raise ServiceError("voxcpm2_model_sample_rate_invalid", 503)
    samples = np.asarray(value, dtype=np.float32).reshape(-1)
    if not samples.size or not np.isfinite(samples).all():
        raise ServiceError("voxcpm2_audio_invalid", 503)
    tensor = torch.from_numpy(samples).unsqueeze(0)
    delivered = torchaudio.functional.resample(tensor, MODEL_SAMPLE_RATE, DELIVERY_SAMPLE_RATE).squeeze(0).numpy()
    duration_ms = round(delivered.size * 1000 / DELIVERY_SAMPLE_RATE)
    peak = float(np.max(np.abs(delivered)))
    rms = float(np.sqrt(np.mean(np.square(delivered))))
    if duration_ms < 500 or duration_ms > 120_000 or peak > 1.05 or rms < 0.00001:
        raise ServiceError("voxcpm2_audio_invalid", 503)
    return np.clip(delivered, -1.0, 1.0)


def _synthesize_sync(value: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    torch.manual_seed(value["seed"])
    np.random.seed(value["seed"])
    torch.cuda.manual_seed_all(value["seed"])
    with tempfile.NamedTemporaryFile(suffix=".wav") as reference_file:
        reference_file.write(value["reference"].audio)
        reference_file.flush()
        kwargs = {
            "text": value["text"],
            "reference_wav_path": reference_file.name,
            "cfg_value": app.state.generation_parameters["cfg_value"],
            "inference_timesteps": app.state.generation_parameters["inference_timesteps"],
            "retry_badcase": False,
            "seed": value["seed"],
        }
        if value["clone_mode"] == "ultimate":
            kwargs["prompt_wav_path"] = reference_file.name
            kwargs["prompt_text"] = value["reference_text"]
        with torch.inference_mode():
            wav = app.state.model.generate(**kwargs)
    samples = _output_waveform(wav, int(app.state.model.tts_model.sample_rate))
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
        raise ServiceError("voxcpm2_audio_invalid", 503)
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
        "channels": 1,
        "encoding": "pcm_s16le",
        "duration_ms": duration_ms,
        "elapsed_ms": elapsed_ms,
        "real_time_factor": round(elapsed_ms / duration_ms, 6),
        "model": "voxcpm2",
        "model_commitment": app.state.model_commitment,
        "model_repo": MODEL_REPO,
        "model_revision": MODEL_REVISION,
        "source_commit": SOURCE_COMMIT,
        "license": "Apache-2.0",
        "reference_sha256": value["reference"].sha256,
        "reference_source_sha256": value["reference_source_sha256"],
        "reference_duration_ms": value["reference"].duration_ms,
        "reference_window_start_ms": value["reference_window_start_ms"],
        "reference_window_end_ms": value["reference_window_end_ms"],
        "reference_text_sha256": value["reference_text_sha256"],
        "consent_receipt_sha256": value["consent_receipt_sha256"],
        "third_party_policy_receipt_sha256": value["third_party_policy_receipt_sha256"],
        "language_id": value["language_id"],
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
    application.state.transport_secret = decode_secret(os.getenv("VOXCPM2_HMAC_SECRET", ""))
    if os.getenv("VOXCPM2_REQUIRE_CUDA", "true").lower() != "true" or not torch.cuda.is_available():
        raise RuntimeError("voxcpm2_cuda_required")
    manifest = _model_manifest()
    application.state.model_commitment = manifest["commitment"]
    application.state.model = VoxCPM.from_pretrained(
        str(MODEL_ROOT),
        load_denoiser=False,
        local_files_only=True,
        optimize=False,
        device="cuda:0",
    )
    if int(application.state.model.tts_model.sample_rate) != MODEL_SAMPLE_RATE:
        raise RuntimeError("voxcpm2_model_sample_rate_invalid")
    application.state.perth = perth.PerthImplicitWatermarker(device="cuda")
    application.state.perth_threshold = float(os.getenv("VOXCPM2_PERTH_MIN_SCORE", "0.5"))
    if not 0.5 <= application.state.perth_threshold <= 1.0:
        raise RuntimeError("voxcpm2_perth_threshold_invalid")
    application.state.generation_parameters = {"cfg_value": 2.0, "inference_timesteps": 10, "retry_badcase": False}
    application.state.seen_nonces = {}
    application.state.gpu_lock = asyncio.Lock()
    application.state.ready = True
    yield
    application.state.ready = False


app = FastAPI(
    title="Vyakti VoxCPM2 Evaluation Runtime",
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
            "model": "voxcpm2",
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
        print(f"[voxcpm2] synthesis_failed type={type(error).__name__}", flush=True)
        return _signed_response(request, 503, {"error": "voxcpm2_synthesis_failed"})
