"""In-house YouTube audio extraction, gated on a channel-ownership attestation.

This is an EXTRACTION service, not a downloader. Three properties make that a
structural claim rather than a description:

  1. It never accepts a URL. It accepts an 11-character video id plus an
     attestation naming a channel key, and it resolves the video's own
     uploader from YouTube's metadata BEFORE downloading a byte. If the video
     does not belong to the attested channel the request is refused at
     `channel_binding_mismatch` and no media is ever fetched. A caller who
     wants somebody else's video cannot express the request.

  2. It never chooses where the bytes go. The caller supplies a pre-signed
     upload target, and the service will only PUT to the single host named by
     `MEDIA_EXTRACT_UPLOAD_HOST`. Without that env it refuses to start.

  3. It never holds the media in memory. yt-dlp writes to a per-request temp
     directory, the digest is taken in chunks, and the upload streams from
     disk. An hour of lecture audio is ~55 MB of 16 kHz mono WAV and it is
     never a Python object.

It receives no account, replica, person, owner or transcript id — the same
rule `services/voice-evidence/app.py` states for itself, for the same reason:
a service that cannot name a person cannot leak one.

The legal posture this implements is written out in README.md and in
`context/decisions.md#youtube-extraction-in-house`. The one-line version:
ToS-permission and copyright-permission are different things, only the second
is ours to obtain, and this service refuses to run without evidence of the
second.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import wave
from typing import Any

import anyio
import requests
from fastapi import FastAPI, Request
from fastapi.responses import Response


PROTOCOL = "vyakti-media-extract/v1"
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
# The two channel key shapes api/_channel/contracts.js's `channelRef` produces.
CHANNEL_KEY_RE = re.compile(r"^(?:UC[A-Za-z0-9_-]{22}|@[A-Za-z0-9._-]{3,30}|[A-Za-z0-9._-]{1,64})$")
NONCE_RE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")

MAX_REQUEST_BYTES = 64 * 1024
MAX_CLOCK_SKEW_SECONDS = 60

# Ceilings. Both are also enforced by the caller (api/_channel/providers/
# youtube-extract.js) — this is the second layer, and it is the one that holds
# when the caller is the thing that is wrong.
MAX_DURATION_SECONDS = min(6 * 60 * 60, max(60, int(os.getenv("MEDIA_EXTRACT_MAX_DURATION_SECONDS", 4 * 60 * 60))))
MAX_AUDIO_BYTES = min(512 * 1024 * 1024, max(1024 * 1024, int(os.getenv("MEDIA_EXTRACT_MAX_AUDIO_BYTES", 256 * 1024 * 1024))))
EXTRACT_TIMEOUT_SECONDS = min(3600, max(60, int(os.getenv("MEDIA_EXTRACT_TIMEOUT_SECONDS", 1800))))

# The normalized shape `api/_replica-processing` and the ASR lane already
# speak: 16 kHz mono signed 16-bit PCM WAV. Not negotiable per-request — a
# per-request sample rate is a per-request measurement basis, and two runs
# that were normalized differently are not comparable.
TARGET_SAMPLE_RATE = 16_000
TARGET_CHANNELS = 1


class ServiceError(Exception):
    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code = code
        self.status = status


def _secret(name: str) -> bytes:
    raw = os.getenv(name, "")
    try:
        value = bytes.fromhex(raw) if re.fullmatch(r"[0-9a-fA-F]{64,}", raw) else base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    except Exception as exc:  # noqa: BLE001 - startup only, never per-request
        raise RuntimeError(f"{name.lower()}_invalid") from exc
    if len(value) < 32:
        raise RuntimeError(f"{name.lower()}_required")
    return value


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _signature(secret: bytes, *parts: str) -> str:
    return base64.urlsafe_b64encode(hmac.new(secret, "\n".join(parts).encode(), hashlib.sha256).digest()).rstrip(b"=").decode()


def _signed_response(request: Request, status: int, payload: dict[str, Any]) -> Response:
    body = _canonical(payload)
    nonce = request.headers.get("x-vyakti-nonce", "")
    response = Response(body, status_code=status, media_type="application/json")
    response.headers["X-Vyakti-Response-Signature"] = _signature(
        app.state.transport_secret, PROTOCOL, "response", request.url.path, nonce, str(status), _sha(body)
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


async def _verified_json(request: Request) -> dict[str, Any]:
    """services/voice-evidence/app.py's admission check, verbatim in shape.

    Signed over method + path + timestamp + nonce + body digest, replay-denied
    on the nonce, clock-skew bounded. The attestation travels INSIDE the body,
    so it is covered by the same signature — a caller cannot strip it, and a
    caller who forges it needs the transport secret, which is the same thing
    as being the application plane.
    """
    body = await request.body()
    if not body or len(body) > MAX_REQUEST_BYTES:
        raise ServiceError("request_size_invalid", 413)
    timestamp = request.headers.get("x-vyakti-timestamp", "")
    nonce = request.headers.get("x-vyakti-nonce", "")
    body_hash = request.headers.get("x-vyakti-content-sha256", "")
    if request.headers.get("x-vyakti-protocol") != PROTOCOL or not NONCE_RE.fullmatch(nonce):
        raise ServiceError("transport_binding_invalid", 401)
    try:
        from datetime import datetime

        issued_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()
    except ValueError as exc:
        raise ServiceError("transport_timestamp_invalid", 401) from exc
    expected = _signature(app.state.transport_secret, PROTOCOL, request.method, request.url.path, timestamp, nonce, body_hash)
    if abs(time.time() - issued_at) > MAX_CLOCK_SKEW_SECONDS or body_hash != _sha(body) or not hmac.compare_digest(
        expected, request.headers.get("x-vyakti-signature", "")
    ):
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
        raise ServiceError("request_body_invalid", 400) from exc
    if not isinstance(parsed, dict):
        raise ServiceError("request_body_invalid", 400)
    return parsed


# ── the attestation predicate ────────────────────────────────────────────────
#
# This is the part that makes the service legitimate rather than general
# purpose, so it is a function with a name, called before anything else, and
# `evals/mediaextract.mjs` has a negative control that strikes it out and
# asserts the suite goes red.


def _attestation(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ServiceError("attestation_missing", 403)
    receipt_hash = str(value.get("receipt_hash") or "")
    channel_key = str(value.get("channel_key") or "")
    if not SHA_RE.fullmatch(receipt_hash):
        raise ServiceError("attestation_receipt_invalid", 403)
    if not CHANNEL_KEY_RE.fullmatch(channel_key):
        raise ServiceError("attestation_channel_key_invalid", 403)
    try:
        from datetime import datetime

        expires_at = datetime.fromisoformat(str(value.get("expires_at") or "").replace("Z", "+00:00")).timestamp()
    except ValueError as exc:
        raise ServiceError("attestation_expiry_invalid", 403) from exc
    if expires_at <= time.time():
        raise ServiceError("attestation_expired", 403)
    return {"receipt_hash": receipt_hash, "channel_key": channel_key, "expires_at": expires_at}


def _upload_target(value: Any) -> dict[str, Any]:
    """The one place bytes can go, and it is not chosen by the request.

    A signed request from the application plane still cannot make this service
    PUT a teacher's lecture anywhere except the storage host the deployment
    was configured with. That is the difference between "the caller is
    trusted" and "the caller is bounded".
    """
    if not isinstance(value, dict):
        raise ServiceError("upload_target_invalid", 400)
    url = str(value.get("url") or "")
    from urllib.parse import urlsplit

    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.netloc or "@" in parts.netloc:
        raise ServiceError("upload_target_invalid", 400)
    if parts.hostname != app.state.upload_host:
        raise ServiceError("upload_host_forbidden", 403)
    headers = value.get("headers") or {}
    if not isinstance(headers, dict) or len(headers) > 8:
        raise ServiceError("upload_target_invalid", 400)
    clean = {}
    for key, header_value in headers.items():
        key = str(key)
        if not re.fullmatch(r"[A-Za-z0-9-]{1,64}", key) or key.lower() in {"host", "content-length"}:
            raise ServiceError("upload_target_invalid", 400)
        clean[key] = str(header_value)[:512]
    return {"url": url, "headers": clean}


# ── yt-dlp ───────────────────────────────────────────────────────────────────


def _ytdlp_version() -> str:
    try:
        import yt_dlp

        return str(yt_dlp.version.__version__)
    except Exception:  # noqa: BLE001
        return "unknown"


def _run(argv: list[str], timeout: int) -> subprocess.CompletedProcess[bytes]:
    try:
        return subprocess.run(argv, capture_output=True, timeout=timeout, check=False)  # noqa: S603
    except subprocess.TimeoutExpired as exc:
        raise ServiceError("extractor_timeout", 504) from exc
    except OSError as exc:
        raise ServiceError("extractor_unavailable", 503) from exc


def _classify(stderr: bytes) -> str:
    """yt-dlp's failure modes are not interchangeable and the operator needs
    to tell them apart WITHOUT reading a log: a bot check means the deploy
    needs cookies or a different egress, a signature failure means the pinned
    version is stale and must be bumped, a private video means the teacher
    unlisted it and nothing is broken at all.

    Everything unrecognized stays `extractor_failed` rather than being guessed
    at — a code that names the wrong cause is worse than one that names none.
    """
    text = stderr.decode("utf-8", "replace").lower()
    if "sign in to confirm" in text or "not a bot" in text:
        return "extractor_bot_check"
    if "po token" in text or "proof of origin" in text:
        return "extractor_po_token_required"
    if "nsig" in text or "signature extraction" in text or "unable to extract" in text and "player" in text:
        return "extractor_signature_failed"
    if "private video" in text or "members-only" in text or "video unavailable" in text:
        return "video_unavailable"
    if "http error 429" in text or "too many requests" in text:
        return "extractor_rate_limited"
    if "http error 403" in text:
        return "extractor_forbidden"
    if "geo" in text and "block" in text:
        return "extractor_geo_blocked"
    return "extractor_failed"


def _common_args() -> list[str]:
    argv = ["yt-dlp", "--no-progress", "--no-playlist", "--no-warnings", "--ignore-config"]
    cookies = os.getenv("MEDIA_EXTRACT_COOKIES_FILE", "")
    if cookies and os.path.isfile(cookies):
        argv += ["--cookies", cookies]
    proxy = os.getenv("MEDIA_EXTRACT_PROXY", "")
    if proxy:
        argv += ["--proxy", proxy]
    clients = os.getenv("MEDIA_EXTRACT_PLAYER_CLIENTS", "")
    if clients:
        argv += ["--extractor-args", f"youtube:player_client={clients}"]
    return argv


def _probe(video_id: str) -> dict[str, Any]:
    """Metadata FIRST, always. This is the ordering that turns the attestation
    from a claim into a check: the uploader is read from YouTube itself before
    a single media byte is requested, so a mismatched video costs one metadata
    call and downloads nothing.
    """
    result = _run(
        _common_args() + ["--skip-download", "--dump-single-json", f"https://www.youtube.com/watch?v={video_id}"],
        timeout=min(180, EXTRACT_TIMEOUT_SECONDS),
    )
    if result.returncode != 0:
        raise ServiceError(_classify(result.stderr), 502)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ServiceError("extractor_metadata_invalid", 502) from exc


def _binds_to(info: dict[str, Any], channel_key: str) -> bool:
    key = channel_key.lower().lstrip("@")
    candidates = {
        str(info.get("channel_id") or "").lower(),
        str(info.get("uploader_id") or "").lower().lstrip("@"),
        str(info.get("channel_url") or "").rsplit("/", 1)[-1].lower().lstrip("@"),
        str(info.get("uploader_url") or "").rsplit("/", 1)[-1].lower().lstrip("@"),
    }
    candidates.discard("")
    return key in candidates


def _extract_to_wav(video_id: str, workdir: str) -> str:
    template = os.path.join(workdir, "audio.%(ext)s")
    result = _run(
        _common_args()
        + [
            "--format",
            "bestaudio/best",
            "--extract-audio",
            "--audio-format",
            "wav",
            # AUDIO ONLY, said three ways: bestaudio selection, -x, and a
            # postprocessor that re-encodes to the one normalized shape. A
            # video stream never reaches disk.
            "--postprocessor-args",
            f"ffmpeg:-ac {TARGET_CHANNELS} -ar {TARGET_SAMPLE_RATE} -acodec pcm_s16le",
            "--max-filesize",
            str(MAX_AUDIO_BYTES),
            "--no-part",
            "--output",
            template,
            f"https://www.youtube.com/watch?v={video_id}",
        ],
        timeout=EXTRACT_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        raise ServiceError(_classify(result.stderr), 502)
    path = os.path.join(workdir, "audio.wav")
    if not os.path.isfile(path):
        raise ServiceError("extractor_no_audio", 502)
    return path


def _wav_facts(path: str) -> dict[str, Any]:
    byte_size = os.path.getsize(path)
    if byte_size < 1024 or byte_size > MAX_AUDIO_BYTES:
        raise ServiceError("audio_size_invalid", 413)
    try:
        with wave.open(path, "rb") as handle:
            channels = handle.getnchannels()
            sample_rate = handle.getframerate()
            frames = handle.getnframes()
            width = handle.getsampwidth()
    except wave.Error as exc:
        raise ServiceError("audio_shape_invalid", 502) from exc
    # The normalization is ASSERTED, not assumed. A future ffmpeg whose
    # postprocessor args changed meaning would otherwise ship a 44.1 kHz
    # stereo file into a lane that measures 16 kHz mono, and every number
    # downstream would be wrong and none of them would look wrong.
    if channels != TARGET_CHANNELS or sample_rate != TARGET_SAMPLE_RATE or width != 2:
        raise ServiceError("audio_shape_invalid", 502)
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return {
        "sha256": digest.hexdigest(),
        "byte_size": byte_size,
        "duration_ms": int(round(frames * 1000 / sample_rate)),
        "sample_rate_hz": sample_rate,
        "channels": channels,
    }


def _upload(path: str, target: dict[str, Any]) -> None:
    with open(path, "rb") as handle:
        try:
            response = requests.put(
                target["url"],
                data=handle,  # streams from disk; never a bytes object
                headers={"Content-Type": "audio/wav", **target["headers"]},
                timeout=(15, EXTRACT_TIMEOUT_SECONDS),
            )
        except requests.RequestException as exc:
            raise ServiceError("upload_unreachable", 503) from exc
    if response.status_code == 409:
        raise ServiceError("upload_conflict", 409)
    if not response.ok:
        raise ServiceError("upload_failed", 502)


def _extract(payload: dict[str, Any]) -> dict[str, Any]:
    video_id = str(payload.get("video_id") or "")
    if not VIDEO_ID_RE.fullmatch(video_id):
        raise ServiceError("video_id_invalid", 400)
    attestation = _attestation(payload.get("attestation"))
    target = _upload_target(payload.get("upload"))
    ceiling_ms = int(payload.get("max_duration_ms") or 0)
    if ceiling_ms < 1000 or ceiling_ms > MAX_DURATION_SECONDS * 1000:
        raise ServiceError("duration_ceiling_invalid", 400)

    info = _probe(video_id)
    if not _binds_to(info, attestation["channel_key"]):
        raise ServiceError("channel_binding_mismatch", 403)
    duration_ms = int(round(float(info.get("duration") or 0) * 1000))
    if duration_ms <= 0:
        raise ServiceError("duration_unknown", 502)
    if duration_ms > ceiling_ms:
        raise ServiceError("duration_over_ceiling", 413)
    if not info.get("is_live") in (None, False):
        raise ServiceError("video_is_live", 409)

    workdir = tempfile.mkdtemp(prefix="mx-", dir=app.state.workroot)
    try:
        path = _extract_to_wav(video_id, workdir)
        facts = _wav_facts(path)
        _upload(path, target)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    return {
        "protocol": PROTOCOL,
        "video_id": video_id,
        "mime": "audio/wav",
        "extractor": "yt-dlp",
        "extractor_version": app.state.extractor_version,
        "attestation_receipt_hash": attestation["receipt_hash"],
        **facts,
    }


app = FastAPI(title="vyakti-media-extract", docs_url=None, redoc_url=None, openapi_url=None)


@app.on_event("startup")
def _startup() -> None:
    app.state.transport_secret = _secret("MEDIA_EXTRACT_HMAC_SECRET")
    host = os.getenv("MEDIA_EXTRACT_UPLOAD_HOST", "").strip().lower()
    if not re.fullmatch(r"[a-z0-9.-]{4,253}", host):
        raise RuntimeError("media_extract_upload_host_required")
    app.state.upload_host = host
    app.state.workroot = os.getenv("MEDIA_EXTRACT_WORK_DIR", "/scratch")
    os.makedirs(app.state.workroot, exist_ok=True)
    if not shutil.which("yt-dlp") or not shutil.which("ffmpeg"):
        raise RuntimeError("media_extract_toolchain_missing")
    app.state.extractor_version = _ytdlp_version()
    app.state.seen_nonces = {}


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {
        "ok": True,
        "protocol": PROTOCOL,
        "extractor_version": getattr(app.state, "extractor_version", "unknown"),
        "max_duration_seconds": MAX_DURATION_SECONDS,
        "max_audio_bytes": MAX_AUDIO_BYTES,
    }


@app.post("/v1/extract")
async def extract(request: Request) -> Response:
    try:
        payload = await _verified_json(request)
        result = await anyio.to_thread.run_sync(_extract, payload)
    except ServiceError as error:
        return _signed_response(request, error.status, {"error": error.code})
    except Exception:  # noqa: BLE001
        # Deliberately opaque. An exception string from a subprocess wrapper
        # can carry a URL, a path or a cookie fragment, and this response
        # crosses a network boundary.
        return _signed_response(request, 500, {"error": "media_extract_failed"})
    return _signed_response(request, 200, result)
