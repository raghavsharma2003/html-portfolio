"""Bake and commit immutable public ZONOS2, speaker encoder and DAC assets."""

from __future__ import annotations

import hashlib
import json
import os
import urllib.request
from pathlib import Path

from huggingface_hub import snapshot_download


MODEL_REPO = "Zyphra/ZONOS2"
MODEL_REVISION = "65f1e80f94b599d474bb6af9094a803dc52f60bd"
MODEL_WEIGHT_BYTES = 15_336_390_655
MODEL_WEIGHT_SHA256 = "5f6aa0fff9036ee44ccbc625d40aa6bdd8ea223480a5447e9f6aad70c38b6ecd"
SPEAKER_REPO = "marksverdhei/Qwen3-Voice-Embedding-12Hz-1.7B"
SPEAKER_REVISION = "7577f61c42737fc8064bba773e2a18602df92803"
SPEAKER_WEIGHT_BYTES = 24_010_000
SPEAKER_WEIGHT_SHA256 = "df60a638e7f4a29331c0af2bd2984ee5b992fee9d5923c776f7e4bdc3dedea48"
SOURCE_COMMIT = "194c0a3ab67b90383a67646289f28d4ecb1c1f64"
DAC_URL = "https://github.com/descriptinc/descript-audio-codec/releases/download/0.0.1/weights.pth"
DAC_BYTES = 306_717_287
DAC_SHA256 = "a88eed82a7024ccc1facdb1e605c4c2f99281c8118c22c9895ffa846d8fb61aa"
MODEL_ROOT = Path(os.getenv("ZONOS2_MODEL_ROOT", "/models/zonos2"))
SPEAKER_ROOT = Path(os.getenv("ZONOS2_SPEAKER_ROOT", "/models/qwen3-speaker"))
DAC_PATH = Path(os.getenv("ZONOS2_DAC_PATH", "/models/dac/weights_44khz_8kbps_0.0.1.pth"))


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _assert_file(path: Path, expected_bytes: int, expected_sha256: str, code: str) -> None:
    if not path.is_file() or path.stat().st_size != expected_bytes or _hash_file(path) != expected_sha256:
        raise SystemExit(code)


MODEL_ROOT.mkdir(parents=True, exist_ok=True)
SPEAKER_ROOT.mkdir(parents=True, exist_ok=True)
DAC_PATH.parent.mkdir(parents=True, exist_ok=True)

snapshot_download(
    repo_id=MODEL_REPO,
    revision=MODEL_REVISION,
    local_dir=MODEL_ROOT,
    allow_patterns=["README.md", "params.json", "model.pth"],
)
snapshot_download(
    repo_id=SPEAKER_REPO,
    revision=SPEAKER_REVISION,
    local_dir=SPEAKER_ROOT,
    allow_patterns=["README.md", "*.json", "*.py", "model.safetensors"],
)

with urllib.request.urlopen(DAC_URL, timeout=120) as response, DAC_PATH.open("wb") as target:
    while chunk := response.read(8 * 1024 * 1024):
        target.write(chunk)

_assert_file(MODEL_ROOT / "model.pth", MODEL_WEIGHT_BYTES, MODEL_WEIGHT_SHA256, "zonos2_weight_commitment_mismatch")
_assert_file(SPEAKER_ROOT / "model.safetensors", SPEAKER_WEIGHT_BYTES, SPEAKER_WEIGHT_SHA256, "zonos2_speaker_weight_commitment_mismatch")
_assert_file(DAC_PATH, DAC_BYTES, DAC_SHA256, "zonos2_dac_commitment_mismatch")
for path in (MODEL_ROOT / "README.md", MODEL_ROOT / "params.json", SPEAKER_ROOT / "README.md", SPEAKER_ROOT / "config.json", SPEAKER_ROOT / "modeling_ecapa_tdnn.py"):
    if not path.is_file():
        raise SystemExit("zonos2_snapshot_incomplete:" + path.name)

files = []
for scope, root in (("model", MODEL_ROOT), ("speaker", SPEAKER_ROOT)):
    for path in sorted(root.rglob("*")):
        if path.is_file() and ".cache" not in path.parts and path.name != ".vyakti-model-manifest.json":
            files.append({
                "scope": scope,
                "path": path.relative_to(root).as_posix(),
                "bytes": path.stat().st_size,
                "sha256": _hash_file(path),
            })
files.append({"scope": "dac", "path": DAC_PATH.name, "bytes": DAC_BYTES, "sha256": DAC_SHA256})

manifest = {
    "contract": "vyakti-zonos2-model-manifest/v1",
    "model_repo": MODEL_REPO,
    "model_revision": MODEL_REVISION,
    "model_license": "Apache-2.0",
    "speaker_repo": SPEAKER_REPO,
    "speaker_revision": SPEAKER_REVISION,
    "speaker_license": "Apache-2.0",
    "source_commit": SOURCE_COMMIT,
    "source_license": "MIT",
    "dac_release": "descript-audio-codec/0.0.1/44khz-8kbps",
    "dac_sha256": DAC_SHA256,
    "dac_license": "MIT",
    "files": files,
}
manifest_bytes = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
manifest["commitment"] = hashlib.sha256(manifest_bytes).hexdigest()
(MODEL_ROOT / ".vyakti-model-manifest.json").write_text(
    json.dumps(manifest, sort_keys=True, separators=(",", ":")), encoding="utf-8"
)
