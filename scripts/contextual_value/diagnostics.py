"""Development diagnostics for contextual-value-v1.

All functions consume already out-of-draft nuisance predictions. They do not fit
models and therefore cannot introduce a new path from a held draft into its own
prediction.
"""

from __future__ import annotations

import math
import statistics
from collections import defaultdict
from typing import Mapping, Sequence

from .dr import PolicyObservation, evaluate_policy
from .dataset import Decision
from .nuisance import NuisancePrediction
from .propensity import support_threshold
from .uncertainty import cluster_bootstrap


def _quantile(values: Sequence[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(float(value) for value in values)
    if len(ordered) == 1:
        return ordered[0]
    position = q * (len(ordered) - 1)
    low = math.floor(position)
    high = math.ceil(position)
    if low == high:
        return ordered[low]
    fraction = position - low
    return ordered[low] * (1.0 - fraction) + ordered[high] * fraction


def describe(values: Sequence[float]) -> dict:
    numbers = [float(value) for value in values if math.isfinite(float(value))]
    if not numbers:
        return {"n": 0}
    return {
        "n": len(numbers),
        "mean": statistics.fmean(numbers),
        "min": min(numbers),
        "p01": _quantile(numbers, 0.01),
        "p05": _quantile(numbers, 0.05),
        "p25": _quantile(numbers, 0.25),
        "median": _quantile(numbers, 0.50),
        "p75": _quantile(numbers, 0.75),
        "p95": _quantile(numbers, 0.95),
        "p99": _quantile(numbers, 0.99),
        "max": max(numbers),
    }


def skill_group(rate: float) -> str:
    rate = float(rate)
    if rate < 0.50:
        return "<0.50"
    if rate < 0.55:
        return "0.50-0.55"
    if rate < 0.60:
        return "0.55-0.60"
    return ">=0.60"


def experience_group(lower_bound: int) -> str:
    value = int(lower_bound)
    if value < 100:
        return "<100"
    if value < 500:
        return "100-499"
    return ">=500"


def _error_summary(rows: Sequence[tuple[float, float]]) -> dict:
    if not rows:
        return {"n": 0}
    errors = [prediction - outcome for prediction, outcome in rows]
    return {
        "n": len(rows),
        "mae": statistics.fmean(abs(error) for error in errors),
        "rmse": math.sqrt(statistics.fmean(error * error for error in errors)),
        "mean_bias": statistics.fmean(errors),
        "predicted_mean": statistics.fmean(prediction for prediction, _ in rows),
        "observed_mean": statistics.fmean(outcome for _, outcome in rows),
    }


def outcome_diagnostics(
    decisions: Sequence[Decision],
    predictions: Sequence[NuisancePrediction],
) -> dict:
    """Observed-action Q diagnostics on an out-of-draft prediction set."""
    by_prediction = {row.decision_id: row for row in predictions}
    if len(by_prediction) != len(predictions):
        raise ValueError("duplicate nuisance predictions")
    records = []
    for decision in decisions:
        prediction = by_prediction.get(decision.decision_id)
        if prediction is None:
            continue
        q = float(prediction.q_values[decision.selected_card])
        y = float(decision.event_match_wins)
        records.append((decision, q, y))
    if len(records) != len(predictions):
        raise ValueError("decisions and nuisance predictions do not align")

    groups: dict[str, dict[str, list[tuple[float, float]]]] = {
        "set": defaultdict(list),
        "pick": defaultdict(list),
        "skill": defaultdict(list),
        "experience": defaultdict(list),
    }
    for decision, q, y in records:
        groups["set"][decision.expansion or "unknown"].append((q, y))
        groups["pick"][f"P{decision.pack_number + 1}P{decision.pick_number + 1}"].append((q, y))
        groups["skill"][skill_group(decision.user_game_win_rate)].append((q, y))
        groups["experience"][experience_group(decision.user_games_lower_bound)].append((q, y))

    ordered = sorted(records, key=lambda item: (item[1], item[0].decision_id))
    deciles = []
    if ordered:
        for index in range(10):
            start = index * len(ordered) // 10
            stop = (index + 1) * len(ordered) // 10
            bucket = ordered[start:stop]
            if not bucket:
                continue
            deciles.append({
                "decile": index + 1,
                **_error_summary([(q, y) for _, q, y in bucket]),
            })

    return {
        "overall": _error_summary([(q, y) for _, q, y in records]),
        "calibration_deciles": deciles,
        "by_set": {
            key: _error_summary(rows)
            for key, rows in sorted(groups["set"].items())
        },
        "by_pick": {
            key: _error_summary(rows)
            for key, rows in sorted(groups["pick"].items())
        },
        "by_skill": {
            key: _error_summary(rows)
            for key, rows in sorted(groups["skill"].items())
        },
        "by_experience": {
            key: _error_summary(rows)
            for key, rows in sorted(groups["experience"].items())
        },
    }


def policy_overlap_diagnostics(observations: Sequence[PolicyObservation]) -> dict:
    """Overlap/support diagnostics for one target policy on one OPE sample."""
    if not observations:
        raise ValueError("at least one policy observation is required")
    selected_propensities = []
    raw_weights = []
    leader_support = []
    runner_support = []
    rank_supported: dict[str, list[bool]] = defaultdict(list)

    for observation in observations:
        behavior = observation.behavior
        target = observation.target
        chosen = observation.action
        selected_propensities.append(float(behavior[chosen]))
        raw_weights.append(float(target[chosen]) / float(behavior[chosen]))
        threshold = support_threshold(len(behavior))
        ranked = sorted(
            target,
            key=lambda action: (-float(target[action]), action),
        )
        if ranked:
            leader_support.append(float(behavior[ranked[0]]))
        if len(ranked) > 1:
            runner_support.append(float(behavior[ranked[1]]))
        for index, action in enumerate(ranked):
            label = str(index + 1) if index < 3 else "4+"
            rank_supported[label].append(float(behavior[action]) >= threshold)

    primary = evaluate_policy(observations, weight_cap=20.0)
    return {
        "selected_behavior_propensity": describe(selected_propensities),
        "raw_target_behavior_weight": describe(raw_weights),
        "leader_behavior_support": describe(leader_support),
        "runner_up_behavior_support": describe(runner_support),
        "candidate_rank_supported_fraction": {
            rank: sum(flags) / len(flags)
            for rank, flags in sorted(rank_supported.items())
            if flags
        },
        "cap20": {
            "ess": primary.ess,
            "ess_ratio": primary.ess_ratio,
            "clipped_fraction": primary.clipped_fraction,
            "max_unclipped_weight": primary.max_unclipped_weight,
        },
    }


def paired_dr_delta_ci(
    candidate: Sequence[PolicyObservation],
    incumbent: Sequence[PolicyObservation],
    *,
    weight_cap: float = 20.0,
    replicates: int = 1000,
    seed: int = 20260925,
) -> tuple[float, float]:
    """Draft-cluster bootstrap CI for a paired DR policy-value difference."""
    if len(candidate) != len(incumbent) or not candidate:
        raise ValueError("candidate and incumbent must align and be non-empty")
    pairs = list(zip(candidate, incumbent))
    for left, right in pairs:
        if left.cluster is None or right.cluster is None:
            raise ValueError("paired bootstrap requires draft clusters")
        if left.cluster != right.cluster:
            raise ValueError("candidate/incumbent clusters do not align")

    return cluster_bootstrap(
        pairs,
        cluster_of=lambda pair: str(pair[0].cluster),
        statistic=lambda sample: (
            evaluate_policy([pair[0] for pair in sample], weight_cap).dr
            - evaluate_policy([pair[1] for pair in sample], weight_cap).dr
        ),
        replicates=replicates,
        seed=seed,
    )
