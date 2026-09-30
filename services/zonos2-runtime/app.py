"""Private, owner-bound ZONOS2 Hindi/Hinglish/English evaluation runtime."""

from __future__ import annotations

import asyncio
import base64
import io
import json
import math
import os
import tempfile
import time
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import dac
import numpy as np
import perth
import torch
import torchaudio
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from zonos2.message import TTSSamplingParams
from zonos2.models.speaker_cloning import Qwen3SpeakerEmbedding
from zonos2.tts import TTSLLM
import zonos2.tokenizer.vocoder as zonos2_vocoder

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


MODEL_REPO = "Zyphra/ZONOS2"
MODEL_REVISION = "65f1e80f94b599d474bb6af9094a803dc52f60bd"
SOURCE_COMMIT = "194c0a3ab67b90383a67646289f28d4ecb1c1f64"
SPEAKER_REPO = "marksverdhei/Qwen3-Voice-Embedding-12Hz-1.7B"
SPEAKER_REVISION = "7577f61c42737fc8064bba773e2a18602df92803"
DAC_RELEASE = "descript-audio-codec/0.0.1/44khz-8kbps"
DAC_SHA256 = "a88eed82a7024ccc1facdb1e605c4c2f99281c8118c22c9895ffa846d8fb61aa"
CUDA_COMPILER_PACKAGE = "cuda-nvcc-12-8=12.8.93-1"
MODEL_ROOT = Path(os.getenv("ZONOS2_MODEL_ROOT", "/models/zonos2"))
SPEAKER_ROOT = Path(os.getenv("ZONOS2_SPEAKER_ROOT", "/models/qwen3-speaker"))
DAC_PATH = Path(os.getenv("ZONOS2_DAC_PATH", "/models/dac/weights_44khz_8kbps_0.0.1.pth"))
MODEL_SAMPLE_RATE = 44_100
DELIVERY_SAMPLE_RATE = 24_000
MIN_GPU_MEMORY_BYTES = 22 * 1024**3
MAX_OUTPUT_BYTES = 16 * 1024 * 1024


def _transport_secret() -> bytes:
    secret_file = Path(os.getenv("ZONOS2_HMAC_SECRET_FILE", "/run/secrets/zonos2_hmac"))
    if os.getenv("ZONOS2_HMAC_SECRET"):
        raise RuntimeError("zonos2_plaintext_hmac_forbidden")
    try:
        value = secret_file.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError("zonos2_hmac_secret_file_required") from exc
    return decode_secret(value)


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
    try:
        manifest = json.loads((MODEL_ROOT / ".vyakti-model-manifest.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("zonos2_model_manifest_required") from exc
    expected = {
        "contract": "vyakti-zonos2-model-manifest/v1",
        "model_repo": MODEL_REPO,
        "model_revision": MODEL_REVISION,
        "speaker_repo": SPEAKER_REPO,
        "speaker_revision": SPEAKER_REVISION,
        "source_commit": SOURCE_COMMIT,
        "dac_sha256": DAC_SHA256,
    }
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise RuntimeError("zonos2_model_manifest_mismatch")
    if not isinstance(manifest.get("commitment"), str) or len(manifest["commitment"]) != 64:
        raise RuntimeError("zonos2_model_commitment_invalid")
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


def _load_local_dac() -> dac.DAC:
    if zonos2_vocoder._dac_model is None:
        if not DAC_PATH.is_file() or sha256(DAC_PATH.read_bytes()) != DAC_SHA256:
            raise RuntimeError("zonos2_dac_commitment_mismatch")
        zonos2_vocoder._dac_model = dac.DAC.load(str(DAC_PATH)).eval().to("cuda:0")
    return zonos2_vocoder._dac_model


def _reference_file(audio: bytes) -> tempfile.NamedTemporaryFile:
    reference_file = tempfile.NamedTemporaryFile(suffix=".wav")
    reference_file.write(audio)
    reference_file.flush()
    return reference_file


def _delivery_waveform(raw: bytes, source_rate: int) -> np.ndarray:
    if source_rate != MODEL_SAMPLE_RATE or not raw or len(raw) % 4:
        raise ServiceError("zonos2_audio_invalid", 503)
    samples = np.frombuffer(raw, dtype="<f4").astype(np.float32, copy=True)
    if not samples.size or not np.isfinite(samples).all():
        raise ServiceError("zonos2_audio_invalid", 503)
    delivered = torchaudio.functional.resample(
        torch.from_numpy(samples).unsqueeze(0), MODEL_SAMPLE_RATE, DELIVERY_SAMPLE_RATE
    ).squeeze(0).numpy()
    duration_ms = round(delivered.size * 1000 / DELIVERY_SAMPLE_RATE)
    peak = float(np.max(np.abs(delivered))) if delivered.size else 0.0
    rms = float(np.sqrt(np.mean(np.square(delivered)))) if delivered.size else 0.0
    if duration_ms < 500 or duration_ms > 120_000 or peak > 1.05 or rms < 0.00001:
        raise ServiceError("zonos2_audio_invalid", 503)
    return np.clip(delivered, -1.0, 1.0)


def _synthesize_sync(value: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    torch.manual_seed(value["seed"])
    np.random.seed(value["seed"])
    torch.cuda.manual_seed_all(value["seed"])
    torch.cuda.reset_peak_memory_stats(0)

    with _reference_file(value["reference"].audio) as reference_file:
        speaker_embedding = app.state.model.embed_speaker_file(reference_file.name)
        params = TTSSamplingParams(**app.state.generation_parameters, seed=value["seed"])
        with torch.inference_mode():
            result = app.state.model.generate_one(
                value["text"],
                params,
                language="en_us",
                text_normalization=value["language_id"] == "en",
                speaker_embedding=speaker_embedding,
                clean_speaker_background=False,
                accurate_mode=True,
            )

    samples = _delivery_waveform(result.get("audio", b""), int(result.get("sample_rate", 0)))
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
        raise ServiceError("zonos2_audio_invalid", 503)

    duration_ms = round(len(pcm) / 2 * 1000 / DELIVERY_SAMPLE_RATE)
    elapsed_ms = max(1, round((time.perf_counter() - started) * 1000))
    peak_allocated = int(torch.cuda.max_memory_allocated(0))
    peak_reserved = int(torch.cuda.max_memory_reserved(0))
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
        "gpu_peak_allocated_bytes": peak_allocated,
        "gpu_peak_reserved_bytes": peak_reserved,
        "model": "zonos2",
        "model_commitment": app.state.model_commitment,
        "model_repo": MODEL_REPO,
        "model_revision": MODEL_REVISION,
        "source_commit": SOURCE_COMMIT,
        "model_license": "Apache-2.0",
        "source_license": "MIT",
        "speaker_repo": SPEAKER_REPO,
        "speaker_revision": SPEAKER_REVISION,
        "speaker_license": "Apache-2.0",
        "dac_release": DAC_RELEASE,
        "dac_sha256": DAC_SHA256,
        "dac_license": "MIT",
        "cuda_compiler_package": CUDA_COMPILER_PACKAGE,
        "reference_sha256": value["reference"].sha256,
        "reference_source_sha256": value["reference_source_sha256"],
        "reference_duration_ms": value["reference"].duration_ms,
        "reference_window_start_ms": value["reference_window_start_ms"],
        "reference_window_end_ms": value["reference_window_end_ms"],
        "consent_receipt_sha256": value["consent_receipt_sha256"],
        "third_party_policy_receipt_sha256": value["third_party_policy_receipt_sha256"],
        "language_id": value["language_id"],
        "language_tier": 1 if value["language_id"] == "en" else 3,
        "hindi_text_normalization_available": False,
        "script_mode": value["script_mode"],
        "text_sha256": value["text_sha256"],
        "spoken_disclosure": value["disclosure"],
        "clone_mode": value["clone_mode"],
        "evaluation_scope": value["evaluation_scope"],
        "identity_scope": value["identity_scope"],
        "release_eligible": value["release_eligible"],
        "generation_parameters": app.state.generation_parameters,
        "accurate_mode": True,
        "perth_watermark_verified": True,
        "perth_score": round(score, 8),
    }


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.transport_secret = _transport_secret()
    if os.getenv("ZONOS2_REQUIRE_CUDA", "true").lower() != "true" or not torch.cuda.is_available():
        raise RuntimeError("zonos2_cuda_required")
    if torch.cuda.get_device_properties(0).total_memory < MIN_GPU_MEMORY_BYTES:
        raise RuntimeError("zonos2_gpu_memory_insufficient")
    manifest = _model_manifest()
    application.state.model_commitment = manifest["commitment"]
    Qwen3SpeakerEmbedding.MODEL_NAME = str(SPEAKER_ROOT)
    zonos2_vocoder._get_dac = _load_local_dac
    application.state.model = TTSLLM(model_path=str(MODEL_ROOT), dtype=torch.bfloat16, decode_audio=True)
    if not application.state.model.speaker_enabled or application.state.model.speaker_embedding_dim != 2048:
        raise RuntimeError("zonos2_speaker_conditioning_required")
    application.state.perth = perth.PerthImplicitWatermarker(device="cuda")
    application.state.perth_threshold = float(os.getenv("ZONOS2_PERTH_MIN_SCORE", "0.5"))
    if not 0.5 <= application.state.perth_threshold <= 1.0:
        raise RuntimeError("zonos2_perth_threshold_invalid")
    application.state.generation_parameters = {
        "temperature": 1.15,
        "topk": 106,
        "top_p": 0.0,
        "min_p": 0.18,
        "max_tokens": 1024,
        "repetition_window": 50,
        "repetition_penalty": 1.2,
        "repetition_codebooks": 8,
        "emotion_cfg_scale": 1.0,
    }
    application.state.seen_nonces = {}
    application.state.gpu_lock = asyncio.Lock()
    application.state.ready = True
    yield
    application.state.ready = False


app = FastAPI(
    title="Vyakti ZONOS2 Evaluation Runtime",
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
            "model": "zonos2",
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
        print(f"[zonos2] synthesis_failed type={type(error).__name__}", flush=True)
        return _signed_response(request, 503, {"error": "zonos2_synthesis_failed"})
