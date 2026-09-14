"""Bounded identity capture decoding. Standard library only; no model imports.

The authenticated application supplies the capture and opaque challenge hash.
No caller-supplied audio derivative, crop, transcript or recognition hint exists.
"""

import base64
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import wave
from pathlib import Path

SCHEMA = "vyakti.identity-audio.v1"
TRANSFORM_VERSION = "capture-to-pcm24k-v1"
RATE = 24_000
MAX_FRAMES = RATE * 30
MAX_CAPTURE_BYTES = 32 * 1024 * 1024
SHA_RE = re.compile(r"[0-9a-f]{64}")
KEY_RE = re.compile(r"[a-z0-9][a-z0-9._-]{0,79}")
PARAMETERS = {"sample_rate_hz": RATE, "channels": 1, "sample_format": "pcm_s16le",
              "max_frames": MAX_FRAMES, "stream_policy": "one-video-one-audio",
              "trim": False, "pad": False, "denoise": False}


class IdentityAudioError(Exception):
    def __init__(self, code, status=422):
        super().__init__(code)
        self.code, self.status = code, status


def _fail(code, status=422):
    raise IdentityAudioError(code, status)


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def _tool(name):
    path = shutil.which(name)
    if not path:
        _fail("identity_audio_decoder_unavailable", 503)
    return path


def _run(argv, output_path=None, max_output=65_536, timeout=15):
    """Bound process time and output while it runs; never accept a capped decode."""
    with tempfile.TemporaryFile() as stdout:
        try:
            proc = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=stdout,
                                    stderr=subprocess.DEVNULL, shell=False)
        except OSError:
            _fail("identity_audio_decoder_unavailable", 503)
        deadline = time.monotonic() + timeout
        try:
            while proc.poll() is None:
                size = Path(output_path).stat().st_size if output_path and Path(output_path).exists() else os.fstat(stdout.fileno()).st_size
                if size > max_output:
                    _fail("identity_audio_output_too_large", 413)
                if time.monotonic() >= deadline:
                    _fail("identity_audio_decode_timeout", 503)
                time.sleep(0.01)
            size = Path(output_path).stat().st_size if output_path and Path(output_path).exists() else os.fstat(stdout.fileno()).st_size
            if size > max_output:
                _fail("identity_audio_output_too_large", 413)
            if proc.returncode != 0:
                _fail("identity_audio_decode_failed")
            stdout.seek(0)
            return stdout.read(max_output + 1)
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.wait()


def validate_capture(payload, max_capture_bytes=MAX_CAPTURE_BYTES):
    if not isinstance(payload, dict) or set(payload) != {"operation", "inputs", "challenge_contract_sha256"}:
        _fail("identity_audio_request_invalid")
    contract = payload["challenge_contract_sha256"]
    if payload["operation"] != "identity_audio_v1" or not isinstance(contract, str) or not SHA_RE.fullmatch(contract):
        _fail("identity_audio_contract_invalid")
    inputs = payload["inputs"]
    if not isinstance(inputs, list) or len(inputs) != 1 or not isinstance(inputs[0], dict):
        _fail("identity_audio_input_invalid")
    entry = inputs[0]
    if set(entry) - {"input_key", "sha256", "mime", "duration_ms", "audio_base64"}:
        _fail("identity_audio_input_invalid")
    input_key = entry.get("input_key")
    if not isinstance(input_key, str) or not KEY_RE.fullmatch(input_key) or entry.get("mime") not in {"video/webm", "video/mp4"}:
        _fail("identity_audio_input_invalid")
    digest = entry.get("sha256", "")
    encoded = entry.get("audio_base64", "")
    limit = min(MAX_CAPTURE_BYTES, max_capture_bytes)
    if not isinstance(encoded, str) or len(encoded) > 4 * ((limit + 2) // 3):
        _fail("identity_audio_capture_too_large", 413)
    try:
        capture = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        _fail("identity_audio_capture_invalid")
    if not capture or len(capture) > limit:
        _fail("identity_audio_capture_too_large", 413)
    if not isinstance(digest, str) or not SHA_RE.fullmatch(digest) or _sha(capture) != digest:
        _fail("identity_audio_capture_integrity_invalid")
    return entry, capture


def validate_streams(probe, mime):
    streams = probe.get("streams") if isinstance(probe, dict) else None
    if not isinstance(streams, list) or len(streams) != 2 or any(not isinstance(s, dict) for s in streams):
        _fail("identity_audio_streams_invalid")
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    video = [s for s in streams if s.get("codec_type") == "video"]
    if len(audio) != 1 or len(video) != 1:
        _fail("identity_audio_streams_invalid")
    audio, video = audio[0], video[0]
    allowed = {"video/webm": ({"opus"}, {"vp8", "vp9"}, "webm"),
               "video/mp4": ({"aac"}, {"h264"}, "mp4")}[mime]
    formats = str(probe.get("format", {}).get("format_name", "")).split(",")
    if audio.get("codec_name") not in allowed[0] or video.get("codec_name") not in allowed[1] or allowed[2] not in formats:
        _fail("identity_audio_codec_unsupported")
    index = audio.get("index")
    if type(index) is not int or index < 0 or type(audio.get("channels")) is not int or not 1 <= audio["channels"] <= 2:
        _fail("identity_audio_streams_invalid")
    # Duration headers are not authority. The decoded frame count below is.
    return index


def pcm_to_wav(pcm):
    if not pcm or len(pcm) % 2:
        _fail("identity_audio_pcm_invalid")
    frames = len(pcm) // 2
    if frames > MAX_FRAMES:
        _fail("identity_audio_duration_invalid", 413)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(pcm)
    return output.getvalue(), frames


def decode_capture(payload, max_capture_bytes=MAX_CAPTURE_BYTES):
    entry, capture = validate_capture(payload, max_capture_bytes)
    ffmpeg, ffprobe = _tool("ffmpeg"), _tool("ffprobe")
    decoder = {}
    for name, tool in (("ffmpeg", ffmpeg), ("ffprobe", ffprobe)):
        version = _run([tool, "-version"], timeout=5).decode("utf-8", "replace").splitlines()
        if not version or not version[0].startswith(name + " version "):
            _fail("identity_audio_decoder_version_invalid", 503)
        decoder[name] = version[0][:512]
    with tempfile.TemporaryDirectory(prefix="identity-audio-") as directory:
        source, output = Path(directory) / "capture", Path(directory) / "decoded.pcm"
        source.write_bytes(capture)
        demuxer = "matroska" if entry["mime"] == "video/webm" else "mov"
        # Force local container demuxers. MOV data references remain disabled.
        input_options = ["-protocol_whitelist", "file", "-f", demuxer]
        if demuxer == "mov":
            input_options += ["-enable_drefs", "0", "-use_absolute_path", "0"]
        raw = _run([ffprobe, "-v", "error", *input_options, "-show_entries",
                    "stream=index,codec_type,codec_name,channels:format=format_name", "-of", "json", str(source)])
        try:
            probe = json.loads(raw)
        except (ValueError, UnicodeError):
            _fail("identity_audio_probe_invalid")
        stream = validate_streams(probe, entry["mime"])
        _run([ffmpeg, "-nostdin", "-y", "-v", "error", "-xerror", *input_options,
              "-i", str(source), "-map", f"0:{stream}", "-vn", "-sn", "-dn",
              "-ac", "1", "-ar", str(RATE), "-c:a", "pcm_s16le", "-f", "s16le", str(output)],
             output_path=output, max_output=MAX_FRAMES * 2)
        if not output.is_file():
            _fail("identity_audio_decode_failed")
        wav, frames = pcm_to_wav(output.read_bytes())
    return {"schema": SCHEMA, "challenge_contract_sha256": payload["challenge_contract_sha256"],
            "parent_sha256": entry["sha256"],
            "canonical": {"audio_base64": base64.b64encode(wav).decode(), "sha256": _sha(wav),
                          "byte_size": len(wav), "mime": "audio/wav", "sample_rate_hz": RATE,
                          "channels": 1, "sample_format": "pcm_s16le", "frames": frames,
                          "duration_ms": frames * 1000 / RATE},
            "transform": {"name": "capture-audio", "version": TRANSFORM_VERSION,
                          "parameters": dict(PARAMETERS), "parameter_sha256": _sha(_canonical(PARAMETERS)),
                          "decoder": decoder, "input_stream_index": stream}}


def measure_identity_audio(payload, measure, max_capture_bytes=MAX_CAPTURE_BYTES):
    decoded = decode_capture(payload, max_capture_bytes)
    canonical = decoded["canonical"]
    # The speaker caller receives exactly the serialized bytes returned for ASR.
    evidence = measure({"inputs": [{"input_key": payload["inputs"][0]["input_key"],
                       "sha256": canonical["sha256"], "mime": canonical["mime"],
                       "duration_ms": canonical["duration_ms"], "audio_base64": canonical["audio_base64"]}]})
    return {**decoded, "speaker_input_sha256": canonical["sha256"],
            **{key: evidence[key] for key in ("embeddings", "confidence", "measurements", "quality", "model_revisions")}}
