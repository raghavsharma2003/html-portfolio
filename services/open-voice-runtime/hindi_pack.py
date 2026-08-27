"""Pinned loader for Resemble AI's official Hindi single-language pack.

The pack's official Space uses the multilingual T3 architecture, the Hindi T3
checkpoint, and the v3 S3Gen checkpoint loaded with ``strict=False``. Keeping
that incompatibility explicit prevents a pack asset from being silently fed to
the stock general-checkpoint loader.
"""

from pathlib import Path
import os
import re

import torch
from safetensors.torch import load_file as load_safetensors
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
from chatterbox.models.s3gen import S3Gen
from chatterbox.models.t3 import T3
from chatterbox.models.t3.modules.t3_config import T3Config
from chatterbox.models.tokenizers import MTLTokenizer
from chatterbox.models.voice_encoder import VoiceEncoder


T3_FILENAME = "t3_hi.safetensors"
S3GEN_FILENAME = "s3gen_v3.pt"
TOKENIZER_FILENAME = "grapheme_mtl_merged_expanded_v1.json"
SAFE_KEY = re.compile(r"^[A-Za-z0-9_.]+$")


def _allowed_keys(name: str) -> set[str]:
    raw = os.getenv(name, "").strip()
    if not raw:
        return set()
    keys = {value.strip() for value in raw.split(",") if value.strip()}
    if any(not SAFE_KEY.fullmatch(value) for value in keys):
        raise RuntimeError(f"{name.lower()}_invalid")
    return keys


def load_hindi_pack(base_root: str, pack_root: str, device: torch.device) -> ChatterboxMultilingualTTS:
    base = Path(base_root)
    pack = Path(pack_root)
    map_location = torch.device("cpu") if device.type in {"cpu", "mps"} else None

    voice_encoder = VoiceEncoder()
    voice_encoder.load_state_dict(torch.load(base / "ve.pt", map_location=map_location, weights_only=True))
    voice_encoder.to(device).eval()

    t3 = T3(T3Config.multilingual())
    t3_state = load_safetensors(pack / T3_FILENAME)
    if "model" in t3_state:
        t3_state = t3_state["model"][0]
    t3.load_state_dict(t3_state)
    t3.to(device).eval()

    s3gen = S3Gen()
    incompatible = s3gen.load_state_dict(
        torch.load(pack / S3GEN_FILENAME, map_location=map_location, weights_only=True),
        strict=False,
    )
    allowed_missing = _allowed_keys("OPEN_VOICE_HINDI_ALLOWED_MISSING_KEYS")
    allowed_unexpected = _allowed_keys("OPEN_VOICE_HINDI_ALLOWED_UNEXPECTED_KEYS")
    unapproved_missing = sorted(set(incompatible.missing_keys) - allowed_missing)
    unapproved_unexpected = sorted(set(incompatible.unexpected_keys) - allowed_unexpected)
    stale_missing = sorted(allowed_missing - set(incompatible.missing_keys))
    stale_unexpected = sorted(allowed_unexpected - set(incompatible.unexpected_keys))
    if unapproved_missing or unapproved_unexpected or stale_missing or stale_unexpected:
        # Tensor key names are model structure, not data. Naming a bounded
        # sample makes remote qualification actionable while still refusing
        # a checkpoint whose load differs from the reviewed whitelist.
        detail = {
            "missing": unapproved_missing[:20],
            "unexpected": unapproved_unexpected[:20],
            "stale_missing": stale_missing[:20],
            "stale_unexpected": stale_unexpected[:20],
        }
        raise RuntimeError(f"hindi_pack_state_dict_incompatible:{detail}")
    s3gen.to(device).eval()

    tokenizer = MTLTokenizer(str(pack / TOKENIZER_FILENAME))
    return ChatterboxMultilingualTTS(t3, s3gen, voice_encoder, tokenizer, device, conds=None)
