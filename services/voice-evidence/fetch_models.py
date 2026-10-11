"""Bake reviewed, immutable public model artifacts into the container image."""

from __future__ import annotations

import hashlib
import io
import os
import pathlib
import urllib.request
import zipfile

from huggingface_hub import snapshot_download


MODELS = {
    "ecapa": (
        "speechbrain/spkrec-ecapa-voxceleb",
        "0f99f2d0ebe89ac095bcc5903c4dd8f72b367286",
    ),
    "xvector": (
        "speechbrain/spkrec-xvect-voxceleb",
        "56895a2df401be4150a159f3a1c653f00051d477",
    ),
    "sepformer": (
        "speechbrain/sepformer-whamr16k",
        "21a5b500c6f52fddc387c5d9e5fb13ffd6f039c5",
    ),
}
DEEPFILTER_URL = "https://github.com/Rikorose/DeepFilterNet/raw/main/models/DeepFilterNet3.zip"
DEEPFILTER_SHA256 = "49c52edc8947ae1f9bf50d81530beaf3a2c3245aeaf34b6f31ff535cd22284d2"


def _safe_extract(archive: zipfile.ZipFile, destination: pathlib.Path) -> None:
    root = destination.resolve()
    for member in archive.infolist():
        target = (destination / member.filename).resolve()
        if root not in target.parents and target != root:
            raise RuntimeError("deepfilter_archive_path_invalid")
    archive.extractall(destination)


def main() -> None:
    root = pathlib.Path(os.getenv("VOICE_EVIDENCE_MODEL_ROOT", "/models/voice-evidence"))
    root.mkdir(parents=True, exist_ok=True)
    for name, (repo_id, revision) in MODELS.items():
        snapshot_download(
            repo_id=repo_id,
            revision=revision,
            local_dir=root / name,
            allow_patterns=["*.yaml", "*.ckpt", "*.txt", "*.json", "*.py"],
        )
    with urllib.request.urlopen(DEEPFILTER_URL, timeout=120) as response:
        payload = response.read(16 * 1024 * 1024)
        if response.read(1):
            raise RuntimeError("deepfilter_archive_too_large")
    if hashlib.sha256(payload).hexdigest() != DEEPFILTER_SHA256:
        raise RuntimeError("deepfilter_archive_digest_mismatch")
    destination = root / "deepfilter"
    destination.mkdir(exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        _safe_extract(archive, destination)


if __name__ == "__main__":
    main()

