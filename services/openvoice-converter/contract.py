"""Signed, content-addressed contract for the isolated OpenVoice converter."""

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


PROTOCOL = "vyakti-tone-color-converter/v1"
PATH = "/v1/convert"
DISCLOSURES = {
    "en": "This is an AI-generated voice replica.",
    "hi": "यह एआई से बनाई गई आवाज़ की प्रतिकृति है।",
    "hi-en": "यह एआई से बनाई गई आवाज़ की प्रतिकृति है।",
}
ALLOWED_BASE_PROVIDERS = {
    "indicf5",
    "sarvam-bulbul-v3",
    "synthetic-fixture",
}
ALLOWED_TAU = {0.3, 0.5, 0.7}
MAX_CLOCK_SKEW_SECONDS = 60
MAX_REQUEST_BYTES = 24 * 1024 * 1024
MAX_BASE_BYTES = 12 * 1024 * 1024
MAX_REFERENCE_BYTES = 4 * 1024 * 1024
MAX_TEXT_CHARS = 1_200
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{1,95}$")
NONCE_RE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")


class ServiceError(Exception):
    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code = code
        self.status = status


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def decode_secret(raw: str) -> bytes:
    try:
        value = (
            bytes.fromhex(raw)
            if re.fullmatch(r"[0-9a-fA-F]{64,}", raw)
            else base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
        )
    except Exception as exc:
        raise RuntimeError("openvoice_converter_hmac_secret_invalid") from exc
    if len(value) < 32:
        raise RuntimeError("openvoice_converter_hmac_secret_required")
    return value


def signature(secret: bytes, *parts: str) -> str:
    digest = hmac.new(secret, "\n".join(parts).encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def request_signature(
    secret: bytes,
    method: str,
    path: str,
    timestamp: str,
    nonce: str,
    body_hash: str,
) -> str:
    return signature(secret, PROTOCOL, method, path, timestamp, nonce, body_hash)


def response_signature(
    secret: bytes, path: str, nonce: str, status: int, body_hash: str
) -> str:
    return signature(
        secret, PROTOCOL, "response", path, nonce, str(status), body_hash
    )


def verify_transport(
    secret: bytes,
    method: str,
    path: str,
    headers: Any,
    body: bytes,
    now: float | None = None,
) -> str:
    if not body or len(body) > MAX_REQUEST_BYTES:
        raise ServiceError("request_size_invalid", 413)
    timestamp = str(headers.get("x-vyakti-timestamp", ""))
    nonce = str(headers.get("x-vyakti-nonce", ""))
    body_hash = str(headers.get("x-vyakti-content-sha256", ""))
    if headers.get("x-vyakti-protocol") != PROTOCOL or not NONCE_RE.fullmatch(
        nonce
    ):
        raise ServiceError("transport_binding_invalid", 401)
    try:
        issued_at = datetime.fromisoformat(
            timestamp.replace("Z", "+00:00")
        ).timestamp()
    except ValueError as exc:
        raise ServiceError("transport_timestamp_invalid", 401) from exc
    expected = request_signature(
        secret, method, path, timestamp, nonce, body_hash
    )
    if (
        abs((time.time() if now is None else now) - issued_at)
        > MAX_CLOCK_SKEW_SECONDS
        or body_hash != sha256(body)
        or not hmac.compare_digest(
            expected, str(headers.get("x-vyakti-signature", ""))
        )
    ):
        raise ServiceError("transport_binding_invalid", 401)
    return nonce


def _uuid(value: Any, code: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except ValueError as exc:
        raise ServiceError(code, 422) from exc


def _digest(value: Any, code: str) -> str:
    digest = str(value)
    if not SHA_RE.fullmatch(digest):
        raise ServiceError(code, 422)
    return digest


def _decode_audio(value: Any, maximum: int, code: str) -> bytes:
    try:
        audio = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise ServiceError(code, 422) from exc
    if not audio or len(audio) > maximum:
        raise ServiceError(code, 422)
    return audio


@dataclass(frozen=True)
class BaseAudio:
    pcm: bytes
    sha256: str
    duration_ms: int
    sample_rate: int


@dataclass(frozen=True)
class OwnerReference:
    wav: bytes
    sha256: str
    duration_ms: int
    sample_rate: int


def _base_audio(payload: dict[str, Any]) -> BaseAudio:
    if payload.get("base_encoding") != "pcm_s16le":
        raise ServiceError("base_encoding_invalid", 422)
    if payload.get("base_sample_rate") != 24_000 or payload.get("base_channels") != 1:
        raise ServiceError("base_format_invalid", 422)
    pcm = _decode_audio(
        payload.get("base_audio_base64", ""), MAX_BASE_BYTES, "base_audio_invalid"
    )
    digest = _digest(payload.get("base_audio_sha256", ""), "base_digest_invalid")
    if len(pcm) % 2 or sha256(pcm) != digest:
        raise ServiceError("base_audio_invalid", 422)
    duration_ms = round(len(pcm) / 2 * 1000 / 24_000)
    if duration_ms < 500 or duration_ms > 120_000:
        raise ServiceError("base_duration_invalid", 422)
    return BaseAudio(pcm=pcm, sha256=digest, duration_ms=duration_ms, sample_rate=24_000)


def _owner_reference(payload: dict[str, Any]) -> OwnerReference:
    wav_bytes = _decode_audio(
        payload.get("reference_audio_base64", ""),
        MAX_REFERENCE_BYTES,
        "reference_audio_invalid",
    )
    digest = _digest(
        payload.get("reference_audio_sha256", ""), "reference_digest_invalid"
    )
    if sha256(wav_bytes) != digest:
        raise ServiceError("reference_audio_invalid", 422)
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as wav:
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
    return OwnerReference(
        wav=wav_bytes,
        sha256=digest,
        duration_ms=duration_ms,
        sample_rate=sample_rate,
    )


def _base_text(payload: dict[str, Any], language_id: str) -> tuple[str, str]:
    text = payload.get("base_text")
    if (
        not isinstance(text, str)
        or text != text.strip()
        or not text
        or len(text) > MAX_TEXT_CHARS
        or any(ord(char) < 32 and char not in "\n\t" for char in text)
    ):
        raise ServiceError("base_text_invalid", 422)
    if not text.startswith(f"{DISCLOSURES[language_id]} "):
        raise ServiceError("spoken_disclosure_required", 422)
    digest = _digest(payload.get("base_text_sha256", ""), "base_text_digest_invalid")
    if sha256(text.encode("utf-8")) != digest:
        raise ServiceError("base_text_digest_invalid", 422)
    return text, digest


def validate_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ServiceError("request_json_invalid", 400)
    request_id = _uuid(payload.get("request_id"), "request_identity_invalid")
    generation_id = _uuid(payload.get("generation_id"), "request_identity_invalid")
    owner_id = _uuid(payload.get("owner_id"), "owner_identity_invalid")
    subject_id = _uuid(payload.get("reference_subject_id"), "owner_identity_invalid")
    if owner_id != subject_id:
        raise ServiceError("owner_reference_required", 403)
    consent_receipt = _digest(
        payload.get("consent_receipt_sha256", ""), "consent_receipt_required"
    )
    language_id = str(payload.get("language_id", ""))
    if language_id not in DISCLOSURES:
        raise ServiceError("base_language_invalid", 422)
    base_text, base_text_hash = _base_text(payload, language_id)
    provider = str(payload.get("base_provider", ""))
    if provider not in ALLOWED_BASE_PROVIDERS:
        raise ServiceError("base_provider_invalid", 422)
    model = str(payload.get("base_model", ""))
    if not NAME_RE.fullmatch(model):
        raise ServiceError("base_model_invalid", 422)
    base_model_commitment = _digest(
        payload.get("base_model_commitment", ""), "base_model_commitment_invalid"
    )
    base_generation_receipt = _digest(
        payload.get("base_generation_receipt_sha256", ""),
        "base_generation_receipt_required",
    )
    try:
        tau = float(payload.get("converter_tau"))
    except (TypeError, ValueError) as exc:
        raise ServiceError("converter_tau_invalid", 422) from exc
    if tau not in ALLOWED_TAU:
        raise ServiceError("converter_tau_invalid", 422)
    base = _base_audio(payload)
    reference = _owner_reference(payload)
    return {
        "request_id": request_id,
        "generation_id": generation_id,
        "owner_id": owner_id,
        "reference_subject_id": subject_id,
        "consent_receipt_sha256": consent_receipt,
        "language_id": language_id,
        "base_text": base_text,
        "base_text_sha256": base_text_hash,
        "base_provider": provider,
        "base_model": model,
        "base_model_commitment": base_model_commitment,
        "base_generation_receipt_sha256": base_generation_receipt,
        "converter_tau": tau,
        "base": base,
        "reference": reference,
    }


def build_receipt(
    value: dict[str, Any],
    converter: dict[str, Any],
    converted_pcm_sha256: str,
    final_pcm_sha256: str,
    perth_score: float,
    perth_threshold: float,
) -> dict[str, Any]:
    receipt = {
        "contract": "vyakti-tone-color-conversion-receipt/v1",
        "request_id": value["request_id"],
        "generation_id": value["generation_id"],
        "owner_id": value["owner_id"],
        "language_id": value["language_id"],
        "base": {
            "provider": value["base_provider"],
            "model": value["base_model"],
            "model_commitment": value["base_model_commitment"],
            "generation_receipt_sha256": value["base_generation_receipt_sha256"],
            "audio_sha256": value["base"].sha256,
            "text_sha256": value["base_text_sha256"],
            "duration_ms": value["base"].duration_ms,
            "sample_rate": value["base"].sample_rate,
        },
        "reference": {
            "audio_sha256": value["reference"].sha256,
            "subject_id": value["reference_subject_id"],
            "consent_receipt_sha256": value["consent_receipt_sha256"],
            "duration_ms": value["reference"].duration_ms,
            "sample_rate": value["reference"].sample_rate,
        },
        "converter": {
            **converter,
            "tau": value["converter_tau"],
            "native_watermark": "disabled_before_perth",
            "converted_pcm_sha256": converted_pcm_sha256,
        },
        "protection": {
            "scheme": "perth-implicit-v1",
            "verified": True,
            "score": round(perth_score, 8),
            "minimum_score": perth_threshold,
            "final_pcm_sha256": final_pcm_sha256,
        },
    }
    receipt["receipt_sha256"] = sha256(canonical(receipt))
    return receipt
