"""Normalize F5's UTF-8-byte duration heuristic across Indian scripts."""

from __future__ import annotations

from dataclasses import dataclass


CONTRACT = "vyakti-indicf5-codepoint-duration/v1"
MAX_PREDICTED_GENERATION_MS = 30_000


@dataclass(frozen=True)
class DurationPlan:
    contract: str
    speed: float
    predicted_generation_ms: int


def _density(text: str) -> float:
    if not text:
        raise ValueError("indicf5_duration_text_required")
    return len(text.encode("utf-8")) / len(text)


def plan_duration(text: str, reference_text: str, reference_duration_ms: int) -> DurationPlan:
    if reference_duration_ms <= 0:
        raise ValueError("indicf5_duration_reference_invalid")
    # Upstream sizes frames from UTF-8 byte counts. Dividing by the relative
    # bytes-per-codepoint density removes the three-byte Devanagari inflation
    # while preserving the model's existing speed parameter and text order.
    raw_speed = _density(text) / _density(reference_text)
    speed = min(3.5, max(0.75, raw_speed))
    predicted = round(
        reference_duration_ms
        * len(text.encode("utf-8"))
        / len(reference_text.encode("utf-8"))
        / speed
    )
    if predicted > MAX_PREDICTED_GENERATION_MS:
        raise ValueError("indicf5_duration_plan_too_long")
    return DurationPlan(CONTRACT, round(speed, 6), predicted)
