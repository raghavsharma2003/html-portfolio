"""Private zero-shot synthesis service for consented adult self-replicas.

The service receives no tenant, person, or provider identifiers. It accepts one
content-addressed WAV reference and one disclosed utterance, runs an immutable
Chatterbox Multilingual V3 checkpoint, verifies the model's PerTh watermark,
and returns bounded raw PCM with a signed response. Request bodies and audio
are never logged or persisted.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import io
import json
import math
import os
import re
import tempfile
import time
import uuid
import wave
from contextlib import asynccontextmanager
from typing import Any

import numpy as np
import perth
import soundfile as sf
import torch
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response


PROTOCOL = "vyakti-open-voice/v1"
MODEL_NAME = "chatterbox-multilingual-v3"
MODEL_SOURCE_COMMIT = "5de7a54aa4e5e2baadb0182dde554908b48b85c2"
MODEL_CHECKPOINT_COMMIT = "5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18"
MODEL_COMMITMENT = hashlib.sha256(
    f"{MODEL_NAME}:{MODEL_SOURCE_COMMIT}:{MODEL_CHECKPOINT_COMMIT}".encode()
).hexdigest()
DISCLOSURE_PREFIX = "This is an AI-generated voice replica. "
SUPPORTED_LANGUAGES = frozenset({
    "ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it",
    "ja", "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh",
})
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_CLOCK_SKEW_SECONDS = 60
MAX_REQUEST_BYTES = 32 * 1024 * 1024
MAX_REFERENCE_BYTES = 20 * 1024 * 1024
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
TARGET_SAMPLE_RATE = 24_000


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
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _request_signature(secret: bytes, method: str, path: str, timestamp: str, nonce: str, body_hash: str) -> str:
    material = "\n".join((PROTOCOL, method, path, timestamp, nonce, body_hash)).encode()
    return base64.urlsafe_b64encode(hmac.new(secret, material, hashlib.sha256).digest()).rstrip(b"=").decode()


def _response_signature(secret: bytes, path: str, nonce: str, status: int, body_hash: str) -> str:
    material = "\n".join((PROTOCOL, "response", path, nonce, str(status), body_hash)).encode()
    return base64.urlsafe_b64encode(hmac.new(secret, material, hashlib.sha256).digest()).rstrip(b"=").decode()


def _signed_response(request: Request, status: int, payload: dict[str, Any]) -> Response:
    body = _canonical(payload)
    nonce = request.headers.get("x-vyakti-nonce", "")
    response = Response(status_code=status, content=body, media_type="application/json")
    response.headers["X-Vyakti-Response-Signature"] = _response_signature(
        app.state.transport_secret, request.url.path, nonce, status, _sha(body)
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
    if abs(time.time() - issued_at) > MAX_CLOCK_SKEW_SECONDS or body_hash != _sha(body):
        raise ServiceError("transport_binding_invalid", 401)
    expected = _request_signature(app.state.transport_secret, request.method, request.url.path, timestamp, nonce, body_hash)
    if not hmac.compare_digest(expected, request.headers.get("x-vyakti-signature", "")):
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


def _finite(value: Any, low: float, high: float, code: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ServiceError(code, 422) from exc
    if not math.isfinite(number) or number < low or number > high:
        raise ServiceError(code, 422)
    return number


def _reference(payload: dict[str, Any]) -> tuple[bytes, str, int]:
    digest = str(payload.get("reference_sha256", ""))
    if not SHA_RE.fullmatch(digest):
        raise ServiceError("reference_digest_invalid", 422)
    try:
        audio = base64.b64decode(payload.get("reference_audio_base64", ""), validate=True)
    except Exception as exc:
        raise ServiceError("reference_audio_invalid", 422) from exc
    if not audio or len(audio) > MAX_REFERENCE_BYTES or _sha(audio) != digest:
        raise ServiceError("reference_audio_invalid", 422)
    try:
        info = sf.info(io.BytesIO(audio))
    except Exception as exc:
        raise ServiceError("reference_wav_invalid", 422) from exc
    duration_ms = round(float(info.duration) * 1000)
    if info.format != "WAV" or info.channels not in (1, 2) or info.samplerate < 8_000 or info.samplerate > 96_000:
        raise ServiceError("reference_wav_invalid", 422)
    if duration_ms < 5_000 or duration_ms > 90_000:
        raise ServiceError("reference_duration_invalid", 422)
    return audio, digest, duration_ms


def _request(payload: dict[str, Any]) -> dict[str, Any]:
    request_id = str(payload.get("request_id", ""))
    if not UUID_RE.fullmatch(request_id):
        raise ServiceError("request_id_invalid", 422)
    text = str(payload.get("text", "")).strip()
    if not text.startswith(DISCLOSURE_PREFIX) or len(text) <= len(DISCLOSURE_PREFIX) or len(text) > 700:
        raise ServiceError("disclosed_text_invalid", 422)
    language = str(payload.get("language_id", "")).lower()
    if language not in SUPPORTED_LANGUAGES:
        raise ServiceError("language_not_supported", 422)
    seed = payload.get("seed")
    if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0 or seed > 2**31 - 1:
        raise ServiceError("seed_invalid", 422)
    audio, reference_sha256, reference_duration_ms = _reference(payload)
    return {
        "request_id": str(uuid.UUID(request_id)),
        "text": text,
        "language_id": language,
        "seed": seed,
        "reference_audio": audio,
        "reference_sha256": reference_sha256,
        "reference_duration_ms": reference_duration_ms,
        "exaggeration": _finite(payload.get("exaggeration", 0.5), 0.0, 1.5, "exaggeration_invalid"),
        "cfg_weight": _finite(payload.get("cfg_weight", 0.5), 0.0, 1.0, "cfg_weight_invalid"),
        "temperature": _finite(payload.get("temperature", 0.8), 0.2, 1.5, "temperature_invalid"),
    }


def _pcm(samples: torch.Tensor, source_rate: int) -> tuple[bytes, int]:
    waveform = samples.detach().to(dtype=torch.float32, device="cpu").reshape(-1)
    if not waveform.numel() or not torch.isfinite(waveform).all():
        raise ServiceError("synthesis_audio_invalid", 503)
    if source_rate != TARGET_SAMPLE_RATE:
        raise ServiceError("synthesis_sample_rate_invalid", 503)
    waveform = waveform.clamp(-1.0, 1.0)
    duration_ms = round(waveform.numel() * 1000 / TARGET_SAMPLE_RATE)
    if duration_ms < 500 or duration_ms > 120_000:
        raise ServiceError("synthesis_duration_invalid", 503)
    output = (waveform.numpy() * 32767.0).round().astype("<i2").tobytes()
    if not output or len(output) > MAX_OUTPUT_BYTES:
        raise ServiceError("synthesis_audio_too_large", 503)
    return output, duration_ms


def _synthesize_sync(value: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    torch.manual_seed(value["seed"])
    np.random.seed(value["seed"])
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(value["seed"])
    with tempfile.NamedTemporaryFile(suffix=".wav") as reference:
        reference.write(value["reference_audio"])
        reference.flush()
        with torch.inference_mode():
            waveform = app.state.model.generate(
                value["text"],
                language_id=value["language_id"],
                audio_prompt_path=reference.name,
                exaggeration=value["exaggeration"],
                cfg_weight=value["cfg_weight"],
                temperature=value["temperature"],
            )
    pcm, duration_ms = _pcm(waveform, int(app.state.model.sr))
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    detected = float(app.state.perth.get_watermark(samples, sample_rate=TARGET_SAMPLE_RATE))
    if not math.isfinite(detected) or detected < app.state.perth_threshold:
        raise ServiceError("perth_watermark_verification_failed", 503)
    elapsed_ms = max(1, round((time.perf_counter() - started) * 1000))
    return {
        "request_id": value["request_id"],
        "audio_base64": base64.b64encode(pcm).decode(),
        "output_sha256": _sha(pcm),
        "sample_rate": TARGET_SAMPLE_RATE,
        "channels": 1,
        "encoding": "pcm_s16le",
        "duration_ms": duration_ms,
        "elapsed_ms": elapsed_ms,
        "real_time_factor": round(elapsed_ms / duration_ms, 6),
        "reference_sha256": value["reference_sha256"],
        "reference_duration_ms": value["reference_duration_ms"],
        "model": MODEL_NAME,
        "model_commitment": MODEL_COMMITMENT,
        "perth_watermark_verified": True,
        "perth_score": round(detected, 8),
    }


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.transport_secret = _secret("OPEN_VOICE_HMAC_SECRET")
    application.state.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if os.getenv("OPEN_VOICE_REQUIRE_CUDA", "true").lower() != "false" and application.state.device.type != "cuda":
        raise RuntimeError("open_voice_cuda_required")
    model_root = os.getenv("OPEN_VOICE_MODEL_ROOT", "/models/chatterbox-multilingual-v3")
    application.state.model = ChatterboxMultilingualTTS.from_local(model_root, application.state.device, t3_model="v3")
    if int(application.state.model.sr) != TARGET_SAMPLE_RATE:
        raise RuntimeError("open_voice_model_sample_rate_unsupported")
    application.state.perth = perth.PerthImplicitWatermarker()
    application.state.perth_threshold = float(os.getenv("OPEN_VOICE_PERTH_MIN_SCORE", "0.5"))
    if not 0.5 <= application.state.perth_threshold <= 1.0:
        raise RuntimeError("open_voice_perth_threshold_invalid")
    application.state.seen_nonces = {}
    application.state.gpu_lock = asyncio.Lock()
    application.state.ready = True
    yield
    application.state.ready = False


app = FastAPI(title="Vyakti Open Voice Runtime", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.get("/healthz")
async def health() -> JSONResponse:
    return JSONResponse(status_code=200 if getattr(app.state, "ready", False) else 503, content={
        "ready": bool(getattr(app.state, "ready", False)),
        "model": MODEL_NAME,
        "model_commitment": MODEL_COMMITMENT,
    })


@app.post("/v1/synthesize")
async def synthesize(request: Request) -> Response:
    try:
        payload = await _verified_json(request)
        value = _request(payload)
        async with app.state.gpu_lock:
            result = await asyncio.to_thread(_synthesize_sync, value)
        return _signed_response(request, 200, result)
    except ServiceError as error:
        return _signed_response(request, error.status, {"error": error.code})
    except Exception:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        return _signed_response(request, 503, {"error": "open_voice_synthesis_failed"})
