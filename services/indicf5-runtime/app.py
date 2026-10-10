"""Private, watermarked IndicF5 Hindi candidate for isolated owner bake-offs."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
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
from transformers import AutoModel

from contract import (
    DISCLOSURE,
    PATH,
    ServiceError,
    canonical,
    decode_secret,
    response_signature,
    script_mode,
    sha256,
    validate_payload,
    verify_transport,
)
from offline_vocoder import install_offline_vocab, install_offline_vocos
from duration_control import plan_duration
from pronunciation_normalizer import NormalizationError, normalize_pronunciation


MODEL_REPO = "ai4bharat/IndicF5"
MODEL_REVISION = "ba85abedf18dc479a447eaa0eccbd76ab78a47d5"
SOURCE_COMMIT = "13f7c4d627cc10111aea8fe9c0039462cacacdc7"
VOCODER_REVISION = "0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21"
MODEL_ROOT = Path(os.getenv("INDICF5_MODEL_ROOT", "/models/indicf5"))
VOCODER_ROOT = Path(os.getenv("INDICF5_VOCODER_ROOT", "/models/vocos"))
TARGET_SAMPLE_RATE = 24_000
PERTH_FRAME_SAMPLES = 240
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
LOGGER = logging.getLogger("vyakti.indicf5")


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
        raise RuntimeError("indicf5_model_manifest_required") from exc
    expected = {
        "contract": "vyakti-indicf5-model-manifest/v1",
        "model_repo": MODEL_REPO,
        "model_revision": MODEL_REVISION,
        "source_commit": SOURCE_COMMIT,
        "vocoder_repo": "charactr/vocos-mel-24khz",
        "vocoder_revision": VOCODER_REVISION,
    }
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise RuntimeError("indicf5_model_manifest_mismatch")
    if not isinstance(manifest.get("commitment"), str) or len(manifest["commitment"]) != 64:
        raise RuntimeError("indicf5_model_commitment_invalid")
    vocoder_files = manifest.get("vocoder_files")
    if not isinstance(vocoder_files, list) or not vocoder_files:
        raise RuntimeError("indicf5_vocoder_manifest_required")
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
    value = validate_payload(payload)
    value["_request_binding_sha256"] = sha256(body)
    return value


def _waveform(value: Any) -> np.ndarray:
    if isinstance(value, torch.Tensor):
        value = value.detach().to(dtype=torch.float32, device="cpu").numpy()
    samples = np.asarray(value)
    if samples.dtype == np.int16:
        samples = samples.astype(np.float32) / 32768.0
    else:
        samples = samples.astype(np.float32)
    samples = samples.reshape(-1)
    if not samples.size or not np.isfinite(samples).all():
        raise ServiceError("indicf5_audio_invalid", 503)
    duration_ms = round(samples.size * 1000 / TARGET_SAMPLE_RATE)
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(np.square(samples))))
    if duration_ms < 500 or duration_ms > 120_000 or peak > 1.05 or rms < 0.00001:
        raise ServiceError("indicf5_audio_invalid", 503)
    return np.clip(samples, -1.0, 1.0)


def _apply_perth_watermark(samples: np.ndarray) -> np.ndarray:
    """Protect arbitrary-length model output without dropping its tail.

    resemble-perth 1.0.1 reconstructs PCM on 240-sample (10 ms at 24 kHz)
    frames. IndicF5 does not promise frame-aligned output, so pad only the
    incomplete final frame before watermarking and then restore the original
    sample count. The protected body is never resampled or otherwise edited.
    """
    padding_samples = (-samples.size) % PERTH_FRAME_SAMPLES
    framed = np.pad(samples, (0, padding_samples), mode="constant") if padding_samples else samples
    protected = np.asarray(
        app.state.perth.apply_watermark(framed, watermark=None, sample_rate=TARGET_SAMPLE_RATE),
        dtype=np.float32,
    ).reshape(-1)
    if protected.size != framed.size or not np.isfinite(protected).all():
        raise ServiceError("perth_watermark_application_failed", 503)
    return protected[: samples.size]


def _synthesize_sync(value: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    torch.manual_seed(value["seed"])
    np.random.seed(value["seed"])
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(value["seed"])
    try:
        normalization = normalize_pronunciation(
            value["text"],
            domain=value["pronunciation_normalization"]["domain"],
            locale=value["pronunciation_normalization"]["locale"],
        )
    except NormalizationError as error:
        raise ServiceError(error.code, 422) from error
    if (
        normalization["contract"] != value["pronunciation_normalization"]["contract"]
        or normalization["source_text"] != value["text"]
        or normalization["source_sha256"] != value["text_sha256"]
        or normalization["transformation_count"] != len(normalization["transformations"])
    ):
        raise ServiceError("pronunciation_normalization_audit_invalid", 503)
    synthesis_text = normalization["synthesis_text"]
    if not synthesis_text.startswith(f"{DISCLOSURE} ") or script_mode(synthesis_text) not in {"devanagari", "mixed"}:
        raise ServiceError("pronunciation_normalization_disclosure_drift", 503)
    try:
        duration_plan = plan_duration(
            synthesis_text, value["reference_text"], value["reference"].duration_ms
        )
    except ValueError as error:
        raise ServiceError(str(error), 422) from error
    previous_speed = app.state.model.config.speed
    app.state.model.config.speed = duration_plan.speed
    with tempfile.NamedTemporaryFile(suffix=".wav") as reference_file:
        reference_file.write(value["reference"].audio)
        reference_file.flush()
        try:
            with torch.inference_mode():
                raw = app.state.model(
                    synthesis_text,
                    ref_audio_path=reference_file.name,
                    ref_text=value["reference_text"],
                )
        finally:
            app.state.model.config.speed = previous_speed
    samples = _waveform(raw)
    protected = _apply_perth_watermark(samples)
    score = float(np.mean(app.state.perth.get_watermark(protected, sample_rate=TARGET_SAMPLE_RATE, round=False)))
    if not math.isfinite(score) or score < app.state.perth_threshold:
        raise ServiceError("perth_watermark_verification_failed", 503)
    pcm = (np.clip(protected, -1.0, 1.0) * 32767.0).round().astype("<i2").tobytes()
    if not pcm or len(pcm) > MAX_OUTPUT_BYTES:
        raise ServiceError("indicf5_audio_invalid", 503)
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
        "model": "ai4bharat-indicf5",
        "model_commitment": app.state.model_commitment,
        "model_repo": MODEL_REPO,
        "model_revision": MODEL_REVISION,
        "reference_sha256": value["reference"].sha256,
        "reference_duration_ms": value["reference"].duration_ms,
        "reference_text_sha256": value["reference_text_sha256"],
        "reference_language_mode": value["reference_language_mode"],
        "text_sha256": value["text_sha256"],
        "text_language_mode": value["text_language_mode"],
        "synthesis_text_language_mode": script_mode(synthesis_text),
        "pronunciation_normalization_receipt": {
            "contract": normalization["contract"],
            "domain": normalization["domain"],
            "locale": normalization["locale"],
            "source_text_sha256": normalization["source_sha256"],
            "synthesis_text_sha256": normalization["synthesis_sha256"],
            "changed": normalization["changed"],
            "transformation_count": normalization["transformation_count"],
            "transformations": normalization["transformations"],
            "coverage": normalization["coverage"],
            "warnings": normalization["warnings"],
            "audit_sha256": normalization["audit_sha256"],
        },
        "consent_receipt_sha256": value["consent_receipt_sha256"],
        "perth_watermark_verified": True,
        "perth_score": round(score, 8),
        "duration_contract": duration_plan.contract,
        "duration_speed": duration_plan.speed,
        "predicted_generation_ms": duration_plan.predicted_generation_ms,
    }


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.transport_secret = decode_secret(os.getenv("INDICF5_HMAC_SECRET", ""))
    if os.getenv("INDICF5_REQUIRE_CUDA", "true").lower() != "true" or not torch.cuda.is_available():
        raise RuntimeError("indicf5_cuda_required")
    manifest = _model_manifest()
    application.state.model_commitment = manifest["commitment"]
    install_offline_vocab(MODEL_ROOT)
    install_offline_vocos(VOCODER_ROOT)
    application.state.model = AutoModel.from_pretrained(
        str(MODEL_ROOT),
        trust_remote_code=True,
        local_files_only=True,
    ).to("cuda").eval()
    application.state.perth = perth.PerthImplicitWatermarker(device="cuda")
    application.state.perth_threshold = float(os.getenv("INDICF5_PERTH_MIN_SCORE", "0.5"))
    if not 0.5 <= application.state.perth_threshold <= 1.0:
        raise RuntimeError("indicf5_perth_threshold_invalid")
    application.state.seen_nonces = {}
    application.state.generation_results = {}
    application.state.gpu_lock = asyncio.Lock()
    application.state.ready = True
    yield
    application.state.ready = False


app = FastAPI(
    title="Vyakti IndicF5 Evaluation Runtime",
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
            "model": "ai4bharat-indicf5",
            "model_commitment": getattr(app.state, "model_commitment", None),
        },
    )


@app.post(PATH)
async def synthesize(request: Request) -> Response:
    try:
        value = await _verified_payload(request)
        async with app.state.gpu_lock:
            generation_id = value["generation_id"]
            binding = value["_request_binding_sha256"]
            cached = app.state.generation_results.get(generation_id)
            if cached:
                if cached["binding"] != binding:
                    raise ServiceError("generation_binding_conflict", 409)
                result = {**cached["result"], "generation_reused": True}
            else:
                result = await asyncio.to_thread(_synthesize_sync, value)
                result["generation_reused"] = False
                app.state.generation_results[generation_id] = {
                    "binding": binding,
                    "result": result,
                }
                while len(app.state.generation_results) > 16:
                    app.state.generation_results.pop(next(iter(app.state.generation_results)))
        return _signed_response(request, 200, result)
    except ServiceError as error:
        return _signed_response(request, error.status, {"error": error.code})
    except Exception as error:
        LOGGER.exception(
            "indicf5_synthesis_failed exception_type=%s",
            type(error).__name__,
        )
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        return _signed_response(request, 503, {"error": "indicf5_synthesis_failed"})
