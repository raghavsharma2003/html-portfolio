"""Bake the exact gated IndicF5 and public Vocos revisions into the image."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from huggingface_hub import snapshot_download


MODEL_REPO = "ai4bharat/IndicF5"
MODEL_REVISION = "ba85abedf18dc479a447eaa0eccbd76ab78a47d5"
VOCODER_REPO = "charactr/vocos-mel-24khz"
VOCODER_REVISION = "0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21"
SOURCE_COMMIT = "13f7c4d627cc10111aea8fe9c0039462cacacdc7"
MODEL_ROOT = Path(os.getenv("INDICF5_MODEL_ROOT", "/models/indicf5"))
VOCODER_ROOT = Path(os.getenv("INDICF5_VOCODER_ROOT", "/models/vocos"))


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


token = os.getenv("HF_TOKEN", "").strip()
if not token:
    raise SystemExit("indicf5_hf_token_required")

MODEL_ROOT.mkdir(parents=True, exist_ok=True)
snapshot_download(
    repo_id=MODEL_REPO,
    revision=MODEL_REVISION,
    token=token,
    local_dir=MODEL_ROOT,
)
snapshot_download(
    repo_id=VOCODER_REPO,
    revision=VOCODER_REVISION,
    token=token,
    local_dir=VOCODER_ROOT,
)

required = ("config.json", "model.py", "model.safetensors", "checkpoints/vocab.txt")
missing = [name for name in required if not (MODEL_ROOT / name).is_file()]
if missing:
    raise SystemExit("indicf5_snapshot_incomplete:" + ",".join(missing))

vocoder_required = ("config.yaml", "pytorch_model.bin")
vocoder_missing = [name for name in vocoder_required if not (VOCODER_ROOT / name).is_file()]
if vocoder_missing:
    raise SystemExit("indicf5_vocoder_snapshot_incomplete:" + ",".join(vocoder_missing))

files = []
for path in sorted(MODEL_ROOT.rglob("*")):
    if path.is_file() and path.name != ".vyakti-model-manifest.json":
        files.append({
            "path": path.relative_to(MODEL_ROOT).as_posix(),
            "bytes": path.stat().st_size,
            "sha256": _hash_file(path),
        })
vocoder_files = []
for path in sorted(VOCODER_ROOT.rglob("*")):
    if path.is_file():
        vocoder_files.append({
            "path": path.relative_to(VOCODER_ROOT).as_posix(),
            "bytes": path.stat().st_size,
            "sha256": _hash_file(path),
        })
manifest = {
    "contract": "vyakti-indicf5-model-manifest/v1",
    "model_repo": MODEL_REPO,
    "model_revision": MODEL_REVISION,
    "source_commit": SOURCE_COMMIT,
    "vocoder_repo": VOCODER_REPO,
    "vocoder_revision": VOCODER_REVISION,
    "files": files,
    "vocoder_files": vocoder_files,
}
manifest_bytes = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
manifest["commitment"] = hashlib.sha256(manifest_bytes).hexdigest()
(MODEL_ROOT / ".vyakti-model-manifest.json").write_text(
    json.dumps(manifest, sort_keys=True, separators=(",", ":")), encoding="utf-8"
)
