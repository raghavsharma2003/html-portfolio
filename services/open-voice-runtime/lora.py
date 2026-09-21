"""Per-speaker LoRA adapters for the Chatterbox T3 backbone.

One file, imported by BOTH the trainer (`services/voice-finetune/train.py`) and
the synthesis runtime (`app.py`), so the weights a fine-tune produces and the
weights synthesis consumes can never drift apart into two implementations of
"the same" maths that quietly disagree. Everything the adapter format promises
is enforced here, once.

Why pure torch and not `peft`
-----------------------------
The runtime image is built with `HF_HUB_OFFLINE=1` and a pinned dependency set
that already resolved once, painfully (AZURE-DEPLOY-STATE.md §4.2 — a single
extra pin made the image unbuildable). A LoRA over `nn.Linear` is about sixty
lines. Adding a dependency to the *synthesis* image, on the critical path of a
watermarked lane, to save those sixty lines is a bad trade.

What an adapter may and may not touch
-------------------------------------
Only the attention projections of `t3.tfmr` — the LLaMA backbone that maps
conditioned text to speech tokens. Deliberately NOT touched:

* `s3gen` — the vocoder. It also carries the PerTh watermarker's input path;
  changing it is how you get audio the runtime's own verifier refuses.
* `ve` — the voice encoder, which is what fidelity is measured against. Fitting
  the thing that grades you is not a fine-tune, it is a leak.
* `speech_head` / `text_head` — the output vocabulary is not speaker-specific.

`apply()` returns a handle whose `remove()` restores the exact original module
objects. The runtime calls it in a `finally`, so a request carrying an adapter
can never leave the shared in-process model mutated for the next request.
"""

from __future__ import annotations

import hashlib
import io
from typing import Any

import torch
from torch import nn

ADAPTER_FORMAT = "vyakti-lora/v1"
# The projections a per-speaker adapter is allowed to reach. Anything else in a
# loaded adapter file is a hard error, not a warning: an adapter that names an
# unexpected module is either from a different model or from a different idea
# of what an adapter is, and both should fail closed.
TARGET_SUFFIXES = ("q_proj", "k_proj", "v_proj", "o_proj")
MAX_RANK = 64
MAX_TENSORS = 2048


INIT_SEED = 0x5107A


class AdapterError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def default_generator() -> torch.Generator:
    """A CPU generator seeded from a constant, isolated from the global RNG."""
    generator = torch.Generator(device="cpu")
    generator.manual_seed(INIT_SEED)
    return generator


class LoRALinear(nn.Module):
    """`base(x) + (x @ A^T @ B^T) * (alpha / rank)`, base frozen."""

    def __init__(self, base: nn.Linear, rank: int, alpha: float, generator: torch.Generator | None = None):
        super().__init__()
        if rank < 1 or rank > MAX_RANK:
            raise AdapterError("adapter_rank_invalid")
        self.base = base
        self.rank = int(rank)
        self.alpha = float(alpha)
        self.scaling = float(alpha) / float(rank)
        weight = base.weight
        # Kaiming-uniform on A, zeros on B: the adapter is an exact no-op at
        # step 0, so an untrained adapter and no adapter are the same audio.
        # That is what makes "adapter applied" a testable claim, not a hope.
        #
        # Drawn from a PRIVATE generator, never `nn.init.*`, and this is a
        # measurement property rather than a style choice. The runtime seeds the
        # GLOBAL torch RNG from the request's `seed` and then samples tokens
        # from it. Any initialisation that consumes the global stream advances
        # it by an amount that depends on whether an adapter was attached — so
        # the adapted and zero-shot arms of a fidelity comparison would sample
        # DIFFERENT token streams, and part of the measured delta would be
        # sampling noise wearing the adapter's name. With a private generator
        # the two arms are seed-identical and the adapter is the only change.
        bound = 1.0 / (base.in_features ** 0.5)  # kaiming_uniform(a=sqrt(5))
        a = torch.empty(rank, base.in_features, dtype=torch.float32)
        a.uniform_(-bound, bound, generator=generator or default_generator())
        self.lora_a = nn.Parameter(a.to(dtype=weight.dtype, device=weight.device))
        self.lora_b = nn.Parameter(torch.zeros(base.out_features, rank, dtype=weight.dtype, device=weight.device))
        for parameter in self.base.parameters():
            parameter.requires_grad_(False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # noqa: D102
        out = self.base(x)
        delta = torch.nn.functional.linear(torch.nn.functional.linear(x, self.lora_a), self.lora_b)
        return out + delta * self.scaling


def target_modules(t3: nn.Module) -> dict[str, nn.Linear]:
    """Every attention projection in the T3 backbone, keyed by dotted path."""
    found: dict[str, nn.Linear] = {}
    for name, module in t3.tfmr.named_modules():
        if isinstance(module, nn.Linear) and name.rsplit(".", 1)[-1] in TARGET_SUFFIXES:
            found[name] = module
    if not found:
        raise AdapterError("adapter_no_target_modules")
    return found


class _Handle:
    def __init__(self, t3: nn.Module, replaced: list[tuple[nn.Module, str, nn.Linear]]):
        self._t3 = t3
        self._replaced = replaced
        self.modules: dict[str, LoRALinear] = {}

    def remove(self) -> None:
        for parent, attribute, original in self._replaced:
            setattr(parent, attribute, original)
        self._replaced = []
        self.modules = {}


def inject(t3: nn.Module, rank: int, alpha: float, names: list[str] | None = None) -> _Handle:
    """Wrap the target projections in freshly-initialised (no-op) LoRA layers."""
    targets = target_modules(t3)
    chosen = list(targets) if names is None else list(names)
    replaced: list[tuple[nn.Module, str, nn.Linear]] = []
    handle = _Handle(t3, replaced)
    # One generator shared across the whole injection: successive modules draw
    # successive values, so the init is varied AND reproducible, and the global
    # RNG is never touched (see LoRALinear.__init__).
    generator = default_generator()
    for name in chosen:
        base = targets.get(name)
        if base is None:
            handle.remove()
            raise AdapterError("adapter_target_unknown")
        parent_path, _, attribute = name.rpartition(".")
        parent = t3.tfmr.get_submodule(parent_path) if parent_path else t3.tfmr
        wrapper = LoRALinear(base, rank, alpha, generator)
        setattr(parent, attribute, wrapper)
        replaced.append((parent, attribute, base))
        handle.modules[name] = wrapper
    return handle


def state_dict(handle: _Handle) -> dict[str, torch.Tensor]:
    out: dict[str, torch.Tensor] = {}
    for name, module in handle.modules.items():
        out[f"{name}.lora_a"] = module.lora_a.detach().to("cpu", torch.float32)
        out[f"{name}.lora_b"] = module.lora_b.detach().to("cpu", torch.float32)
    return out


def serialize(handle: _Handle, meta: dict[str, Any]) -> bytes:
    payload = {
        "format": ADAPTER_FORMAT,
        "rank": int(next(iter(handle.modules.values())).rank),
        "alpha": float(next(iter(handle.modules.values())).alpha),
        "targets": sorted(handle.modules),
        "tensors": state_dict(handle),
        "meta": dict(meta),
    }
    buffer = io.BytesIO()
    torch.save(payload, buffer)
    return buffer.getvalue()


def parse(blob: bytes) -> dict[str, Any]:
    """Load and fully validate an adapter blob. Raises `AdapterError` only."""
    try:
        # weights_only=True: an adapter arrives over the wire, so it is data and
        # must never be able to execute anything on unpickling.
        payload = torch.load(io.BytesIO(blob), map_location="cpu", weights_only=True)
    except AdapterError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise AdapterError("adapter_blob_unreadable") from exc
    if not isinstance(payload, dict) or payload.get("format") != ADAPTER_FORMAT:
        raise AdapterError("adapter_format_invalid")
    tensors = payload.get("tensors")
    targets = payload.get("targets")
    if not isinstance(tensors, dict) or not isinstance(targets, list) or not targets:
        raise AdapterError("adapter_format_invalid")
    if len(tensors) > MAX_TENSORS or len(tensors) != 2 * len(targets):
        raise AdapterError("adapter_tensor_count_invalid")
    rank = payload.get("rank")
    alpha = payload.get("alpha")
    if not isinstance(rank, int) or isinstance(rank, bool) or not 1 <= rank <= MAX_RANK:
        raise AdapterError("adapter_rank_invalid")
    if not isinstance(alpha, (int, float)) or isinstance(alpha, bool) or not 0 < float(alpha) <= 256:
        raise AdapterError("adapter_alpha_invalid")
    for name in targets:
        if not isinstance(name, str) or name.rsplit(".", 1)[-1] not in TARGET_SUFFIXES:
            raise AdapterError("adapter_target_forbidden")
        for suffix in ("lora_a", "lora_b"):
            tensor = tensors.get(f"{name}.{suffix}")
            if not isinstance(tensor, torch.Tensor) or tensor.dim() != 2 or not torch.isfinite(tensor).all():
                raise AdapterError("adapter_tensor_invalid")
    return payload


def load(t3: nn.Module, blob: bytes) -> _Handle:
    """Apply a serialized adapter to a model. Caller MUST `remove()` it."""
    payload = parse(blob)
    handle = inject(t3, int(payload["rank"]), float(payload["alpha"]), list(payload["targets"]))
    try:
        for name, module in handle.modules.items():
            a = payload["tensors"][f"{name}.lora_a"]
            b = payload["tensors"][f"{name}.lora_b"]
            if tuple(a.shape) != tuple(module.lora_a.shape) or tuple(b.shape) != tuple(module.lora_b.shape):
                raise AdapterError("adapter_shape_mismatch")
            with torch.no_grad():
                module.lora_a.copy_(a.to(module.lora_a.dtype))
                module.lora_b.copy_(b.to(module.lora_b.dtype))
    except Exception:
        handle.remove()
        raise
    return handle


def adapter_sha256(blob: bytes) -> str:
    return hashlib.sha256(blob).hexdigest()


def synthesis_commitment(model_commitment: str, adapter_digest: str | None) -> str:
    """What actually produced this audio.

    A fine-tuned lane that reports the base model's commitment is lying by
    omission: two different networks would sign the same receipt. The base
    commitment is preserved unchanged when no adapter is in play, so existing
    receipts and their verifiers are untouched.
    """
    if not adapter_digest:
        return model_commitment
    return hashlib.sha256(f"{model_commitment}:lora:{adapter_digest}".encode()).hexdigest()
