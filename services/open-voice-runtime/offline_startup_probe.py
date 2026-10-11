"""Executable build gate for the exact tokenizer portion of cold startup."""

from __future__ import annotations

import tempfile
from pathlib import Path

import spacy_pkuseg.download as pkuseg_download
from spacy_pkuseg import pkuseg

from bake_runtime_assets import PKUSEG_ARCHIVE_SHA256, PKUSEG_URL
from offline_assets import install_offline_tokenizer_assets


class NetworkAttempt(RuntimeError):
    pass


def main() -> None:
    attempts: list[str] = []

    def deny_download(url: str, *args: object, **kwargs: object) -> None:
        attempts.append(url)
        raise NetworkAttempt("runtime_network_forbidden")

    # Negative control: the exact upstream loader does attempt the network when
    # its cache is absent. This proves the blocker below is live, not decorative.
    original = pkuseg_download._download_url_to_file
    pkuseg_download._download_url_to_file = deny_download
    with tempfile.TemporaryDirectory(prefix="vyakti-pkuseg-negative-") as empty:
        try:
            pkuseg_download.download_model(PKUSEG_URL, empty, PKUSEG_ARCHIVE_SHA256, progress=False)
        except NetworkAttempt:
            pass
        else:
            raise RuntimeError("pkuseg_missing_asset_negative_control_failed")
    if attempts != [PKUSEG_URL]:
        raise RuntimeError("pkuseg_missing_asset_negative_control_failed")

    # The real baked path must initialize while the downloader is a hard error.
    attempts.clear()
    manifest_sha256 = install_offline_tokenizer_assets("/models/chatterbox-multilingual-v3")
    segmenter = pkuseg()
    if not segmenter.cut("中文冷启动"):
        raise RuntimeError("pkuseg_offline_probe_invalid")
    if attempts:
        raise RuntimeError("pkuseg_offline_probe_attempted_network")
    pkuseg_download._download_url_to_file = original
    print(
        "OPEN_VOICE_OFFLINE_STARTUP_PROBE_OK "
        f"manifest_sha256={manifest_sha256} network_attempts=0"
    )


if __name__ == "__main__":
    main()
