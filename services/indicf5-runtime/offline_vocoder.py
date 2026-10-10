"""Force IndicF5's imported Vocos loader onto immutable local files."""

from __future__ import annotations

from pathlib import Path
from typing import Any


def _verified_root(vocoder_root: Path) -> Path:
    root = vocoder_root.resolve()
    missing = [name for name in ("config.yaml", "pytorch_model.bin") if not (root / name).is_file()]
    if missing:
        raise RuntimeError("indicf5_local_vocoder_incomplete:" + ",".join(missing))
    return root


def force_offline_vocos(utils_module: Any, vocoder_root: Path) -> Path:
    """Patch the function that the gated remote model imports during construction."""

    root = _verified_root(vocoder_root)
    current = utils_module.load_vocoder
    if getattr(current, "_vyakti_offline_vocos", False):
        return root

    def load_local_vocoder(
        vocoder_name: str = "vocos",
        is_local: bool = False,
        local_path: str = "",
        device: Any = None,
        hf_cache_dir: str | None = None,
    ) -> Any:
        del is_local, local_path, hf_cache_dir
        if vocoder_name != "vocos":
            raise RuntimeError("indicf5_unexpected_vocoder")
        return current(
            vocoder_name="vocos",
            is_local=True,
            local_path=str(root),
            device=device,
            hf_cache_dir=None,
        )

    load_local_vocoder._vyakti_offline_vocos = True  # type: ignore[attr-defined]
    utils_module.load_vocoder = load_local_vocoder
    return root


def force_offline_vocab(hub_module: Any, model_root: Path) -> Path:
    """Bind the gated model's Hub-style vocab lookup to its baked snapshot."""

    root = model_root.resolve()
    vocab = root / "checkpoints" / "vocab.txt"
    if not vocab.is_file():
        raise RuntimeError("indicf5_local_vocab_missing")
    current = hub_module.hf_hub_download
    if getattr(current, "_vyakti_offline_vocab", False):
        return vocab

    def load_local_asset(repo_id: str, filename: str, *args: Any, **kwargs: Any) -> str:
        del args, kwargs
        allowed_repositories = {str(root), "ai4bharat/IndicF5"}
        if repo_id not in allowed_repositories or filename != "checkpoints/vocab.txt":
            raise RuntimeError("indicf5_runtime_hub_access_denied")
        return str(vocab)

    load_local_asset._vyakti_offline_vocab = True  # type: ignore[attr-defined]
    hub_module.hf_hub_download = load_local_asset
    return vocab


def install_offline_vocos(vocoder_root: Path) -> Path:
    from f5_tts.infer import utils_infer

    return force_offline_vocos(utils_infer, vocoder_root)


def install_offline_vocab(model_root: Path) -> Path:
    import huggingface_hub

    return force_offline_vocab(huggingface_hub, model_root)
