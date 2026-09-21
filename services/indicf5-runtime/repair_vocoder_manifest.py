"""Repair the first immutable image without fetching gated or public bytes again."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
from pathlib import Path


VOCODER_REVISION = "0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21"
MODEL_ROOT = Path(os.getenv("INDICF5_MODEL_ROOT", "/models/indicf5"))
VOCODER_ROOT = Path(os.getenv("INDICF5_VOCODER_ROOT", "/models/vocos"))
VOCODER_CACHE_ROOT = Path(os.getenv(
    "INDICF5_VOCODER_CACHE_ROOT",
    f"/models/huggingface/hub/models--charactr--vocos-mel-24khz/snapshots/{VOCODER_REVISION}",
))


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def repair() -> None:
    manifest_path = MODEL_ROOT / ".vyakti-model-manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit("indicf5_base_manifest_required") from exc
    if manifest.get("vocoder_revision") != VOCODER_REVISION:
        raise SystemExit("indicf5_base_vocoder_revision_mismatch")
    if not (MODEL_ROOT / "checkpoints" / "vocab.txt").is_file():
        raise SystemExit("indicf5_baked_vocab_missing")

    VOCODER_ROOT.mkdir(parents=True, exist_ok=True)
    for name in ("config.yaml", "pytorch_model.bin"):
        source = VOCODER_CACHE_ROOT / name
        if not source.is_file():
            raise SystemExit("indicf5_baked_vocoder_missing:" + name)
        shutil.copyfile(source.resolve(), VOCODER_ROOT / name)

    manifest["vocoder_files"] = [
        {
            "path": path.relative_to(VOCODER_ROOT).as_posix(),
            "bytes": path.stat().st_size,
            "sha256": _hash_file(path),
        }
        for path in sorted(VOCODER_ROOT.rglob("*"))
        if path.is_file()
    ]
    manifest.pop("commitment", None)
    manifest_bytes = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    manifest["commitment"] = hashlib.sha256(manifest_bytes).hexdigest()
    manifest_path.write_text(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")), encoding="utf-8"
    )


if __name__ == "__main__":
    repair()
