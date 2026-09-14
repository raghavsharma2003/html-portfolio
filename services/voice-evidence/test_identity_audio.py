"""CPU-only decoder and isolated real handler tests; no speaker models loaded."""
import ast
import asyncio
import base64
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch
import wave

import identity_audio as identity


def capture_payload(data=b"capture", mime="video/webm"):
    return {"operation": "identity_audio_v1", "challenge_contract_sha256": "a" * 64,
            "inputs": [{"input_key": "input-1", "sha256": hashlib.sha256(data).hexdigest(),
                        "mime": mime, "audio_base64": base64.b64encode(data).decode()}]}


def probe(audio=None, video=None):
    return {"streams": [video or {"index": 0, "codec_type": "video", "codec_name": "vp8"},
                        audio or {"index": 1, "codec_type": "audio", "codec_name": "opus", "channels": 1}],
            "format": {"format_name": "matroska,webm"}}


class ContractTests(unittest.TestCase):
    def test_ui_and_backend_capture_ceiling_share_thirty_second_contract(self):
        studio = (Path(__file__).parents[2] / "src" / "studio" / "LivenessCapture.tsx").read_text(encoding="utf-8")
        creator = (Path(__file__).parents[2] / "src" / "creatorStudio" / "LivenessCapture.tsx").read_text(encoding="utf-8")
        for source in (studio, creator):
            self.assertIn("MAX_LIVENESS_CAPTURE_MS = 25_000", source)
            self.assertIn("setTimeout(() => stopRecording(), MAX_LIVENESS_CAPTURE_MS)", source)
            self.assertNotIn("setTimeout(() => stopRecording(), 60_000)", source)
            self.assertNotIn("MAX_LIVENESS_CAPTURE_MS = 30_000", source)
        self.assertEqual(identity.MAX_FRAMES, identity.RATE * 30)

    def assertCode(self, code, call):
        with self.assertRaises(identity.IdentityAudioError) as caught:
            call()
        self.assertEqual(caught.exception.code, code)

    def test_capture_hash_is_checked_before_tools(self):
        payload = capture_payload()
        payload["inputs"][0]["sha256"] = "b" * 64
        with patch.object(identity, "_tool") as tool:
            self.assertCode("identity_audio_capture_integrity_invalid", lambda: identity.decode_capture(payload))
            tool.assert_not_called()

    def test_valid_input_bytes_and_parent_hash(self):
        entry, data = identity.validate_capture(capture_payload())
        self.assertEqual(data, b"capture")
        self.assertEqual(entry["sha256"], hashlib.sha256(data).hexdigest())

    def test_independent_audio_or_extra_fields_cannot_enter_request(self):
        for key in ("transcript", "canonical", "crop", "recognized_text", "nonce"):
            payload = {**capture_payload(), key: "forged"}
            self.assertCode("identity_audio_request_invalid", lambda: identity.validate_capture(payload))

    def test_unknown_input_field_cannot_supply_derivative(self):
        payload = capture_payload()
        payload["inputs"][0]["canonical_sha256"] = "b" * 64
        self.assertCode("identity_audio_input_invalid", lambda: identity.validate_capture(payload))

    def test_contract_and_input_count(self):
        payload = capture_payload()
        payload["challenge_contract_sha256"] = "not-a-hash"
        self.assertCode("identity_audio_contract_invalid", lambda: identity.validate_capture(payload))
        payload["challenge_contract_sha256"] = int("1" * 64)
        self.assertCode("identity_audio_contract_invalid", lambda: identity.validate_capture(payload))
        payload = capture_payload()
        payload["inputs"] *= 2
        self.assertCode("identity_audio_input_invalid", lambda: identity.validate_capture(payload))

    def test_bounded_base64_and_missing_decoder(self):
        self.assertCode("identity_audio_capture_too_large", lambda: identity.validate_capture(capture_payload(), 2))
        payload = capture_payload()
        payload["inputs"][0]["audio_base64"] = "!invalid!"
        self.assertCode("identity_audio_capture_invalid", lambda: identity.validate_capture(payload))
        with patch.object(identity.shutil, "which", return_value=None):
            self.assertCode("identity_audio_decoder_unavailable", lambda: identity.decode_capture(capture_payload()))

    def test_stream_policy_rejects_missing_multiple_or_wrong_codecs(self):
        self.assertEqual(identity.validate_streams(probe(), "video/webm"), 1)
        for bad in ({"streams": []}, {"streams": probe()["streams"] * 2},
                    probe(video={"index": 0, "codec_type": "audio", "codec_name": "opus"})):
            self.assertCode("identity_audio_streams_invalid", lambda: identity.validate_streams(bad, "video/webm"))
        self.assertCode("identity_audio_codec_unsupported",
                        lambda: identity.validate_streams(probe(audio={"index": 1, "codec_type": "audio", "codec_name": "mp3"}), "video/webm"))

    def test_pcm_exact_thirty_seconds_and_one_extra_frame(self):
        wav_bytes, frames = identity.pcm_to_wav(b"\0\0" * identity.MAX_FRAMES)
        with wave.open(io.BytesIO(wav_bytes), "rb") as wav:
            self.assertEqual((wav.getnframes(), wav.getframerate(), wav.getnchannels(), wav.getsampwidth()),
                             (identity.MAX_FRAMES, 24000, 1, 2))
        self.assertEqual(frames, identity.MAX_FRAMES)
        self.assertCode("identity_audio_duration_invalid",
                        lambda: identity.pcm_to_wav(b"\0\0" * (identity.MAX_FRAMES + 1)))
        self.assertCode("identity_audio_pcm_invalid", lambda: identity.pcm_to_wav(b"\0"))

    def test_subprocess_exit_timeout_and_output_limit(self):
        self.assertCode("identity_audio_decode_failed", lambda: identity._run([sys.executable, "-c", "raise SystemExit(1)"]))
        self.assertCode("identity_audio_decode_timeout", lambda: identity._run([sys.executable, "-c", "import time; time.sleep(5)"], timeout=0.02))
        self.assertCode("identity_audio_output_too_large", lambda: identity._run([sys.executable, "-c", "print('x' * 10000)"], max_output=10))


def handler_namespace():
    """Compile actual service functions without importing GPU/model packages.

    This exercises actual operation selection, request authentication, response
    signing and the _identity_audio -> measure_identity_audio caller. Embeddings
    below are an explicitly injected spy, never reported as real model output.
    """
    class Response:
        def __init__(self, body, status_code=200, media_type=None):
            self.body, self.status_code, self.headers = body, status_code, {}

    class App:
        state = types.SimpleNamespace(transport_secret=b"x" * 32, seen_nonces={})

        def post(self, path):
            self.path = path
            return lambda fn: fn

    app = App()
    app.state = types.SimpleNamespace(transport_secret=b"x" * 32, seen_nonces={})
    source = ast.parse((Path(__file__).parent / "app.py").read_text(encoding="utf-8"))
    names = {"ServiceError", "_sha", "_signature", "_signed_response", "_verified_json", "_identity_audio", "analyze"}
    selected = [node for node in source.body if getattr(node, "name", "") in names]
    assert len(selected) == len(names)
    namespace = {"app": app, "Response": Response, "Request": object, "Any": object,
                 "IdentityAudioError": identity.IdentityAudioError, "measure_identity_audio": identity.measure_identity_audio,
                 "PROTOCOL": "vyakti-voice-evidence/v1", "MAX_REQUEST_BYTES": 72 * 1024 * 1024,
                 "MAX_AUDIO_BYTES": identity.MAX_CAPTURE_BYTES, "MAX_CLOCK_SKEW_SECONDS": 60,
                 "_canonical": identity._canonical, "hashlib": hashlib, "base64": base64,
                 "hmac": hmac, "json": json, "time": time, "re": __import__("re")}
    for op in ("_diarize", "_separate", "_enhance", "_measure"):
        namespace[op] = lambda payload: {"legacy": True}
    exec(compile(ast.Module(body=selected, type_ignores=[]), "app.py", "exec"), namespace)
    return namespace


def call_handler(namespace, payload, nonce="n" * 24, tamper=False):
    from datetime import datetime, timezone
    body = identity._canonical(payload)
    timestamp = datetime.now(timezone.utc).isoformat()
    digest = hashlib.sha256(body).hexdigest()
    headers = {"x-vyakti-protocol": namespace["PROTOCOL"], "x-vyakti-timestamp": timestamp,
               "x-vyakti-nonce": nonce, "x-vyakti-content-sha256": digest,
               "x-vyakti-signature": namespace["_signature"](b"x" * 32, namespace["PROTOCOL"], "POST", "/v1/analyze", timestamp, nonce, digest)}
    if tamper:
        headers["x-vyakti-signature"] = "invalid"

    async def get_body():
        return body
    request = types.SimpleNamespace(headers=headers, url=types.SimpleNamespace(path="/v1/analyze"), method="POST", body=get_body)
    response = asyncio.run(namespace["analyze"](request))
    expected = namespace["_signature"](b"x" * 32, namespace["PROTOCOL"], "response", "/v1/analyze", nonce,
                                       str(response.status_code), hashlib.sha256(response.body).hexdigest())
    assert response.headers["X-Vyakti-Response-Signature"] == expected
    return response.status_code, json.loads(response.body)


class HandlerTests(unittest.TestCase):
    def test_old_operations_keep_handlers_and_unknown_is_signed_refusal(self):
        for op in ("diarize", "separate", "enhance", "voice_quality"):
            self.assertEqual(call_handler(handler_namespace(), {"operation": op}), (200, {"legacy": True}))
        self.assertEqual(call_handler(handler_namespace(), {"operation": "unknown"}), (403, {"error": "operation_denied"}))

    def test_invalid_signature_and_replay_are_rejected(self):
        ns = handler_namespace()
        self.assertEqual(call_handler(ns, capture_payload(), tamper=True)[0], 401)
        self.assertEqual(call_handler(ns, {"operation": "voice_quality"})[0], 200)
        self.assertEqual(call_handler(ns, {"operation": "voice_quality"})[0], 409)

    def test_identity_contract_failure_is_signed_and_never_calls_measure(self):
        ns = handler_namespace()
        measured = []
        ns["_measure"] = lambda payload: measured.append(payload)
        payload = capture_payload()
        payload["inputs"][0]["sha256"] = "b" * 64
        self.assertEqual(call_handler(ns, payload), (422, {"error": "identity_audio_capture_integrity_invalid"}))
        self.assertEqual(measured, [])


class RealDecodeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
            raise RuntimeError("real CPU decode requires ffmpeg and ffprobe; missing tools are not a passing test")
        cls.directory = tempfile.TemporaryDirectory(prefix="identity-fixtures-")
        cls.addClassCleanup(cls.directory.cleanup)
        cls.root = Path(cls.directory.name)
        cls.fixtures = {}
        for container, duration in (("webm", 1), ("mp4", 1), ("webm", 30), ("mp4", 30), ("webm", 30.02)):
            path = cls.root / f"{duration}.{container}"
            codecs = ["-c:v", "libvpx", "-b:v", "20k", "-c:a", "libopus"] if container == "webm" else ["-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac"]
            subprocess.run([shutil.which("ffmpeg"), "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i",
                            f"color=c=black:s=32x32:r=1:d={duration}", "-f", "lavfi", "-i",
                            f"sine=frequency=440:sample_rate=48000:duration={duration}",
                            "-map", "0:v:0", "-map", "1:a:0", *codecs, "-t", str(duration), str(path)],
                           check=True, capture_output=True, timeout=30)
            cls.fixtures[container, duration] = path.read_bytes()
        # Without MP4 edit-list delay metadata, AAC priming/padding remains in
        # the decoded stream. Keep that real boundary rather than trimming it.
        padded = cls.root / "30-padded.mp4"
        subprocess.run([shutil.which("ffmpeg"), "-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i",
                        "color=c=black:s=32x32:r=1:d=30", "-f", "lavfi", "-i",
                        "sine=frequency=440:sample_rate=48000:duration=30", "-map", "0:v", "-map", "1:a",
                        "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-t", "30",
                        "-use_editlist", "0", str(padded)], check=True, capture_output=True, timeout=30)

    def decode(self, container, duration):
        return identity.decode_capture(capture_payload(self.fixtures[container, duration], f"video/{container}"))

    def test_real_webm_and_mp4_pcm_receipts(self):
        for container in ("webm", "mp4"):
            result = self.decode(container, 1)
            canonical = result["canonical"]
            wav_bytes = base64.b64decode(canonical["audio_base64"])
            self.assertEqual(hashlib.sha256(wav_bytes).hexdigest(), canonical["sha256"])
            self.assertEqual(result["parent_sha256"], hashlib.sha256(self.fixtures[container, 1]).hexdigest())
            with wave.open(io.BytesIO(wav_bytes), "rb") as wav:
                self.assertEqual((wav.getnframes(), wav.getframerate(), wav.getnchannels(), wav.getsampwidth()),
                                 (canonical["frames"], 24000, 1, 2))
            self.assertGreater(canonical["frames"], 0)
            self.assertLessEqual(canonical["frames"], identity.MAX_FRAMES)
            self.assertEqual(canonical["byte_size"], len(wav_bytes))
            self.assertEqual(result["transform"]["parameter_sha256"], identity._sha(identity._canonical(identity.PARAMETERS)))
            self.assertTrue(result["transform"]["decoder"]["ffmpeg"].startswith("ffmpeg version "))

    def test_real_duration_boundary_and_aac_padding(self):
        for container in ("webm", "mp4"):
            source = self.root / f"30.{container}"
            # Independent uncapped reference decode counts ALL samples, including
            # AAC padding. The production path must refuse, never crop, if >30s.
            raw = subprocess.run([shutil.which("ffmpeg"), "-nostdin", "-v", "error", "-i", str(source),
                                  "-map", "0:a:0", "-ac", "1", "-ar", "24000", "-f", "s16le", "pipe:1"],
                                 check=True, capture_output=True, timeout=30).stdout
            frames = len(raw) // 2
            print(f"REAL_BOUNDARY {container}: decoded_frames={frames} duration_ms={frames * 1000 / 24000}", flush=True)
            if frames > identity.MAX_FRAMES:
                with self.assertRaises(identity.IdentityAudioError) as caught:
                    self.decode(container, 30)
                self.assertEqual(caught.exception.status, 413)
            else:
                self.assertEqual(self.decode(container, 30)["canonical"]["frames"], frames)
        with self.assertRaises(identity.IdentityAudioError) as caught:
            self.decode("webm", 30.02)
        self.assertEqual(caught.exception.status, 413)

    def test_real_aac_padding_above_thirty_seconds_is_not_trimmed(self):
        source = self.root / "30-padded.mp4"
        raw = subprocess.run([shutil.which("ffmpeg"), "-nostdin", "-v", "error", "-i", str(source),
                              "-map", "0:a:0", "-ac", "1", "-ar", "24000", "-f", "s16le", "pipe:1"],
                             check=True, capture_output=True, timeout=30).stdout
        frames = len(raw) // 2
        print(f"REAL_AAC_PADDING: decoded_frames={frames} duration_ms={frames * 1000 / 24000}", flush=True)
        self.assertGreater(frames, identity.MAX_FRAMES, "fixture must expose real AAC delay/padding")
        with self.assertRaises(identity.IdentityAudioError) as caught:
            identity.decode_capture(capture_payload(source.read_bytes(), "video/mp4"))
        self.assertEqual(caught.exception.status, 413)

    def test_real_multiple_audio_streams_and_corrupt_capture_refuse(self):
        path = self.root / "multi.webm"
        subprocess.run([shutil.which("ffmpeg"), "-nostdin", "-y", "-v", "error", "-i", str(self.root / "1.webm"),
                        "-map", "0:v", "-map", "0:a", "-map", "0:a", "-c", "copy", str(path)],
                       check=True, capture_output=True, timeout=30)
        with self.assertRaises(identity.IdentityAudioError) as caught:
            identity.decode_capture(capture_payload(path.read_bytes()))
        self.assertEqual(caught.exception.code, "identity_audio_streams_invalid")
        directories = []
        original_directory = tempfile.TemporaryDirectory
        def tracked_directory(*args, **kwargs):
            directory = original_directory(*args, **kwargs)
            directories.append(directory.name)
            return directory
        with patch.object(identity.tempfile, "TemporaryDirectory", side_effect=tracked_directory):
            with self.assertRaises(identity.IdentityAudioError):
                identity.decode_capture(capture_payload(self.fixtures["webm", 1][:100]))
        self.assertEqual(len(directories), 1)
        self.assertFalse(Path(directories[0]).exists(), "failed decode removes source and temporary directory")

    def test_real_video_without_audio_is_refused(self):
        path = self.root / "no-audio.webm"
        subprocess.run([shutil.which("ffmpeg"), "-nostdin", "-y", "-v", "error", "-i", str(self.root / "1.webm"),
                        "-map", "0:v", "-an", "-c:v", "copy", str(path)],
                       check=True, capture_output=True, timeout=30)
        with self.assertRaises(identity.IdentityAudioError) as caught:
            identity.decode_capture(capture_payload(path.read_bytes()))
        self.assertEqual(caught.exception.code, "identity_audio_streams_invalid")

    def test_actual_decoder_arguments_forbid_protocols_and_trimming(self):
        calls = []
        original_run = identity._run
        def tracked_run(argv, **kwargs):
            calls.append(argv)
            return original_run(argv, **kwargs)
        with patch.object(identity, "_run", side_effect=tracked_run):
            self.decode("mp4", 1)
        media_calls = [argv for argv in calls if "-version" not in argv]
        self.assertEqual(len(media_calls), 2)
        for argv in media_calls:
            self.assertEqual(argv[argv.index("-protocol_whitelist") + 1], "file")
            self.assertEqual(argv[argv.index("-f") + 1], "mov")
            self.assertEqual(argv[argv.index("-enable_drefs") + 1], "0")
            self.assertEqual(argv[argv.index("-use_absolute_path") + 1], "0")
            self.assertFalse(any(flag in argv for flag in ("-t", "-to", "-ss", "-af", "-filter_complex")))
        payload = capture_payload(self.fixtures["webm", 30.02])
        payload["inputs"][0]["duration_ms"] = 1  # Lying metadata cannot hide frames.
        with self.assertRaises(identity.IdentityAudioError) as caught:
            identity.decode_capture(payload)
        self.assertEqual(caught.exception.status, 413)

    def test_real_service_caller_measures_exact_returned_canonical_bytes(self):
        ns, measured = handler_namespace(), []
        def measure(payload):
            measured.append(payload["inputs"][0])
            return {"embeddings": [{"input_key": "input-1", "vector": [0.1], "family": "TEST_SPY_NOT_MODEL"}],
                    "confidence": 0.5, "measurements": {}, "quality": {}, "model_revisions": {"test": "spy-not-model"}}
        ns["_measure"] = measure
        status, result = call_handler(ns, capture_payload(self.fixtures["webm", 1]))
        self.assertEqual(status, 200)
        self.assertEqual(len(measured), 1)
        self.assertEqual(measured[0]["audio_base64"], result["canonical"]["audio_base64"])
        self.assertEqual(measured[0]["sha256"], result["speaker_input_sha256"])
        self.assertEqual(result["model_revisions"], {"test": "spy-not-model"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
