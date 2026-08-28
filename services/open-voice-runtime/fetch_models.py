"""Fetch one exact Chatterbox model arm into the image at build time."""

import os
from huggingface_hub import snapshot_download


MODEL_REPO = "ResembleAI/chatterbox"
MODEL_REVISION = "5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18"
MODEL_ROOT = "/models/chatterbox-multilingual-v3"
MODEL_FILES = [
    "ve.pt",
    "t3_mtl23ls_v3.safetensors",
    "s3gen.pt",
    "grapheme_mtl_merged_expanded_v1.json",
    "conds.pt",
    "Cangjie5_TC.json",
]
HINDI_MODEL_REPO = "ResembleAI/Chatterbox-Multilingual-hi"
HINDI_MODEL_REVISION = "82ca71273cc2a9ab19efdf8315f865c1a5af0ee7"
HINDI_MODEL_ROOT = "/models/chatterbox-multilingual-hi-v3"
HINDI_MODEL_FILES = [
    "t3_hi.safetensors",
    "s3gen_v3.pt",
    "grapheme_mtl_merged_expanded_v1.json",
]


MODEL_ARM = os.getenv("OPEN_VOICE_MODEL_ARM", "general").lower()
if MODEL_ARM not in {"general", "hindi_v3"}:
    raise RuntimeError("open_voice_model_arm_invalid")

snapshot_download(
    repo_id=MODEL_REPO,
    revision=MODEL_REVISION,
    local_dir=MODEL_ROOT,
    allow_patterns=MODEL_FILES if MODEL_ARM == "general" else ["ve.pt"],
)

if MODEL_ARM == "hindi_v3":
    snapshot_download(
        repo_id=HINDI_MODEL_REPO,
        revision=HINDI_MODEL_REVISION,
        local_dir=HINDI_MODEL_ROOT,
        allow_patterns=HINDI_MODEL_FILES,
    )
