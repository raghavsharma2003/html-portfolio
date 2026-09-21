"""Bake and commit the two immutable public MOSS-TTS v1.5 snapshots."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from huggingface_hub import snapshot_download


MODEL_REPO = "OpenMOSS-Team/MOSS-TTS-Local-Transformer-v1.5"
MODEL_REVISION = "be7766a6735b98bd793f7c79fb720b4d0f5d13b8"
CODEC_REPO = "OpenMOSS-Team/MOSS-Audio-Tokenizer-v2"
CODEC_REVISION = "f6e20e543b33d2c252a7ef71bdf8aa71e5ff9169"
SOURCE_COMMIT = "58b20a0d5fcc6766658d50967a90a9d890009a46"
MODEL_ROOT = Path(os.getenv("MOSS_TTS_MODEL_ROOT", "/models/moss-tts-local-v1.5"))
CODEC_ROOT = Path(os.getenv("MOSS_TTS_CODEC_ROOT", "/models/moss-audio-tokenizer-v2"))

EXPECTED_WEIGHTS = {
    (MODEL_ROOT, "model.safetensors"): (9_100_859_544, "608f1ff64bc6caa9be836060fc7c78a15c4658c4a07b8d73c78d6f70d1b39c23"),
    (CODEC_ROOT, "model-00001-of-00003.safetensors"): (3_978_639_168, "2d9f9182f17b143a23937feb87c63c08221bd28e685e4bc2fa55dcdce17fcde7"),
    (CODEC_ROOT, "model-00002-of-00003.safetensors"): (3_992_738_352, "d4e48106d0254fe3b00ea0707e88fc6aee076993825e108dd9cef847f9db236e"),
    (CODEC_ROOT, "model-00003-of-00003.safetensors"): (523_681_336, "d0449fe1b0ef1f6045946867148d8166b9a91a58d0feca4a18b641494d0b22da"),
}


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(4 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


MODEL_ROOT.mkdir(parents=True, exist_ok=True)
CODEC_ROOT.mkdir(parents=True, exist_ok=True)
snapshot_download(
    repo_id=MODEL_REPO,
    revision=MODEL_REVISION,
    local_dir=MODEL_ROOT,
    allow_patterns=[
        "*.json", "*.jinja", "*.py", "*.txt", "model.safetensors",
    ],
)
snapshot_download(
    repo_id=CODEC_REPO,
    revision=CODEC_REVISION,
    local_dir=CODEC_ROOT,
    allow_patterns=[
        "*.json", "*.py", "LICENSE", "model-*.safetensors",
    ],
)

required = {
    MODEL_ROOT: (
        "config.json", "model.safetensors", "tokenizer.json", "tokenizer_config.json",
        "processing_moss_tts.py", "modeling_moss_tts.py", "configuration_moss_tts.py",
        "qwen3_decoder.py", "gpt2_decoder.py",
    ),
    CODEC_ROOT: (
        "config.json", "model.safetensors.index.json", "configuration_moss_audio_tokenizer.py",
        "modeling_moss_audio_tokenizer.py", "model-00001-of-00003.safetensors",
        "model-00002-of-00003.safetensors", "model-00003-of-00003.safetensors",
    ),
}
for root, names in required.items():
    missing = [name for name in names if not (root / name).is_file()]
    if missing:
        raise SystemExit("moss_tts_snapshot_incomplete:" + ",".join(missing))

for (root, name), (expected_bytes, expected_sha256) in EXPECTED_WEIGHTS.items():
    path = root / name
    if path.stat().st_size != expected_bytes or _hash_file(path) != expected_sha256:
        raise SystemExit("moss_tts_weight_commitment_mismatch:" + name)

files = []
for scope, root in (("model", MODEL_ROOT), ("codec", CODEC_ROOT)):
    for path in sorted(root.rglob("*")):
        if path.is_file() and ".cache" not in path.parts and path.name != ".vyakti-model-manifest.json":
            files.append({
                "scope": scope,
                "path": path.relative_to(root).as_posix(),
                "bytes": path.stat().st_size,
                "sha256": _hash_file(path),
            })
manifest = {
    "contract": "vyakti-moss-tts-model-manifest/v1",
    "model_repo": MODEL_REPO,
    "model_revision": MODEL_REVISION,
    "codec_repo": CODEC_REPO,
    "codec_revision": CODEC_REVISION,
    "source_commit": SOURCE_COMMIT,
    "license": "Apache-2.0",
    "files": files,
}
manifest_bytes = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
manifest["commitment"] = hashlib.sha256(manifest_bytes).hexdigest()
(MODEL_ROOT / ".vyakti-model-manifest.json").write_text(
    json.dumps(manifest, sort_keys=True, separators=(",", ":")), encoding="utf-8"
)
