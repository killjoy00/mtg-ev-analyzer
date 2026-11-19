"""Doubly robust candidate and policy estimators.

The functions here contain no model fitting. They operate on cross-fitted
nuisance predictions, which keeps the identification math separately testable
from whatever propensity/outcome learners are later selected on validation.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping, Sequence

from .propensity import validate_distribution


@dataclass(frozen=True)
class PolicyObservation:
    action: str
    outcome: float
    behavior: Mapping[str, float]
    target: Mapping[str, float]
    q_values: Mapping[str, float]
    cluster: str | None = None


@dataclass(frozen=True)
class PolicyEstimate:
    n: int
    direct: float
    ipw: float
    snips: float
    dr: float
    ess: float
    ess_ratio: float
    clipped_fraction: float
    max_unclipped_weight: float


def _validate_observation(observation: PolicyObservation) -> tuple[str, ...]:
    actions = tuple(observation.behavior)
    validate_distribution(observation.behavior, actions)
    validate_distribution(observation.target, actions)
    if set(observation.q_values) != set(actions):
        raise ValueError("q_values must cover exactly the offered actions")
    if observation.action not in observation.behavior:
        raise ValueError("observed action is not in the action set")
    if any(not math.isfinite(float(value)) for value in observation.q_values.values()):
        raise ValueError("q_values must be finite")
    if not math.isfinite(float(observation.outcome)):
        raise ValueError("outcome must be finite")
    if observation.behavior[observation.action] <= 0:
        raise ValueError("observed action must have positive behavior propensity")
    return actions


def aipw_candidate_values(
    actions: Sequence[str],
    observed_action: str,
    outcome: float,
    behavior: Mapping[str, float],
    q_values: Mapping[str, float],
    weight_cap: float | None = None,
) -> dict[str, float]:
    validate_distribution(behavior, actions)
    if set(q_values) != set(actions):
        raise ValueError("q_values must cover the complete action set")
    if observed_action not in behavior or behavior[observed_action] <= 0:
        raise ValueError("observed action must have positive behavior propensity")
    inverse = 1.0 / behavior[observed_action]
    if weight_cap is not None:
        if weight_cap <= 0:
            raise ValueError("weight_cap must be positive")
        inverse = min(inverse, weight_cap)
    residual = float(outcome) - float(q_values[observed_action])
    result = {action: float(q_values[action]) for action in actions}
    result[observed_action] += inverse * residual
    return result


def effective_sample_size(weights: Sequence[float]) -> float:
    if not weights:
        return 0.0
    numerator = sum(weights) ** 2
    denominator = sum(weight * weight for weight in weights)
    return numerator / denominator if denominator > 0 else 0.0


def evaluate_policy(observations: Sequence[PolicyObservation], weight_cap: float | None = None) -> PolicyEstimate:
    if not observations:
        raise ValueError("at least one observation is required")
    direct_terms: list[float] = []
    weighted_outcomes: list[float] = []
    dr_terms: list[float] = []
    weights: list[float] = []
    unclipped_weights: list[float] = []
    clipped = 0

    for observation in observations:
        actions = _validate_observation(observation)
        direct = sum(observation.target[action] * observation.q_values[action] for action in actions)
        ratio = observation.target[observation.action] / observation.behavior[observation.action]
        unclipped_weights.append(ratio)
        weight = ratio
        if weight_cap is not None:
            if weight_cap <= 0:
                raise ValueError("weight_cap must be positive")
            if weight > weight_cap:
                clipped += 1
                weight = weight_cap
        residual = observation.outcome - observation.q_values[observation.action]
        direct_terms.append(direct)
        weights.append(weight)
        weighted_outcomes.append(weight * observation.outcome)
        dr_terms.append(direct + weight * residual)

    n = len(observations)
    direct = sum(direct_terms) / n
    ipw = sum(weighted_outcomes) / n
    total_weight = sum(weights)
    snips = sum(weighted_outcomes) / total_weight if total_weight > 0 else math.nan
    dr = sum(dr_terms) / n
    ess = effective_sample_size(weights)
    return PolicyEstimate(
        n=n,
        direct=direct,
        ipw=ipw,
        snips=snips,
        dr=dr,
        ess=ess,
        ess_ratio=ess / n,
        clipped_fraction=clipped / n,
        max_unclipped_weight=max(unclipped_weights),
    )
