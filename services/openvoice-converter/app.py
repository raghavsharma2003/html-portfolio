"""Private OpenVoice V2 tone-color candidate for owner-only bake-offs."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import math
import os
import re
import tempfile
import time
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import librosa
import numpy as np
import perth
import soundfile
import torch
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from openvoice.api import OpenVoiceBaseClass, ToneColorConverter

from contract import (
    PATH,
    ServiceError,
    build_receipt,
    canonical,
    decode_secret,
    response_signature,
    sha256,
    validate_payload,
    verify_transport,
)


SOURCE_REPO = "myshell-ai/OpenVoice"
SOURCE_COMMIT = "74a1d147b17a8c3092dd5430504bd83ef6c7eb23"
MODEL_REPO = "myshell-ai/OpenVoiceV2"
MODEL_REVISION = "fd981100305a0e4291f93a9ad169c6d9f7bed54a"
CHECKPOINT_SHA256 = "9652c27e92b6b2a91632590ac9962ef7ae2b712e5c5b7f4c34ec55ee2b37ab9e"
CONFIG_SHA256 = "9dfff60350b8c63f2c664efd92a61b2516efb22671466960f0e5dfebd881fa47"
RUNTIME_SOURCE_SHA256 = os.getenv("OPENVOICE_CONVERTER_RUNTIME_SOURCE_SHA256", "")
MODEL_ROOT = Path(os.getenv("OPENVOICE_CONVERTER_MODEL_ROOT", "/models/openvoice-v2"))
CONVERTER_RATE = 22_050
OUTPUT_RATE = 24_000
PERTH_FRAME_SAMPLES = 240
MAX_OUTPUT_BYTES = 16 * 1024 * 1024


class PerThOnlyToneColorConverter(ToneColorConverter):
    """Initialize the official converter without loading its WavMark model."""

    def __init__(self, config_path: str, device: str):
        OpenVoiceBaseClass.__init__(self, config_path, device=device)
        self.watermark_model = None
        self.version = getattr(self.hps, "_version_", "v1")


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _signed_response(request: Request, status: int, payload: dict[str, Any]) -> Response:
    body = canonical(payload)
    nonce = request.headers.get("x-vyakti-nonce", "")
    response = Response(status_code=status, content=body, media_type="application/json")
    response.headers["X-Vyakti-Response-Signature"] = response_signature(
        app.state.transport_secret,
        request.url.path,
        nonce,
        status,
        sha256(body),
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def _model_manifest() -> dict[str, Any]:
    manifest_path = MODEL_ROOT / ".vyakti-model-manifest.json"
    config_path = MODEL_ROOT / "converter" / "config.json"
    checkpoint_path = MODEL_ROOT / "converter" / "checkpoint.pth"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("openvoice_converter_manifest_required") from exc
    expected = {
        "contract": "vyakti-openvoice-v2-model-manifest/v1",
        "source_repo": SOURCE_REPO,
        "source_commit": SOURCE_COMMIT,
        "model_repo": MODEL_REPO,
        "model_revision": MODEL_REVISION,
        "checkpoint_sha256": CHECKPOINT_SHA256,
        "config_sha256": CONFIG_SHA256,
    }
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise RuntimeError("openvoice_converter_manifest_mismatch")
    if _file_sha256(checkpoint_path) != CHECKPOINT_SHA256:
        raise RuntimeError("openvoice_converter_checkpoint_mismatch")
    if _file_sha256(config_path) != CONFIG_SHA256:
        raise RuntimeError("openvoice_converter_config_mismatch")
    commitment = manifest.get("commitment")
    if not isinstance(commitment, str) or len(commitment) != 64:
        raise RuntimeError("openvoice_converter_commitment_invalid")
    return manifest


async def _verified_payload(request: Request) -> dict[str, Any]:
    body = await request.body()
    nonce = verify_transport(
        app.state.transport_secret,
        request.method,
        request.url.path,
        request.headers,
        body,
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
    if (
        value["base_provider"] == "synthetic-fixture"
        and not app.state.allow_synthetic_fixture
    ):
        raise ServiceError("synthetic_fixture_disabled", 403)
    return value


def _signal(value: Any, sample_rate: int, minimum_ms: int, maximum_ms: int) -> np.ndarray:
    samples = np.asarray(value, dtype=np.float32).reshape(-1)
    if not samples.size or not np.isfinite(samples).all():
        raise ServiceError("converter_audio_invalid", 503)
    duration_ms = round(samples.size * 1000 / sample_rate)
    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(np.square(samples))))
    if (
        duration_ms < minimum_ms
        or duration_ms > maximum_ms
        or peak > 1.05
        or rms < 0.00001
    ):
        raise ServiceError("converter_audio_invalid", 503)
    return np.clip(samples, -1.0, 1.0)


def _reference_signal(wav_bytes: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(wav_bytes), "rb") as wav:
        frames = wav.readframes(wav.getnframes())
    return _signal(
        np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0,
        OUTPUT_RATE,
        3_000,
        15_000,
    )


def _pcm(samples: np.ndarray) -> bytes:
    return (
        np.clip(samples, -1.0, 1.0) * 32767.0
    ).round().astype("<i2").tobytes()


def _apply_perth_watermark(samples: np.ndarray) -> np.ndarray:
    """Protect arbitrary converter output without dropping its final samples."""

    padding_samples = (-samples.size) % PERTH_FRAME_SAMPLES
    framed = (
        np.pad(samples, (0, padding_samples), mode="constant")
        if padding_samples
        else samples
    )
    protected = np.asarray(
        app.state.perth.apply_watermark(
            framed, watermark=None, sample_rate=OUTPUT_RATE
        ),
        dtype=np.float32,
    ).reshape(-1)
    if protected.size != framed.size or not np.isfinite(protected).all():
        raise ServiceError("perth_watermark_application_failed", 503)
    return protected[: samples.size]


def _convert_sync(value: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    base_samples = _signal(
        np.frombuffer(value["base"].pcm, dtype="<i2").astype(np.float32) / 32768.0,
        OUTPUT_RATE,
        500,
        120_000,
    )
    _reference_signal(value["reference"].wav)
    with tempfile.TemporaryDirectory(prefix="vyakti-openvoice-") as directory:
        base_path = Path(directory) / "base.wav"
        reference_path = Path(directory) / "owner-reference.wav"
        converted_path = Path(directory) / "converted.wav"
        soundfile.write(base_path, base_samples, OUTPUT_RATE, subtype="PCM_16")
        reference_path.write_bytes(value["reference"].wav)
        with torch.inference_mode():
            source_se = app.state.converter.extract_se(str(base_path))
            target_se = app.state.converter.extract_se(str(reference_path))
            app.state.converter.convert(
                audio_src_path=str(base_path),
                src_se=source_se,
                tgt_se=target_se,
                output_path=str(converted_path),
                tau=value["converter_tau"],
                message="",
            )
        converted, sample_rate = soundfile.read(
            converted_path, dtype="float32", always_2d=False
        )
    converted = _signal(converted, sample_rate, 400, 120_000)
    if sample_rate != OUTPUT_RATE:
        converted = librosa.resample(
            converted, orig_sr=sample_rate, target_sr=OUTPUT_RATE, res_type="soxr_hq"
        )
    converted = _signal(converted, OUTPUT_RATE, 400, 120_000)
    converted_pcm = _pcm(converted)
    protected = _apply_perth_watermark(converted)
    protected = _signal(protected, OUTPUT_RATE, 400, 120_000)
    score = float(
        np.mean(
            app.state.perth.get_watermark(
                protected, sample_rate=OUTPUT_RATE, round=False
            )
        )
    )
    if not math.isfinite(score) or score < app.state.perth_threshold:
        raise ServiceError("perth_watermark_verification_failed", 503)
    final_pcm = _pcm(protected)
    if not final_pcm or len(final_pcm) > MAX_OUTPUT_BYTES:
        raise ServiceError("converter_audio_invalid", 503)
    duration_ms = round(len(final_pcm) / 2 * 1000 / OUTPUT_RATE)
    elapsed_ms = max(1, round((time.perf_counter() - started) * 1000))
    receipt = build_receipt(
        value,
        app.state.converter_receipt,
        sha256(converted_pcm),
        sha256(final_pcm),
        score,
        app.state.perth_threshold,
    )
    return {
        "request_id": value["request_id"],
        "generation_id": value["generation_id"],
        "audio_base64": base64.b64encode(final_pcm).decode(),
        "output_sha256": sha256(final_pcm),
        "sample_rate": OUTPUT_RATE,
        "channels": 1,
        "encoding": "pcm_s16le",
        "duration_ms": duration_ms,
        "elapsed_ms": elapsed_ms,
        "real_time_factor": round(elapsed_ms / duration_ms, 6),
        "receipt": receipt,
    }


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.transport_secret = decode_secret(
        os.getenv("OPENVOICE_CONVERTER_HMAC_SECRET", "")
    )
    if (
        os.getenv("OPENVOICE_CONVERTER_REQUIRE_CUDA", "true").lower() != "true"
        or not torch.cuda.is_available()
    ):
        raise RuntimeError("openvoice_converter_cuda_required")
    if not re.fullmatch(r"[0-9a-f]{64}", RUNTIME_SOURCE_SHA256):
        raise RuntimeError("openvoice_converter_runtime_source_commitment_required")
    manifest = _model_manifest()
    config_path = MODEL_ROOT / "converter" / "config.json"
    checkpoint_path = MODEL_ROOT / "converter" / "checkpoint.pth"
    application.state.converter = PerThOnlyToneColorConverter(
        str(config_path), device="cuda"
    )
    application.state.converter.load_ckpt(str(checkpoint_path))
    application.state.converter_receipt = {
        "engine": "openvoice-v2-tone-color-converter",
        "source_repo": SOURCE_REPO,
        "source_commit": SOURCE_COMMIT,
        "model_repo": MODEL_REPO,
        "model_revision": MODEL_REVISION,
        "checkpoint_sha256": CHECKPOINT_SHA256,
        "config_sha256": CONFIG_SHA256,
        "runtime_source_sha256": RUNTIME_SOURCE_SHA256,
        "commitment": manifest["commitment"],
        "native_sample_rate": CONVERTER_RATE,
        "output_sample_rate": OUTPUT_RATE,
    }
    application.state.perth = perth.PerthImplicitWatermarker(device="cuda")
    application.state.perth_threshold = float(
        os.getenv("OPENVOICE_CONVERTER_PERTH_MIN_SCORE", "0.5")
    )
    if not 0.5 <= application.state.perth_threshold <= 1.0:
        raise RuntimeError("openvoice_converter_perth_threshold_invalid")
    application.state.allow_synthetic_fixture = (
        os.getenv("OPENVOICE_CONVERTER_ALLOW_SYNTHETIC_FIXTURE", "false").lower()
        == "true"
    )
    application.state.seen_nonces = {}
    application.state.gpu_lock = asyncio.Lock()
    application.state.ready = True
    yield
    application.state.ready = False


app = FastAPI(
    title="Vyakti OpenVoice Converter Evaluation Runtime",
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
            "model": "openvoice-v2-tone-color-converter",
            "converter_commitment": getattr(
                app.state, "converter_receipt", {}
            ).get("commitment"),
            "runtime_source_sha256": getattr(
                app.state, "converter_receipt", {}
            ).get("runtime_source_sha256"),
        },
    )


@app.post(PATH)
async def convert(request: Request) -> Response:
    try:
        value = await _verified_payload(request)
        async with app.state.gpu_lock:
            result = await asyncio.to_thread(_convert_sync, value)
        return _signed_response(request, 200, result)
    except ServiceError as error:
        return _signed_response(request, error.status, {"error": error.code})
    except Exception:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        return _signed_response(
            request, 503, {"error": "openvoice_conversion_failed"}
        )
