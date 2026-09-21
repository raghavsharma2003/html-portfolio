"""Bake and attest the exact public OpenVoice V2 converter snapshot."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from huggingface_hub import snapshot_download


SOURCE_REPO = "myshell-ai/OpenVoice"
SOURCE_COMMIT = "74a1d147b17a8c3092dd5430504bd83ef6c7eb23"
MODEL_REPO = "myshell-ai/OpenVoiceV2"
MODEL_REVISION = "fd981100305a0e4291f93a9ad169c6d9f7bed54a"
CHECKPOINT_SHA256 = "9652c27e92b6b2a91632590ac9962ef7ae2b712e5c5b7f4c34ec55ee2b37ab9e"
CONFIG_SHA256 = "9dfff60350b8c63f2c664efd92a61b2516efb22671466960f0e5dfebd881fa47"
MODEL_ROOT = Path(
    os.getenv("OPENVOICE_CONVERTER_MODEL_ROOT", "/models/openvoice-v2")
)


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
    allow_patterns=["converter/config.json", "converter/checkpoint.pth"],
)

config_path = MODEL_ROOT / "converter" / "config.json"
checkpoint_path = MODEL_ROOT / "converter" / "checkpoint.pth"
if not config_path.is_file() or not checkpoint_path.is_file():
    raise SystemExit("openvoice_converter_snapshot_incomplete")
if _hash_file(config_path) != CONFIG_SHA256:
    raise SystemExit("openvoice_converter_config_mismatch")
if _hash_file(checkpoint_path) != CHECKPOINT_SHA256:
    raise SystemExit("openvoice_converter_checkpoint_mismatch")

manifest = {
    "contract": "vyakti-openvoice-v2-model-manifest/v1",
    "source_repo": SOURCE_REPO,
    "source_commit": SOURCE_COMMIT,
    "model_repo": MODEL_REPO,
    "model_revision": MODEL_REVISION,
    "checkpoint_sha256": CHECKPOINT_SHA256,
    "checkpoint_bytes": checkpoint_path.stat().st_size,
    "config_sha256": CONFIG_SHA256,
    "config_bytes": config_path.stat().st_size,
}
manifest_bytes = json.dumps(
    manifest, sort_keys=True, separators=(",", ":")
).encode()
manifest["commitment"] = hashlib.sha256(manifest_bytes).hexdigest()
(MODEL_ROOT / ".vyakti-model-manifest.json").write_text(
    json.dumps(manifest, sort_keys=True, separators=(",", ":")),
    encoding="utf-8",
)
