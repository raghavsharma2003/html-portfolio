"""Private fail-closed output protection for adult self-replica previews.

The service receives only a single generation's already-disclosed PCM. It
embeds an AudioSeal streaming watermark, creates an external C2PA manifest,
and signs public receipts with a non-exportable Azure Key Vault EC key. Raw
audio and request bodies are never logged or persisted by this process.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import os
import re
import time
import uuid
import wave
from contextlib import asynccontextmanager
from typing import Any

import c2pa
import numpy as np
import torch
from audioseal import AudioSeal
from azure.identity import DefaultAzureCredential
from azure.keyvault.keys.crypto import CryptographyClient, SignatureAlgorithm
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response


PROTOCOL = "vyakti-audio-protection/v1"
MODEL_NAME = "audioseal_wm_streaming"
DETECTOR_NAME = "audioseal_detector_streaming"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_REQUEST_BYTES = 96 * 1024 * 1024
MAX_PCM_BYTES = min(64 * 1024 * 1024, max(1024 * 1024, int(os.getenv("AUDIO_PROTECTION_MAX_PCM_BYTES", str(32 * 1024 * 1024)))))
MAX_CLOCK_SKEW_SECONDS = 60
PCM_CHUNK_SAMPLES = 5_760  # 240 ms at 24 kHz, aligned with the public receipt chain.
SIGN_PURPOSES = {"vyakti-generation-segment-v1", "vyakti-generation-receipt-v1"}


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


def _b64url_decode(value: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except Exception as exc:
        raise ServiceError("invalid_base64url") from exc


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _request_signature(secret: bytes, method: str, path: str, timestamp: str, nonce: str, body_hash: str) -> str:
    value = "\n".join((PROTOCOL, method, path, timestamp, nonce, body_hash)).encode()
    return base64.urlsafe_b64encode(hmac.new(secret, value, hashlib.sha256).digest()).rstrip(b"=").decode()


def _response_signature(secret: bytes, path: str, nonce: str, status: int, body_hash: str) -> str:
    value = "\n".join((PROTOCOL, "response", path, nonce, str(status), body_hash)).encode()
    return base64.urlsafe_b64encode(hmac.new(secret, value, hashlib.sha256).digest()).rstrip(b"=").decode()


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
    application_nonces = app.state.seen_nonces
    for seen_nonce, seen_at in tuple(application_nonces.items()):
        if seen_at < cutoff:
            application_nonces.pop(seen_nonce, None)
    if nonce in application_nonces:
        raise ServiceError("transport_replay_denied", 409)
    application_nonces[nonce] = time.time()
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise ServiceError("request_json_invalid") from exc
    if not isinstance(parsed, dict):
        raise ServiceError("request_json_invalid")
    return parsed


def _pcm(payload: dict[str, Any]) -> bytes:
    if payload.get("sample_rate") != 24_000 or payload.get("channels") != 1 or payload.get("encoding") != "pcm_s16le":
        raise ServiceError("pcm_format_unsupported", 422)
    try:
        data = base64.b64decode(payload.get("pcm_base64", ""), validate=True)
    except Exception as exc:
        raise ServiceError("pcm_invalid", 422) from exc
    if not data or len(data) % 2 or len(data) > MAX_PCM_BYTES:
        raise ServiceError("pcm_invalid", 422)
    return data


def _generation(payload: dict[str, Any]) -> str:
    value = str(payload.get("generation_id", ""))
    if not UUID_RE.fullmatch(value):
        raise ServiceError("generation_id_invalid", 422)
    return str(uuid.UUID(value))


def _key_sign(data: bytes) -> bytes:
    digest = hashlib.sha256(data).digest()
    return app.state.crypto.sign(SignatureAlgorithm.es256, digest).signature


def _signature_json(data: bytes) -> dict[str, str]:
    signature = _key_sign(data)
    return {
        "algorithm": "ES256",
        "key_id": app.state.key_id,
        "signature": base64.urlsafe_b64encode(signature).rstrip(b"=").decode(),
    }


def _wav_bytes(pcm: bytes) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(24_000)
        target.writeframes(pcm)
    return output.getvalue()


def _watermark(payload: dict[str, Any]) -> dict[str, Any]:
    generation_id = _generation(payload)
    pcm = _pcm(payload)
    if len(pcm) < 48_000:
        raise ServiceError("watermark_audio_too_short", 422)
    message_bytes = _b64url_decode(str(payload.get("message", "")))
    token_hash = str(payload.get("token_hash", ""))
    if len(message_bytes) != 2 or not SHA_RE.fullmatch(token_hash):
        raise ServiceError("watermark_message_invalid", 422)
    bits = [(byte >> shift) & 1 for byte in message_bytes for shift in range(7, -1, -1)]
    secret_message = torch.tensor([bits], dtype=torch.int64, device=app.state.device)
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    waveform = torch.from_numpy(samples).reshape(1, 1, -1).to(app.state.device)
    protected: list[torch.Tensor] = []
    with torch.inference_mode(), app.state.watermarker.streaming(batch_size=1):
        for offset in range(0, waveform.shape[-1], PCM_CHUNK_SAMPLES):
            chunk = waveform[..., offset : offset + PCM_CHUNK_SAMPLES]
            protected.append(app.state.watermarker(chunk, sample_rate=24_000, message=secret_message, alpha=1))
    result = torch.cat(protected, dim=-1)
    if result.shape != waveform.shape:
        raise ServiceError("audioseal_shape_changed", 500)
    with torch.inference_mode():
        confidence, decoded = app.state.detector.detect_watermark(result)
    confidence_value = float(torch.as_tensor(confidence).detach().cpu().reshape(-1)[0])
    decoded_bits = [int(value >= 0.5) for value in torch.as_tensor(decoded).detach().cpu().reshape(-1)[:16].tolist()]
    if confidence_value < app.state.detector_threshold or decoded_bits != bits:
        raise ServiceError("audioseal_self_verification_failed", 503)
    output = (result.squeeze().clamp(-1, 1).cpu().numpy() * 32767.0).round().astype("<i2").tobytes()
    detector_policy = {
        "algorithm": "audioseal",
        "generator": MODEL_NAME,
        "detector": DETECTOR_NAME,
        "version": "0.2.0",
        "message_bits": 16,
        "sample_rate": 24_000,
    }
    return {
        "audio_base64": base64.b64encode(output).decode(),
        "output_sha256": _sha(output),
        "token_hash": token_hash,
        "detector_policy_hash": _sha(_canonical(detector_policy)),
        "embedded": True,
        "streaming": True,
        "verification_confidence": round(confidence_value, 8),
        "message_verified": True,
        "generation_id": generation_id,
    }


def _c2pa_manifest(payload: dict[str, Any]) -> dict[str, Any]:
    generation_id = _generation(payload)
    pcm = _pcm(payload)
    asset_hash = str(payload.get("asset_hash", ""))
    if not SHA_RE.fullmatch(asset_hash) or _sha(pcm) != asset_hash:
        raise ServiceError("c2pa_asset_hash_mismatch", 422)
    manifest_definition = {
        "claim_generator_info": [{"name": "Vyakti Replica Protector", "version": "1.0.0"}],
        "format": "audio/wav",
        "title": "AI-generated voice replica",
        "ingredients": [],
        "assertions": [{
            "label": "c2pa.actions",
            "data": {"actions": [{
                "action": "c2pa.created",
                "digitalSourceType": "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
            }]},
        }, {
            "label": "com.vyakti.replica.protection",
            "data": {
                "schema": "vyakti.replica.protection.v1",
                "generationId": generation_id,
                "canonicalPcmSha256": asset_hash,
                "audibleDisclosure": True,
                "watermark": "audioseal@0.2.0-streaming",
            },
        }],
    }
    wav = _wav_bytes(pcm)
    with c2pa.Context() as context:
        with c2pa.Signer.from_callback(
            _key_sign,
            c2pa.C2paSigningAlg.ES256,
            app.state.certificate_chain,
            app.state.timestamp_url,
        ) as signer:
            with c2pa.Builder(manifest_definition, context) as builder:
                builder.set_no_embed()
                builder.set_remote_url(f"{app.state.public_manifest_origin}/api/replica-provenance?generation_id={generation_id}&kind=manifest")
                destination = io.BytesIO()
                manifest_bytes = builder.sign(signer, "audio/wav", io.BytesIO(wav), destination)
    if not manifest_bytes or len(manifest_bytes) > 1024 * 1024:
        raise ServiceError("c2pa_manifest_invalid", 500)
    signature = _signature_json(manifest_bytes)
    return {
        "manifest_base64": base64.b64encode(manifest_bytes).decode(),
        "manifest_hash": _sha(manifest_bytes),
        "signer_key_id": signature["key_id"],
        "signature_algorithm": signature["algorithm"],
        "signature": signature["signature"],
    }


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.transport_secret = _secret("AZURE_AUDIO_PROTECTION_HMAC_SECRET")
    application.state.key_id = os.environ["AZURE_KEY_VAULT_KEY_ID"]
    application.state.certificate_chain = base64.b64decode(os.environ["C2PA_SIGN_CERTIFICATE_B64"]).decode("utf-8")
    application.state.timestamp_url = os.getenv("C2PA_TIMESTAMP_URL", "http://timestamp.digicert.com")
    application.state.public_manifest_origin = os.environ["PUBLIC_APP_ORIGIN"].rstrip("/")
    if not application.state.public_manifest_origin.startswith("https://"):
        raise RuntimeError("public_app_origin_invalid")
    credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
    application.state.crypto = CryptographyClient(application.state.key_id, credential)
    application.state.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if os.getenv("AUDIO_PROTECTION_REQUIRE_CUDA", "true").lower() != "false" and application.state.device.type != "cuda":
        raise RuntimeError("audio_protection_cuda_required")
    application.state.watermarker = AudioSeal.load_generator(MODEL_NAME).to(application.state.device).eval()
    application.state.detector = AudioSeal.load_detector(DETECTOR_NAME).to(application.state.device).eval()
    application.state.detector_threshold = float(os.getenv("AUDIOSEAL_GENERATION_MIN_CONFIDENCE", "0.80"))
    if not 0.5 <= application.state.detector_threshold <= 0.999:
        raise RuntimeError("audioseal_detector_threshold_invalid")
    application.state.seen_nonces = {}
    application.state.ready = True
    yield
    application.state.ready = False


app = FastAPI(title="Vyakti Audio Protection", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.get("/healthz")
async def health() -> JSONResponse:
    return JSONResponse(status_code=200 if getattr(app.state, "ready", False) else 503, content={"ready": bool(getattr(app.state, "ready", False))})


async def _run(request: Request, operation) -> JSONResponse:
    try:
        payload = await _verified_json(request)
        return _signed_response(request, 200, operation(payload))
    except ServiceError as error:
        return _signed_response(request, error.status, {"error": error.code})
    except Exception:
        return _signed_response(request, 503, {"error": "audio_protection_failed"})


@app.post("/v1/watermark")
async def watermark(request: Request) -> JSONResponse:
    return await _run(request, _watermark)


@app.post("/v1/sign")
async def sign(request: Request) -> JSONResponse:
    def operation(payload: dict[str, Any]) -> dict[str, Any]:
        if payload.get("purpose") not in SIGN_PURPOSES:
            raise ServiceError("sign_purpose_denied", 403)
        data = _b64url_decode(str(payload.get("payload_base64", "")))
        if not data or len(data) > 256 * 1024 or _sha(data) != payload.get("payload_sha256"):
            raise ServiceError("sign_payload_invalid", 422)
        return _signature_json(data)
    return await _run(request, operation)


@app.post("/v1/c2pa")
async def c2pa_manifest(request: Request) -> JSONResponse:
    return await _run(request, _c2pa_manifest)
