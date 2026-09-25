"""Draft-cluster bootstrap utilities."""

from __future__ import annotations

import math
import random
from collections import defaultdict
from typing import Callable, Sequence, TypeVar

T = TypeVar("T")


def percentile_interval(values: Sequence[float], alpha: float = 0.05) -> tuple[float, float]:
    if not values:
        raise ValueError("no bootstrap values")
    if not 0 < alpha < 1:
        raise ValueError("alpha must be in (0, 1)")
    ordered = sorted(float(value) for value in values)

    def quantile(q: float) -> float:
        if len(ordered) == 1:
            return ordered[0]
        position = q * (len(ordered) - 1)
        low = math.floor(position)
        high = math.ceil(position)
        if low == high:
            return ordered[low]
        fraction = position - low
        return ordered[low] * (1 - fraction) + ordered[high] * fraction

    return quantile(alpha / 2), quantile(1 - alpha / 2)


def cluster_bootstrap(
    rows: Sequence[T],
    cluster_of: Callable[[T], str],
    statistic: Callable[[Sequence[T]], float],
    replicates: int = 1000,
    seed: int = 20260925,
) -> tuple[float, float]:
    if replicates <= 0:
        raise ValueError("replicates must be positive")
    groups: dict[str, list[T]] = defaultdict(list)
    for row in rows:
        groups[cluster_of(row)].append(row)
    clusters = sorted(groups)
    if not clusters:
        raise ValueError("no clusters to bootstrap")
    rng = random.Random(seed)
    estimates: list[float] = []
    for _ in range(replicates):
        sample: list[T] = []
        for cluster in rng.choices(clusters, k=len(clusters)):
            sample.extend(groups[cluster])
        estimates.append(float(statistic(sample)))
    return percentile_interval(estimates)
