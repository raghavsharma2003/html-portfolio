"""Bake one immutable, public Qwen3-TTS snapshot into the evaluation image."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from huggingface_hub import snapshot_download


MODEL_REPO = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
MODEL_REVISION = "fd4b254389122332181a7c3db7f27e918eec64e3"
SOURCE_COMMIT = "022e286b98fbec7e1e916cb940cdf532cd9f488e"
MODEL_ROOT = Path(os.getenv("QWEN3_TTS_MODEL_ROOT", "/models/qwen3-tts-1.7b-base"))


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


MODEL_ROOT.mkdir(parents=True, exist_ok=True)
snapshot_download(
    repo_id=MODEL_REPO,
    revision=MODEL_REVISION,
    local_dir=MODEL_ROOT,
)

required = (
    "config.json",
    "generation_config.json",
    "model.safetensors",
    "speech_tokenizer/config.json",
    "speech_tokenizer/model.safetensors",
)
missing = [name for name in required if not (MODEL_ROOT / name).is_file()]
if missing:
    raise SystemExit("qwen3_snapshot_incomplete:" + ",".join(missing))

files = []
for path in sorted(MODEL_ROOT.rglob("*")):
    if path.is_file() and path.name != ".vyakti-model-manifest.json":
        files.append({
            "path": path.relative_to(MODEL_ROOT).as_posix(),
            "bytes": path.stat().st_size,
            "sha256": _hash_file(path),
        })
manifest = {
    "contract": "vyakti-qwen3-tts-model-manifest/v1",
    "model_repo": MODEL_REPO,
    "model_revision": MODEL_REVISION,
    "source_commit": SOURCE_COMMIT,
    "files": files,
}
manifest_bytes = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
manifest["commitment"] = hashlib.sha256(manifest_bytes).hexdigest()
(MODEL_ROOT / ".vyakti-model-manifest.json").write_text(
    json.dumps(manifest, sort_keys=True, separators=(",", ":")), encoding="utf-8"
)
