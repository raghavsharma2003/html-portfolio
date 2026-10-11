"""Bake and commit one immutable public VoxCPM2 snapshot."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from huggingface_hub import snapshot_download


MODEL_REPO = "openbmb/VoxCPM2"
MODEL_REVISION = "32279effe8c19989596f05d353d1447f51d9e915"
SOURCE_COMMIT = "f5a1c6a6b901bc732e20f0d59a369f6829ad717a"
MODEL_ROOT = Path(os.getenv("VOXCPM2_MODEL_ROOT", "/models/voxcpm2"))


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


MODEL_ROOT.mkdir(parents=True, exist_ok=True)
snapshot_download(repo_id=MODEL_REPO, revision=MODEL_REVISION, local_dir=MODEL_ROOT)

required = (
    "config.json",
    "model.safetensors",
    "audiovae.pth",
    "tokenizer.json",
    "tokenizer_config.json",
)
missing = [name for name in required if not (MODEL_ROOT / name).is_file()]
if missing:
    raise SystemExit("voxcpm2_snapshot_incomplete:" + ",".join(missing))

files = []
for path in sorted(MODEL_ROOT.rglob("*")):
    if path.is_file() and path.name != ".vyakti-model-manifest.json":
        files.append({
            "path": path.relative_to(MODEL_ROOT).as_posix(),
            "bytes": path.stat().st_size,
            "sha256": _hash_file(path),
        })
manifest = {
    "contract": "vyakti-voxcpm2-model-manifest/v1",
    "model_repo": MODEL_REPO,
    "model_revision": MODEL_REVISION,
    "source_commit": SOURCE_COMMIT,
    "license": "Apache-2.0",
    "files": files,
}
manifest_bytes = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
manifest["commitment"] = hashlib.sha256(manifest_bytes).hexdigest()
(MODEL_ROOT / ".vyakti-model-manifest.json").write_text(
    json.dumps(manifest, sort_keys=True, separators=(",", ":")), encoding="utf-8"
)
