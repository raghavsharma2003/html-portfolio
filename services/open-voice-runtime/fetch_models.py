"""Fetch the exact Chatterbox checkpoint into the image at build time."""

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


snapshot_download(
    repo_id=MODEL_REPO,
    revision=MODEL_REVISION,
    local_dir=MODEL_ROOT,
    allow_patterns=MODEL_FILES,
)
