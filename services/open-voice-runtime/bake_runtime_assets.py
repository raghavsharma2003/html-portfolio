"""Bake and attest tokenizer assets that upstream otherwise fetches at startup."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath


CONTRACT = "vyakti-open-voice-runtime-assets/v1"
PKUSEG_PACKAGE_VERSION = "1.0.1"
PKUSEG_RELEASE = "v0.0.26"
PKUSEG_URL = (
    "https://github.com/explosion/spacy-pkuseg/releases/download/"
    f"{PKUSEG_RELEASE}/spacy_ontonotes.zip"
)
PKUSEG_ARCHIVE_SHA256 = "b216e7f92de7ae285aeab8feba2faa8ea8216e5995ff6fb3d391cc8356db1bfe"
PKUSEG_ARCHIVE_BYTES = 34_567_143
PKUSEG_FILES = {
    "features.msgpack": {
        "bytes": 22_685_181,
        "sha256": "fd4322482a7018b9bce9216173ae9d2848efe6d310b468bbb4383fb55c874a18",
    },
    "weights.npz": {
        "bytes": 37_508_754,
        "sha256": "5ada075eb25a854f71d6e6fa4e7d55e7be0ae049255b1f8f19d05c13b1b68c9e",
    },
}
CANGJIE_REPO = "ResembleAI/chatterbox"
CANGJIE_REVISION = "5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18"
CANGJIE_FILENAME = "Cangjie5_TC.json"
CANGJIE_SHA256 = "7073fd9de919443ae88e0bd2449917a65fe54898a4413ed1edcc4b67f28bce8c"
CANGJIE_BYTES = 1_920_163


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _verify_file(path: Path, size: int, digest: str, code: str) -> None:
    if not path.is_file() or path.stat().st_size != size or _sha256(path) != digest:
        raise RuntimeError(code)


def _download(url: str, target: Path) -> None:
    temporary = target.with_suffix(target.suffix + ".download")
    temporary.unlink(missing_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "vyakti-runtime-asset-baker/1"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, temporary.open("wb") as output:
            shutil.copyfileobj(response, output, length=1024 * 1024)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)


def _safe_extract(archive: Path, target: Path) -> None:
    expected = set(PKUSEG_FILES)
    with zipfile.ZipFile(archive) as package:
        names = [entry.filename for entry in package.infolist() if not entry.is_dir()]
        if len(names) != len(set(names)) or set(names) != expected:
            raise RuntimeError("pkuseg_archive_shape_invalid")
        for entry in package.infolist():
            member = PurePosixPath(entry.filename)
            if entry.is_dir() or member.is_absolute() or ".." in member.parts or len(member.parts) != 1:
                raise RuntimeError("pkuseg_archive_path_invalid")
            destination = target / member.name
            with package.open(entry) as source, destination.open("wb") as output:
                shutil.copyfileobj(source, output, length=1024 * 1024)


def _canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def main() -> None:
    pkuseg_root = Path(os.environ.get("PKUSEG_HOME", "/models/pkuseg")).resolve()
    model_root = Path(os.environ.get("OPEN_VOICE_MODEL_ROOT", "/models/chatterbox-multilingual-v3")).resolve()
    manifest_path = Path(
        os.environ.get("OPEN_VOICE_RUNTIME_ASSET_MANIFEST", "/models/runtime-assets/manifest.json")
    ).resolve()
    archive = pkuseg_root / "spacy_ontonotes.zip"
    extracted = pkuseg_root / "spacy_ontonotes"
    pkuseg_root.mkdir(parents=True, exist_ok=True)
    extracted.mkdir(parents=True, exist_ok=True)

    if not archive.exists():
        _download(PKUSEG_URL, archive)
    _verify_file(
        archive,
        PKUSEG_ARCHIVE_BYTES,
        PKUSEG_ARCHIVE_SHA256,
        "pkuseg_archive_commitment_invalid",
    )
    _safe_extract(archive, extracted)
    for name, commitment in PKUSEG_FILES.items():
        _verify_file(
            extracted / name,
            int(commitment["bytes"]),
            str(commitment["sha256"]),
            f"pkuseg_{name.replace('.', '_')}_commitment_invalid",
        )

    cangjie = model_root / CANGJIE_FILENAME
    _verify_file(cangjie, CANGJIE_BYTES, CANGJIE_SHA256, "cangjie_commitment_invalid")
    manifest = {
        "contract": CONTRACT,
        "assets": [
            {
                "id": "spacy-pkuseg/spacy_ontonotes",
                "package_version": PKUSEG_PACKAGE_VERSION,
                "source_release": PKUSEG_RELEASE,
                "source_url": PKUSEG_URL,
                "archive": {
                    "bytes": PKUSEG_ARCHIVE_BYTES,
                    "sha256": PKUSEG_ARCHIVE_SHA256,
                },
                "files": [
                    {"path": name, **PKUSEG_FILES[name]}
                    for name in sorted(PKUSEG_FILES)
                ],
            },
            {
                "id": f"{CANGJIE_REPO}/{CANGJIE_FILENAME}",
                "source_revision": CANGJIE_REVISION,
                "source_url": (
                    f"https://huggingface.co/{CANGJIE_REPO}/resolve/"
                    f"{CANGJIE_REVISION}/{CANGJIE_FILENAME}"
                ),
                "bytes": CANGJIE_BYTES,
                "sha256": CANGJIE_SHA256,
            },
        ],
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    payload = _canonical(manifest)
    manifest_path.write_bytes(payload)
    print(
        "OPEN_VOICE_RUNTIME_ASSETS_BAKED "
        f"manifest_sha256={hashlib.sha256(payload).hexdigest()} "
        f"pkuseg_archive_sha256={PKUSEG_ARCHIVE_SHA256}"
    )


if __name__ == "__main__":
    main()
