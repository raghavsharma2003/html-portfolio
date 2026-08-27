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
        app.state.secret, (PROTOCOL, "response", PATH, nonce, str(status), _sha(body))
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


async def _runtime_is_ready() -> bool:
    try:
        response = await app.state.wake_client.get(f"{app.state.runtime_origin}/healthz")
        return response.status_code == 200 and bool(response.json().get("ready"))
    except Exception:
        return False


def _internal_headers(body_hash: str) -> tuple[dict[str, str], str]:
    timestamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    nonce = secrets.token_urlsafe(24)
    return {
        "content-type": "application/json",
        "x-vyakti-protocol": PROTOCOL,
        "x-vyakti-timestamp": timestamp,
        "x-vyakti-nonce": nonce,
        "x-vyakti-content-sha256": body_hash,
        "x-vyakti-signature": _signature(
            app.state.secret, (PROTOCOL, "POST", PATH, timestamp, nonce, body_hash)
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
    application.state.ready = True
    yield
    application.state.ready = False
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
        if not await _runtime_is_ready():
            raise BrokerError("open_voice_runtime_warming", 503)
        headers, internal_nonce = _internal_headers(body_hash)
        upstream = await app.state.runtime_client.post(
            f"{app.state.runtime_origin}{PATH}", content=body, headers=headers
        )
        response_body = upstream.content
        if not response_body or len(response_body) > MAX_RESPONSE_BYTES:
            raise BrokerError("runtime_response_size_invalid", 503)
        expected = _signature(app.state.secret, (PROTOCOL, "response", PATH, internal_nonce, str(upstream.status_code), _sha(response_body)))
        if not hmac.compare_digest(expected, upstream.headers.get("x-vyakti-response-signature", "")):
            raise BrokerError("runtime_response_signature_invalid", 503)
        return _signed_response(request, response_body, upstream.status_code)
    except BrokerError as error:
        return _signed_error(request, error.code, error.status)
    except Exception:
        return _signed_error(request, "open_voice_runtime_unreachable", 503)
