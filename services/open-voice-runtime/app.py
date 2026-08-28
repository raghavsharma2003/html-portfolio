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

import lora
from hindi_pack import load_hindi_pack
from offline_assets import install_offline_tokenizer_assets


PROTOCOL = "vyakti-open-voice/v1"
CONDITIONING_CONTRACT = "vyakti-voice-language-conditioning/v1"
TEXT_FRONTEND_CONTRACT = "vyakti-hindi-text-frontend/v1"
MODEL_SOURCE_COMMIT = "5de7a54aa4e5e2baadb0182dde554908b48b85c2"
MODEL_CHECKPOINT_COMMIT = "5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18"
BASE_PACK_NAME = "chatterbox-multilingual-v3"
BASE_PACK_COMMITMENT = hashlib.sha256(
    f"{BASE_PACK_NAME}:{MODEL_SOURCE_COMMIT}:{MODEL_CHECKPOINT_COMMIT}".encode()
).hexdigest()
HINDI_PACK_NAME = "chatterbox-multilingual-hi-v3"
HINDI_PACK_CHECKPOINT_COMMIT = "82ca71273cc2a9ab19efdf8315f865c1a5af0ee7"
HINDI_PACK_COMMITMENT = hashlib.sha256(
    f"{HINDI_PACK_NAME}:{MODEL_SOURCE_COMMIT}:{HINDI_PACK_CHECKPOINT_COMMIT}".encode()
).hexdigest()
MODEL_ARMS = {
    "general": (BASE_PACK_NAME, BASE_PACK_COMMITMENT),
    "hindi_v3": (HINDI_PACK_NAME, HINDI_PACK_COMMITMENT),
}
DISCLOSURE_PREFIX = "This is an AI-generated voice replica. "
DISCLOSURES = {
    "en": "This is an AI-generated voice replica.",
    "hi": "यह एआई से बनाई गई आवाज़ की प्रतिकृति है।",
}
SUPPORTED_LANGUAGES = frozenset({
    "ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it",
    "ja", "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh",
})
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_CLOCK_SKEW_SECONDS = 60
MAX_REQUEST_BYTES = 32 * 1024 * 1024
MAX_REFERENCE_BYTES = 20 * 1024 * 1024
# Same cap as the reference audio, deliberately. An r=16 adapter over the 120
# T3 attention projections is 3.93 M fp32 parameters = 15.8 MB, so 8 MB was a
# guess that the first real adapter immediately exceeded. MAX_REQUEST_BYTES
# still binds the TOTAL (reference + adapter + base64 inflation), which is the
# limit that actually protects the service; this one bounds a single field.
MAX_ADAPTER_BYTES = 20 * 1024 * 1024
MAX_OUTPUT_BYTES = 16 * 1024 * 1024
ADAPTER_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{2,63}$")
TARGET_SAMPLE_RATE = 24_000
LANGUAGE_MODES = frozenset({"devanagari", "mixed", "latin_only", "unknown"})


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


def _adapter(payload: dict[str, Any]) -> tuple[bytes | None, str | None, str | None]:
    """The optional per-speaker LoRA, carried inline and content-addressed.

    Inline rather than fetched from a store, for the same reason the reference
    audio is inline: the runtime stays stateless, holds no credential for any
    other system, and every byte that shapes the output is covered by the SAME
    request HMAC that already admits the call. A store would add a second trust
    path into the one service that is deliberately unreachable from the public
    internet.

    Absent `adapter_*` fields the request is byte-for-byte what it was before
    adapters existed, and takes the identical code path.
    """
    if not any(key.startswith("adapter_") for key in payload):
        return None, None, None
    adapter_id = str(payload.get("adapter_id", ""))
    if not ADAPTER_ID_RE.fullmatch(adapter_id):
        raise ServiceError("adapter_id_invalid", 422)
    digest = str(payload.get("adapter_sha256", ""))
    if not SHA_RE.fullmatch(digest):
        raise ServiceError("adapter_digest_invalid", 422)
    try:
        blob = base64.b64decode(payload.get("adapter_base64", ""), validate=True)
    except Exception as exc:
        raise ServiceError("adapter_blob_invalid", 422) from exc
    if not blob or len(blob) > MAX_ADAPTER_BYTES or _sha(blob) != digest:
        raise ServiceError("adapter_blob_invalid", 422)
    try:
        lora.parse(blob)
    except lora.AdapterError as exc:
        raise ServiceError(exc.code, 422) from exc
    return blob, digest, adapter_id


def _script_mode(value: str) -> str:
    devanagari = sum(1 for character in value if 0x0900 <= ord(character) <= 0x097F)
    latin = sum(1 for character in value if "A" <= character <= "Z" or "a" <= character <= "z")
    if devanagari:
        return "mixed" if latin else "devanagari"
    return "latin_only" if latin else "unknown"


def _language_conditioning(language: str, reference_mode: str, reference_scope: str, text_mode: str, requested_cfg: float, disclosure_language: str = "en") -> dict[str, Any]:
    if reference_mode not in LANGUAGE_MODES or text_mode not in LANGUAGE_MODES:
        raise ServiceError("language_conditioning_invalid", 422)
    if reference_scope not in {"source_transcript", "exact_reference", "unverified"}:
        raise ServiceError("language_conditioning_invalid", 422)
    warnings: list[str] = []
    effective_cfg = requested_cfg
    quality_state = "language_match_not_assessed"
    if language == "hi":
        if reference_scope == "source_transcript":
            warnings.append("reference_script_observed_at_source_scope")
        elif reference_scope == "unverified":
            warnings.append("reference_script_evidence_scope_unverified")
        if reference_mode == "latin_only":
            effective_cfg = 0.0
            quality_state = "accent_transfer_mitigation_applied"
            warnings.append("hindi_reference_latin_only_cfg_disabled")
        elif reference_mode == "unknown":
            effective_cfg = 0.0
            quality_state = "reference_language_unverified"
            warnings.append("hindi_reference_language_unverified_cfg_disabled")
        elif reference_mode == "mixed":
            quality_state = "mixed_reference_observed"
            warnings.append("hindi_reference_mixed_script")
        else:
            quality_state = "script_match_observed"
        if text_mode == "latin_only":
            warnings.append("hindi_text_latin_only_unverified")
        elif text_mode == "mixed":
            warnings.append("hindi_text_mixed_script")
        if disclosure_language != "hi":
            warnings.append("english_disclosure_under_hindi_language")
    return {
        "requested_cfg_weight": requested_cfg,
        "effective_cfg_weight": effective_cfg,
        "reference_language_mode": reference_mode,
        "reference_language_evidence_scope": reference_scope,
        "text_language_mode": text_mode,
        "quality_state": quality_state,
        "quality_warnings": warnings,
    }


def _request(payload: dict[str, Any]) -> dict[str, Any]:
    request_id = str(payload.get("request_id", ""))
    if not UUID_RE.fullmatch(request_id):
        raise ServiceError("request_id_invalid", 422)
    text = str(payload.get("text", "")).strip()
    frontend_contract = payload.get("text_frontend_contract")
    if frontend_contract not in (None, TEXT_FRONTEND_CONTRACT):
        raise ServiceError("text_frontend_contract_invalid", 409)
    if len(text) == 0 or len(text) > 700:
        raise ServiceError("disclosed_text_invalid", 422)
    language = str(payload.get("language_id", "")).lower()
    if language not in SUPPORTED_LANGUAGES:
        raise ServiceError("language_not_supported", 422)
    if str(payload.get("model_arm", "general")) != app.state.model_arm:
        raise ServiceError("model_arm_binding_invalid", 409)
    if app.state.model_arm == "hindi_v3" and language != "hi":
        raise ServiceError("hindi_model_arm_language_invalid", 422)
    if frontend_contract == TEXT_FRONTEND_CONTRACT:
        plan_sha256 = str(payload.get("text_plan_sha256", ""))
        segment_index = payload.get("text_segment_index")
        segment_count = payload.get("text_segment_count")
        semantic_indexes = payload.get("text_segment_semantic_indexes")
        disclosure_text = str(payload.get("disclosure_text", ""))
        disclosure_language = str(payload.get("disclosure_language_id", "")).lower()
        if not SHA_RE.fullmatch(plan_sha256):
            raise ServiceError("text_plan_hash_invalid", 422)
        if not isinstance(segment_index, int) or isinstance(segment_index, bool) or segment_index < 0:
            raise ServiceError("text_segment_index_invalid", 422)
        if not isinstance(segment_count, int) or isinstance(segment_count, bool) or not 1 <= segment_count <= 16 or segment_index >= segment_count:
            raise ServiceError("text_segment_count_invalid", 422)
        if not isinstance(semantic_indexes, list) or not semantic_indexes or any(
            not isinstance(value, int) or isinstance(value, bool) or value < 0 for value in semantic_indexes
        ):
            raise ServiceError("text_segment_semantic_indexes_invalid", 422)
        if disclosure_language not in DISCLOSURES or disclosure_text != DISCLOSURES[disclosure_language]:
            raise ServiceError("disclosure_language_binding_invalid", 409)
        if segment_index == 0:
            if text != disclosure_text and not text.startswith(disclosure_text + " "):
                raise ServiceError("disclosed_text_invalid", 422)
        elif any(text == value or text.startswith(value + " ") for value in DISCLOSURES.values()):
            raise ServiceError("duplicate_disclosure_segment_invalid", 422)
    elif not text.startswith(DISCLOSURE_PREFIX) or len(text) <= len(DISCLOSURE_PREFIX):
        raise ServiceError("disclosed_text_invalid", 422)
    seed = payload.get("seed")
    if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0 or seed > 2**31 - 1:
        raise ServiceError("seed_invalid", 422)
    audio, reference_sha256, reference_duration_ms = _reference(payload)
    adapter_blob, adapter_sha256, adapter_id = _adapter(payload)
    if app.state.model_arm == "hindi_v3" and adapter_blob is not None:
        # Existing speaker adapters were trained against the general T3
        # checkpoint. Applying one to the Hindi pack without a measured
        # compatibility qualification would make the receipt lie.
        raise ServiceError("adapter_hindi_pack_unqualified", 409)
    modern_conditioning = payload.get("conditioning_contract") == CONDITIONING_CONTRACT
    if payload.get("conditioning_contract") not in (None, CONDITIONING_CONTRACT):
        raise ServiceError("language_conditioning_contract_invalid", 409)
    reference_mode = str(payload.get("reference_language_mode", "unknown")).lower()
    reference_scope = str(payload.get("reference_language_evidence_scope", "unverified")).lower()
    observed_text_mode = _script_mode(text if frontend_contract else text[len(DISCLOSURE_PREFIX):])
    text_mode = str(payload.get("text_language_mode", observed_text_mode)).lower()
    if modern_conditioning and text_mode != observed_text_mode:
        raise ServiceError("text_language_mode_binding_invalid", 409)
    requested_cfg = _finite(payload.get("requested_cfg_weight", payload.get("cfg_weight", 0.5)), 0.0, 1.0, "cfg_weight_invalid")
    conditioning = _language_conditioning(
        language, reference_mode, reference_scope, text_mode, requested_cfg,
        disclosure_language if frontend_contract else "en",
    )
    supplied_cfg = _finite(payload.get("cfg_weight", conditioning["effective_cfg_weight"]), 0.0, 1.0, "cfg_weight_invalid")
    if modern_conditioning and not math.isclose(supplied_cfg, conditioning["effective_cfg_weight"], abs_tol=1e-9):
        raise ServiceError("language_conditioning_binding_invalid", 409)
    if not modern_conditioning:
        # Rolling-deploy compatibility: the previous app plane sends none of
        # the language fields. Preserve the exact CFG it asked for and label
        # the missing cross-plane enforcement instead of breaking every call
        # while Container Apps moves to this revision.
        conditioning["effective_cfg_weight"] = supplied_cfg
        conditioning["quality_state"] = "legacy_app_conditioning_unverified"
        conditioning["quality_warnings"].append("legacy_app_language_contract_unverified")
    return {
        "request_id": str(uuid.UUID(request_id)),
        "adapter_blob": adapter_blob,
        "adapter_sha256": adapter_sha256,
        "adapter_id": adapter_id,
        "text": text,
        "language_id": language,
        "seed": seed,
        "reference_audio": audio,
        "reference_sha256": reference_sha256,
        "reference_duration_ms": reference_duration_ms,
        "exaggeration": _finite(payload.get("exaggeration", 0.5), 0.0, 1.5, "exaggeration_invalid"),
        **conditioning,
        "conditioning_contract": CONDITIONING_CONTRACT if modern_conditioning else None,
        "cfg_weight": supplied_cfg,
        "temperature": _finite(payload.get("temperature", 0.8), 0.2, 1.5, "temperature_invalid"),
        "text_frontend_contract": frontend_contract,
        **({
            "text_plan_sha256": plan_sha256,
            "text_segment_index": segment_index,
            "text_segment_count": segment_count,
            "text_segment_semantic_indexes": semantic_indexes,
            "disclosure_text": disclosure_text,
            "disclosure_language_id": disclosure_language,
        } if frontend_contract else {}),
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
    model = app.state.model
    pack_name = app.state.model_name
    pack_commitment = app.state.model_commitment
    torch.manual_seed(value["seed"])
    np.random.seed(value["seed"])
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(value["seed"])
    # The per-speaker adapter is applied around ONE generate() and removed in a
    # finally. The model object is shared across requests behind `gpu_lock`, so
    # a leaked adapter would silently colour the NEXT caller's voice — the worst
    # possible failure in a replica lane, because the audio still sounds fine.
    handle = None
    try:
        if value["adapter_blob"] is not None:
            try:
                handle = lora.load(model.t3, value["adapter_blob"])
            except lora.AdapterError as exc:
                raise ServiceError(exc.code, 422) from exc
        with tempfile.NamedTemporaryFile(suffix=".wav") as reference:
            reference.write(value["reference_audio"])
            reference.flush()
            with torch.inference_mode():
                waveform = model.generate(
                    value["text"],
                    language_id=value["language_id"],
                    audio_prompt_path=reference.name,
                    exaggeration=value["exaggeration"],
                    cfg_weight=value["cfg_weight"],
                    temperature=value["temperature"],
                )
    finally:
        if handle is not None:
            handle.remove()
            # `T3.inference` memoises a `T3HuggingfaceBackend`. It holds `tfmr`
            # itself, not the projection children this swaps, so it would in
            # fact follow the removal — but that is a property of a third-party
            # class we pin by commit, not a promise it makes. Dropping the cache
            # costs one cheap re-wrap and removes the question entirely.
            model.t3.compiled = False
            model.t3.patched_model = None
    pcm, duration_ms = _pcm(waveform, int(model.sr))
    samples = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    detected = float(app.state.perth.get_watermark(samples, sample_rate=TARGET_SAMPLE_RATE))
    if not math.isfinite(detected) or detected < app.state.perth_threshold:
        raise ServiceError("perth_watermark_verification_failed", 503)
    elapsed_ms = max(1, round((time.perf_counter() - started) * 1000))
    # `adapter_*` appear only when an adapter was actually used, and
    # `synthesis_commitment` collapses to `model_commitment` without one — so a
    # zero-shot receipt carries the same commitment value it always did, and
    # every existing binding check in the app plane still passes unchanged.
    adapter_fields = {} if value["adapter_sha256"] is None else {
        "adapter_id": value["adapter_id"],
        "adapter_sha256": value["adapter_sha256"],
    }
    return {
        **adapter_fields,
        "synthesis_commitment": lora.synthesis_commitment(app.state.model_commitment, value["adapter_sha256"]),
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
        "model": app.state.model_name,
        "model_commitment": app.state.model_commitment,
        "model_arm": app.state.model_arm,
        "model_pack": pack_name,
        "model_pack_commitment": pack_commitment,
        "reference_language_mode": value["reference_language_mode"],
        "reference_language_evidence_scope": value["reference_language_evidence_scope"],
        "text_language_mode": value["text_language_mode"],
        "requested_cfg_weight": value["requested_cfg_weight"],
        "effective_cfg_weight": value["effective_cfg_weight"],
        "quality_state": value["quality_state"],
        "quality_warnings": value["quality_warnings"],
        **({
            "text_frontend_contract": value["text_frontend_contract"],
            "text_plan_sha256": value["text_plan_sha256"],
            "text_segment_index": value["text_segment_index"],
            "text_segment_count": value["text_segment_count"],
            "text_segment_semantic_indexes": value["text_segment_semantic_indexes"],
            "disclosure_text": value["disclosure_text"],
            "disclosure_language_id": value["disclosure_language_id"],
        } if value["text_frontend_contract"] else {}),
        **({"conditioning_contract": CONDITIONING_CONTRACT} if value["conditioning_contract"] else {}),
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
    hindi_model_root = os.getenv("OPEN_VOICE_HINDI_MODEL_ROOT", "/models/chatterbox-multilingual-hi-v3")
    application.state.runtime_asset_manifest_sha256 = install_offline_tokenizer_assets(model_root)
    application.state.model_arm = os.getenv("OPEN_VOICE_MODEL_ARM", "general").lower()
    if application.state.model_arm not in MODEL_ARMS:
        raise RuntimeError("open_voice_model_arm_invalid")
    application.state.model_name, application.state.model_commitment = MODEL_ARMS[application.state.model_arm]
    application.state.model = (
        load_hindi_pack(model_root, hindi_model_root, application.state.device)
        if application.state.model_arm == "hindi_v3"
        else ChatterboxMultilingualTTS.from_local(model_root, application.state.device, t3_model="v3")
    )
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
        "model": getattr(app.state, "model_name", BASE_PACK_NAME),
        "model_commitment": getattr(app.state, "model_commitment", BASE_PACK_COMMITMENT),
        "model_arm": getattr(app.state, "model_arm", "general"),
        "runtime_asset_manifest_sha256": getattr(app.state, "runtime_asset_manifest_sha256", None),
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
