"""Variable-action-set propensity helpers."""

from __future__ import annotations

import math
from typing import Mapping, Sequence

MIN_PROBABILITY = 1e-9


def softmax(scores: Mapping[str, float], temperature: float = 1.0) -> dict[str, float]:
    if temperature <= 0 or not math.isfinite(temperature):
        raise ValueError("temperature must be finite and positive")
    if not scores:
        raise ValueError("cannot normalize an empty action set")
    if any(not math.isfinite(float(value)) for value in scores.values()):
        raise ValueError("all scores must be finite")
    peak = max(float(value) / temperature for value in scores.values())
    weights = {key: math.exp(float(value) / temperature - peak) for key, value in scores.items()}
    total = sum(weights.values())
    probabilities = {key: value / total for key, value in weights.items()}
    validate_distribution(probabilities, tuple(scores))
    return probabilities


def validate_distribution(probabilities: Mapping[str, float], actions: Sequence[str] | None = None) -> None:
    if not probabilities:
        raise ValueError("empty probability distribution")
    if actions is not None and set(probabilities) != set(actions):
        raise ValueError("probability keys must match the complete action set")
    if any((not math.isfinite(float(value))) or value < 0 or value > 1 for value in probabilities.values()):
        raise ValueError("probabilities must be finite and in [0, 1]")
    if not math.isclose(sum(probabilities.values()), 1.0, rel_tol=1e-10, abs_tol=1e-10):
        raise ValueError("probabilities must sum to one over the offered pack")


def support_threshold(candidate_count: int) -> float:
    if candidate_count <= 0:
        raise ValueError("candidate_count must be positive")
    return max(0.01, 0.10 / candidate_count)


def is_supported(probability: float, candidate_count: int) -> bool:
    return probability >= support_threshold(candidate_count)
