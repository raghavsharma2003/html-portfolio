"""Signed, fail-closed contract for the isolated Qwen3-TTS English candidate."""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import re
import time
import uuid
import wave
from dataclasses import dataclass
from datetime import datetime
from typing import Any


PROTOCOL = "vyakti-open-voice/v1"
PATH = "/v1/synthesize"
DISCLOSURE = "This is an AI-generated voice replica."
MAX_CLOCK_SKEW_SECONDS = 60
MAX_REQUEST_BYTES = 24 * 1024 * 1024
MAX_REFERENCE_BYTES = 20 * 1024 * 1024
MAX_TEXT_CHARS = 1_200
MAX_REFERENCE_TEXT_CHARS = 2_000
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
NONCE_RE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")


class ServiceError(Exception):
    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code = code
        self.status = status


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def decode_secret(raw: str) -> bytes:
    try:
        value = bytes.fromhex(raw) if re.fullmatch(r"[0-9a-fA-F]{64,}", raw) else base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    except Exception as exc:
        raise RuntimeError("qwen3_hmac_secret_invalid") from exc
    if len(value) < 32:
        raise RuntimeError("qwen3_hmac_secret_required")
    return value


def signature(secret: bytes, *parts: str) -> str:
    digest = hmac.new(secret, "\n".join(parts).encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def request_signature(secret: bytes, method: str, path: str, timestamp: str, nonce: str, body_hash: str) -> str:
    return signature(secret, PROTOCOL, method, path, timestamp, nonce, body_hash)


def response_signature(secret: bytes, path: str, nonce: str, status: int, body_hash: str) -> str:
    return signature(secret, PROTOCOL, "response", path, nonce, str(status), body_hash)


def verify_transport(secret: bytes, method: str, path: str, headers: Any, body: bytes, now: float | None = None) -> str:
    if not body or len(body) > MAX_REQUEST_BYTES:
        raise ServiceError("request_size_invalid", 413)
    timestamp = str(headers.get("x-vyakti-timestamp", ""))
    nonce = str(headers.get("x-vyakti-nonce", ""))
    body_hash = str(headers.get("x-vyakti-content-sha256", ""))
    if headers.get("x-vyakti-protocol") != PROTOCOL or not NONCE_RE.fullmatch(nonce):
        raise ServiceError("transport_binding_invalid", 401)
    try:
        issued_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()
    except ValueError as exc:
        raise ServiceError("transport_timestamp_invalid", 401) from exc
    expected = request_signature(secret, method, path, timestamp, nonce, body_hash)
    if abs((time.time() if now is None else now) - issued_at) > MAX_CLOCK_SKEW_SECONDS:
        raise ServiceError("transport_binding_invalid", 401)
    if body_hash != sha256(body) or not hmac.compare_digest(expected, str(headers.get("x-vyakti-signature", ""))):
        raise ServiceError("transport_binding_invalid", 401)
    return nonce


def _text(value: Any, code: str, maximum: int) -> str:
    if not isinstance(value, str) or value != value.strip() or not value or len(value) > maximum:
        raise ServiceError(code, 422)
    if any(ord(char) < 32 and char not in "\n\t" for char in value):
        raise ServiceError(code, 422)
    return value


def _english_script(value: str) -> bool:
    has_latin = any("A" <= char <= "Z" or "a" <= char <= "z" for char in value)
    has_devanagari = any("\u0900" <= char <= "\u097f" for char in value)
    return has_latin and not has_devanagari


@dataclass(frozen=True)
class Reference:
    audio: bytes
    sha256: str
    duration_ms: int
    sample_rate: int


def reference(payload: dict[str, Any]) -> Reference:
    digest = str(payload.get("reference_sha256", ""))
    if not SHA_RE.fullmatch(digest):
        raise ServiceError("reference_digest_invalid", 422)
    try:
        audio = base64.b64decode(payload.get("reference_audio_base64", ""), validate=True)
    except Exception as exc:
        raise ServiceError("reference_audio_invalid", 422) from exc
    if not audio or len(audio) > MAX_REFERENCE_BYTES or sha256(audio) != digest:
        raise ServiceError("reference_audio_invalid", 422)
    try:
        with wave.open(io.BytesIO(audio), "rb") as wav:
            channels = wav.getnchannels()
            sample_width = wav.getsampwidth()
            sample_rate = wav.getframerate()
            frames = wav.getnframes()
            compression = wav.getcomptype()
    except (EOFError, wave.Error) as exc:
        raise ServiceError("reference_wav_invalid", 422) from exc
    if channels != 1 or sample_width != 2 or sample_rate != 24_000 or compression != "NONE":
        raise ServiceError("reference_wav_invalid", 422)
    duration_ms = round(frames * 1000 / sample_rate)
    if duration_ms < 3_000 or duration_ms > 15_000:
        raise ServiceError("reference_duration_invalid", 422)
    return Reference(audio=audio, sha256=digest, duration_ms=duration_ms, sample_rate=sample_rate)


def validate_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ServiceError("request_json_invalid", 400)
    try:
        request_id = str(uuid.UUID(str(payload.get("request_id", ""))))
        generation_id = str(uuid.UUID(str(payload.get("generation_id", ""))))
    except ValueError as exc:
        raise ServiceError("request_identity_invalid", 422) from exc
    if str(payload.get("language_id", "")).lower() != "en":
        raise ServiceError("qwen3_english_only", 422)
    text = _text(payload.get("text"), "text_invalid", MAX_TEXT_CHARS)
    if not text.startswith(f"{DISCLOSURE} ") or not _english_script(text):
        raise ServiceError("english_disclosure_required", 422)
    ref_text = _text(payload.get("reference_text"), "reference_text_required", MAX_REFERENCE_TEXT_CHARS)
    ref_text_hash = str(payload.get("reference_text_sha256", ""))
    if not _english_script(ref_text) or not SHA_RE.fullmatch(ref_text_hash) or sha256(ref_text.encode("utf-8")) != ref_text_hash:
        raise ServiceError("reference_text_digest_invalid", 422)
    consent_receipt = str(payload.get("consent_receipt_sha256", ""))
    if not SHA_RE.fullmatch(consent_receipt):
        raise ServiceError("consent_receipt_required", 422)
    try:
        seed = int(payload.get("seed"))
    except (TypeError, ValueError) as exc:
        raise ServiceError("seed_invalid", 422) from exc
    if seed < 0 or seed > 2_147_483_647:
        raise ServiceError("seed_invalid", 422)
    ref = reference(payload)
    return {
        "request_id": request_id,
        "generation_id": generation_id,
        "language_id": "en",
        "text": text,
        "reference_text": ref_text,
        "reference_text_sha256": ref_text_hash,
        "consent_receipt_sha256": consent_receipt,
        "seed": seed,
        "reference": ref,
    }
