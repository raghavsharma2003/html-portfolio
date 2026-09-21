"""Verify baked tokenizer assets and bind Chatterbox to local-only resolvers."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

from bake_runtime_assets import (
    CANGJIE_BYTES,
    CANGJIE_FILENAME,
    CANGJIE_REPO,
    CANGJIE_REVISION,
    CANGJIE_SHA256,
    CONTRACT,
    PKUSEG_ARCHIVE_BYTES,
    PKUSEG_ARCHIVE_SHA256,
    PKUSEG_FILES,
)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _require_file(path: Path, size: int, digest: str, code: str) -> None:
    if not path.is_file() or path.stat().st_size != size or _sha256(path) != digest:
        raise RuntimeError(code)


def _manifest_asset(manifest: dict[str, Any], asset_id: str) -> dict[str, Any]:
    matches = [asset for asset in manifest.get("assets", []) if asset.get("id") == asset_id]
    if len(matches) != 1:
        raise RuntimeError("open_voice_runtime_asset_manifest_invalid")
    return matches[0]


def verify_runtime_assets(model_root: str) -> tuple[str, Path]:
    pkuseg_root = Path(os.environ.get("PKUSEG_HOME", "")).resolve()
    expected_pkuseg_root = Path("/models/pkuseg").resolve()
    if pkuseg_root != expected_pkuseg_root:
        raise RuntimeError("pkuseg_home_binding_invalid")
    manifest_path = Path(os.environ.get("OPEN_VOICE_RUNTIME_ASSET_MANIFEST", "")).resolve()
    try:
        payload = manifest_path.read_bytes()
        manifest = json.loads(payload)
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("open_voice_runtime_asset_manifest_invalid") from exc
    if manifest.get("contract") != CONTRACT:
        raise RuntimeError("open_voice_runtime_asset_manifest_invalid")

    pkuseg_asset = _manifest_asset(manifest, "spacy-pkuseg/spacy_ontonotes")
    archive = pkuseg_asset.get("archive", {})
    expected_files = [
        {"path": name, **PKUSEG_FILES[name]}
        for name in sorted(PKUSEG_FILES)
    ]
    if (
        archive.get("bytes") != PKUSEG_ARCHIVE_BYTES
        or archive.get("sha256") != PKUSEG_ARCHIVE_SHA256
        or pkuseg_asset.get("files") != expected_files
    ):
        raise RuntimeError("open_voice_runtime_asset_manifest_invalid")
    _require_file(
        pkuseg_root / "spacy_ontonotes.zip",
        PKUSEG_ARCHIVE_BYTES,
        PKUSEG_ARCHIVE_SHA256,
        "pkuseg_archive_commitment_invalid",
    )
    for name, commitment in PKUSEG_FILES.items():
        _require_file(
            pkuseg_root / "spacy_ontonotes" / name,
            int(commitment["bytes"]),
            str(commitment["sha256"]),
            f"pkuseg_{name.replace('.', '_')}_commitment_invalid",
        )

    cangjie_asset = _manifest_asset(manifest, f"{CANGJIE_REPO}/{CANGJIE_FILENAME}")
    if (
        cangjie_asset.get("source_revision") != CANGJIE_REVISION
        or cangjie_asset.get("bytes") != CANGJIE_BYTES
        or cangjie_asset.get("sha256") != CANGJIE_SHA256
    ):
        raise RuntimeError("open_voice_runtime_asset_manifest_invalid")
    cangjie = Path(model_root).resolve() / CANGJIE_FILENAME
    _require_file(cangjie, CANGJIE_BYTES, CANGJIE_SHA256, "cangjie_commitment_invalid")
    return hashlib.sha256(payload).hexdigest(), cangjie


def install_offline_tokenizer_assets(model_root: str) -> str:
    manifest_sha256, cangjie = verify_runtime_assets(model_root)
    from chatterbox.models.tokenizers import tokenizer as tokenizer_module

    def local_hf_hub_download(*args: Any, **kwargs: Any) -> str:
        repo_id = kwargs.get("repo_id", args[0] if args else None)
        filename = kwargs.get("filename", args[1] if len(args) > 1 else None)
        revision = kwargs.get("revision")
        if (
            repo_id == CANGJIE_REPO
            and filename == CANGJIE_FILENAME
            and revision in (None, CANGJIE_REVISION)
        ):
            return str(cangjie)
        raise RuntimeError("open_voice_runtime_network_asset_forbidden")

    tokenizer_module.hf_hub_download = local_hf_hub_download
    return manifest_sha256
