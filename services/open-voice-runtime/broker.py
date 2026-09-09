"""Public CPU admission broker for the private GPU voice runtime.

Container Apps can reject neither a body HMAC nor a generation policy before
scaling an externally exposed GPU replica. This small scale-to-zero broker does
that work first, then forwards the exact authenticated request to the internal
GPU app in the same managed environment. Random internet traffic can wake only
the CPU broker, never the GPU workload.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response


PROTOCOL = "vyakti-open-voice/v1"
PATH = "/v1/synthesize"
RUNTIME_STATUS_PATH = "/v1/runtime-status"
MAX_CLOCK_SKEW_SECONDS = 60
MAX_REQUEST_BYTES = 32 * 1024 * 1024
MAX_RESPONSE_BYTES = 24 * 1024 * 1024
class BrokerError(Exception):
    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code = code
        self.status = status


def _secret() -> bytes:
    raw = os.getenv("OPEN_VOICE_HMAC_SECRET", "")
    try:
        value = bytes.fromhex(raw) if re.fullmatch(r"[0-9a-fA-F]{64,}", raw) else base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    except Exception as exc:
        raise RuntimeError("open_voice_hmac_secret_invalid") from exc
    if len(value) < 32:
        raise RuntimeError("open_voice_hmac_secret_required")
    return value


def _runtime_origin() -> str:
    raw = os.getenv("OPEN_VOICE_RUNTIME_ORIGIN", "")
    parsed = urlsplit(raw)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise RuntimeError("open_voice_runtime_origin_invalid")
    return f"https://{parsed.netloc}"


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _signature(secret: bytes, values: tuple[str, ...]) -> str:
    return base64.urlsafe_b64encode(hmac.new(secret, "\n".join(values).encode(), hashlib.sha256).digest()).rstrip(b"=").decode()


def _signed_response(request: Request, body: bytes, status: int) -> Response:
    nonce = request.headers.get("x-vyakti-nonce", "")
    response = Response(status_code=status, content=body, media_type="application/json")
    response.headers["X-Vyakti-Response-Signature"] = _signature(
        app.state.secret, (PROTOCOL, "response", request.url.path, nonce, str(status), _sha(body))
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def _signed_error(request: Request, code: str, status: int) -> Response:
    body = json.dumps({"error": code}, sort_keys=True, separators=(",", ":")).encode()
    return _signed_response(request, body, status)


async def _admit(request: Request) -> tuple[bytes, str]:
    declared = request.headers.get("content-length")
    if declared and (not declared.isdigit() or int(declared) > MAX_REQUEST_BYTES):
        raise BrokerError("request_size_invalid", 413)
    body = await request.body()
    if not body or len(body) > MAX_REQUEST_BYTES:
        raise BrokerError("request_size_invalid", 413)
    timestamp = request.headers.get("x-vyakti-timestamp", "")
    nonce = request.headers.get("x-vyakti-nonce", "")
    body_hash = request.headers.get("x-vyakti-content-sha256", "")
    if request.headers.get("x-vyakti-protocol") != PROTOCOL or not re.fullmatch(r"[A-Za-z0-9_-]{20,64}", nonce):
        raise BrokerError("transport_binding_invalid", 401)
    try:
        from datetime import datetime
        issued_at = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()
    except ValueError as exc:
        raise BrokerError("transport_timestamp_invalid", 401) from exc
    expected = _signature(app.state.secret, (PROTOCOL, request.method, request.url.path, timestamp, nonce, body_hash))
    if abs(time.time() - issued_at) > MAX_CLOCK_SKEW_SECONDS or body_hash != _sha(body) or not hmac.compare_digest(expected, request.headers.get("x-vyakti-signature", "")):
        raise BrokerError("transport_binding_invalid", 401)
    cutoff = time.time() - MAX_CLOCK_SKEW_SECONDS
    for seen_nonce, seen_at in tuple(app.state.seen_nonces.items()):
        if seen_at < cutoff:
            app.state.seen_nonces.pop(seen_nonce, None)
    if nonce in app.state.seen_nonces:
        raise BrokerError("transport_replay_denied", 409)
    app.state.seen_nonces[nonce] = time.time()
    return body, body_hash


ALLOCATION_PATH = "/api/voice-allocation-admission"
MAX_ADMISSION_BYTES = 4096
UUID_PATTERN = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"


def _azure_origin(name: str) -> str:
    raw = os.getenv(name, "")
    parsed = urlsplit(raw)
    if (parsed.scheme != "https" or not parsed.hostname
            or not parsed.hostname.endswith(".azurecontainerapps.io")
            or parsed.username or parsed.password or parsed.port
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
        raise BrokerError("voice_allocation_not_configured", 503)
    return f"https://{parsed.hostname}"


async def _bounded_response(client, method: str, url: str, limit: int, **kwargs):
    # Bound actual streamed bytes, including chunked responses. No redirect can
    # cause a second request. Callers must never retry a consumed child.
    async with client.stream(method, url, follow_redirects=False, **kwargs) as response:
        declared = response.headers.get("content-length")
        if declared and (not declared.isdigit() or int(declared) > limit):
            raise BrokerError("upstream_response_invalid", 503)
        body = bytearray()
        async for chunk in response.aiter_bytes():
            if len(body) + len(chunk) > limit:
                raise BrokerError("upstream_response_invalid", 503)
            body.extend(chunk)
        if not body or 300 <= response.status_code < 400:
            raise BrokerError("upstream_response_invalid", 503)
        return response.status_code, response.headers, bytes(body)


def _dispatch_deadline(value: str) -> float:
    # Require an explicit UTC ISO timestamp; reject coercions, NaN and local time.
    if not isinstance(value, str) or not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z", value):
        raise BrokerError("voice_allocation_expired", 503)
    try:
        deadline = datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (ValueError, OverflowError) as exc:
        raise BrokerError("voice_allocation_expired", 503) from exc
    _check_dispatch_deadline(deadline)
    return deadline


def _check_dispatch_deadline(deadline: float) -> None:
    remaining = deadline - time.time()
    if not 0 < remaining <= 420:
        raise BrokerError("voice_allocation_expired", 503)


async def _require_allocation_authority(request: Request, body_hash: str) -> float:
    origin = _azure_origin("OPEN_VOICE_ALLOCATION_ORIGIN")
    broker_origin = _azure_origin("OPEN_VOICE_BROKER_ORIGIN")
    window_id = request.headers.get("x-vyakti-allocation-window", "")
    child_id = request.headers.get("x-vyakti-allocation-child", "")
    if not re.fullmatch(UUID_PATTERN, window_id) or not re.fullmatch(UUID_PATTERN, child_id):
        raise BrokerError("voice_allocation_binding_invalid", 403)
    operation = "status" if request.url.path == RUNTIME_STATUS_PATH else "synthesize"
    binding = {"window_id": window_id, "child_id": child_id,
               "operation": operation, "body_sha256": body_hash}
    payload = json.dumps({**binding, "broker_origin": broker_origin,
                          "runtime_origin": app.state.runtime_origin},
                         sort_keys=True, separators=(",", ":")).encode()
    headers, nonce = _internal_headers(_sha(payload), ALLOCATION_PATH)
    try:
        status, response_headers, body = await _bounded_response(
            app.state.admission_client, "POST", origin + ALLOCATION_PATH,
            MAX_ADMISSION_BYTES, content=payload, headers=headers)
        expected = _signature(app.state.secret, (PROTOCOL, "response", ALLOCATION_PATH,
                              nonce, str(status), _sha(body)))
        if status != 200 or not hmac.compare_digest(
                expected, response_headers.get("x-vyakti-response-signature", "")):
            raise ValueError("admission rejected")
        value = json.loads(body)
        if (not isinstance(value, dict) or value.get("authorized") is not True
                or set(value) != {"authorized", "dispatch_not_after", *binding}
                or any(value.get(key) != expected_value for key, expected_value in binding.items())):
            raise ValueError("admission binding mismatch")
        return _dispatch_deadline(value["dispatch_not_after"])
    except Exception as exc:
        # No raw database/provider error or ambiguous response authorizes GPU IO.
        raise BrokerError("voice_allocation_admission_denied", 503) from exc


async def _runtime_is_ready(dispatch_deadline: float) -> bool:
    try:
        _check_dispatch_deadline(dispatch_deadline)
        status, _, body = await _bounded_response(
            app.state.wake_client, "GET", f"{app.state.runtime_origin}/healthz", 4096)
        return status == 200 and json.loads(body).get("ready") is True
    except Exception:
        return False


def _internal_headers(body_hash: str, path: str = PATH) -> tuple[dict[str, str], str]:
    timestamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    nonce = secrets.token_urlsafe(24)
    return {
        "content-type": "application/json",
        "x-vyakti-protocol": PROTOCOL,
        "x-vyakti-timestamp": timestamp,
        "x-vyakti-nonce": nonce,
        "x-vyakti-content-sha256": body_hash,
        "x-vyakti-signature": _signature(
            app.state.secret, (PROTOCOL, "POST", path, timestamp, nonce, body_hash)
        ),
    }, nonce


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.secret = _secret()
    application.state.runtime_origin = _runtime_origin()
    application.state.seen_nonces = {}
    application.state.wake_client = httpx.AsyncClient(
        follow_redirects=False, timeout=httpx.Timeout(8.0, connect=5.0)
    )
    application.state.runtime_client = httpx.AsyncClient(
        follow_redirects=False, timeout=httpx.Timeout(240.0, connect=10.0)
    )
    application.state.admission_client = httpx.AsyncClient(
        follow_redirects=False, timeout=httpx.Timeout(8.0, connect=5.0)
    )
    application.state.ready = True
    yield
    application.state.ready = False
    await application.state.admission_client.aclose()
    await application.state.wake_client.aclose()
    await application.state.runtime_client.aclose()


app = FastAPI(title="Vyakti Open Voice Admission", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.get("/healthz")
async def health() -> JSONResponse:
    return JSONResponse(status_code=200 if getattr(app.state, "ready", False) else 503, content={"ready": bool(getattr(app.state, "ready", False))})


@app.post(PATH)
async def synthesize(request: Request) -> Response:
    try:
        body, body_hash = await _admit(request)
        dispatch_deadline = await _require_allocation_authority(request, body_hash)
        headers, internal_nonce = _internal_headers(body_hash)
        _check_dispatch_deadline(dispatch_deadline)
        status, response_headers, response_body = await _bounded_response(
            app.state.runtime_client, "POST", f"{app.state.runtime_origin}{PATH}",
            MAX_RESPONSE_BYTES, content=body, headers=headers)
        expected = _signature(app.state.secret, (PROTOCOL, "response", PATH, internal_nonce, str(status), _sha(response_body)))
        if not hmac.compare_digest(expected, response_headers.get("x-vyakti-response-signature", "")):
            raise BrokerError("runtime_response_signature_invalid", 503)
        if status != 200:
            raise BrokerError("open_voice_runtime_failed", 503)
        return _signed_response(request, response_body, status)
    except BrokerError as error:
        return _signed_error(request, error.code, error.status)
    except Exception:
        return _signed_error(request, "open_voice_runtime_unreachable", 503)


@app.post(RUNTIME_STATUS_PATH)
async def runtime_status(request: Request) -> Response:
    """Return private-runtime readiness only after the caller passes HMAC admission.

    The GPU app remains internal. This endpoint is intentionally a signed POST,
    not a public health route: unauthenticated traffic is rejected before the
    broker probes the private origin, so it cannot wake billable GPU capacity.
    """
    try:
        body, body_hash = await _admit(request)
        try:
            value = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BrokerError("runtime_status_request_invalid", 400) from exc
        if value != {"op": "runtime_status"}:
            raise BrokerError("runtime_status_request_invalid", 400)
        dispatch_deadline = await _require_allocation_authority(request, body_hash)
        if not await _runtime_is_ready(dispatch_deadline):
            raise BrokerError("open_voice_runtime_warming", 503)
        ready = json.dumps({"ready": True}, sort_keys=True, separators=(",", ":")).encode()
        return _signed_response(request, ready, 200)
    except BrokerError as error:
        return _signed_error(request, error.code, error.status)
    except Exception:
        return _signed_error(request, "open_voice_runtime_unreachable", 503)
