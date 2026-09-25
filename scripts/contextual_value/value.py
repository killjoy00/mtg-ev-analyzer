"""Train the contextual candidate-value policy from cross-fitted pseudo-outcomes."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Mapping, Sequence

from .dataset import Decision, normalized_draft_weights
from .dr import aipw_candidate_values
from .features import decision_feature_map
from .nuisance import NuisancePrediction, SignalProvider, nuisance_fold
from .outcome import RidgeOutcomeModel


def softmax_values(values: Mapping[str, float], temperature: float = 1.0) -> dict[str, float]:
    if not values:
        raise ValueError("at least one action is required")
    if not math.isfinite(temperature) or temperature <= 0:
        raise ValueError("temperature must be positive and finite")
    scaled = {action: float(value) / temperature for action, value in values.items()}
    peak = max(scaled.values())
    weights = {action: math.exp(value - peak) for action, value in scaled.items()}
    total = sum(weights.values())
    return {action: weight / total for action, weight in weights.items()}


def argmax_policy(values: Mapping[str, float]) -> dict[str, float]:
    if not values:
        raise ValueError("at least one action is required")
    leader = min(values, key=lambda action: (-float(values[action]), action))
    return {action: 1.0 if action == leader else 0.0 for action in values}


@dataclass(frozen=True)
class ContextualValueModel:
    regression: RidgeOutcomeModel
    training_draft_count: int
    training_weight_cap: float
    l2: float

    def scores(self, features: Mapping[str, Mapping[str, float]]) -> dict[str, float]:
        return {
            action: self.regression.predict(row)
            for action, row in features.items()
        }

    def probabilities(
        self,
        features: Mapping[str, Mapping[str, float]],
        *,
        temperature: float,
    ) -> dict[str, float]:
        return softmax_values(self.scores(features), temperature)


def fit_contextual_value_model(
    decisions: Sequence[Decision],
    nuisance_predictions: Sequence[NuisancePrediction],
    *,
    signal_provider: SignalProvider | None = None,
    nuisance_folds: int = 5,
    weight_cap: float = 20.0,
    l2: float = 10.0,
) -> ContextualValueModel:
    """Fit one candidate-value regression on OOF AIPW pseudo-outcomes.

    Each training decision uses the same whole-draft nuisance complement that
    produced its propensity/Q predictions. Candidate rows split the decision's
    weight so every draft still contributes total weight one.
    """
    if nuisance_folds < 2:
        raise ValueError("at least two nuisance folds are required")
    if weight_cap <= 0:
        raise ValueError("weight_cap must be positive")
    by_prediction = {row.decision_id: row for row in nuisance_predictions}
    if len(by_prediction) != len(nuisance_predictions):
        raise ValueError("duplicate nuisance predictions")
    if set(by_prediction) != {decision.decision_id for decision in decisions}:
        raise ValueError("nuisance predictions must cover every training decision exactly once")

    all_ids = frozenset(decision.draft_id for decision in decisions)
    fold_ids = {
        fold: frozenset(
            draft_id for draft_id in all_ids
            if nuisance_fold(draft_id, nuisance_folds) == fold
        )
        for fold in range(nuisance_folds)
    }
    decision_weights = normalized_draft_weights(decisions)
    rows: list[Mapping[str, float]] = []
    targets: list[float] = []
    weights: list[float] = []

    for decision in decisions:
        prediction = by_prediction[decision.decision_id]
        if prediction.fold != nuisance_fold(decision.draft_id, nuisance_folds):
            raise ValueError("nuisance prediction fold does not match deterministic draft fold")
        complement = frozenset(all_ids - fold_ids[prediction.fold])
        if decision.draft_id in complement:
            raise AssertionError("value-model feature complement contains the scored draft")
        signals = signal_provider(decision, complement) if signal_provider is not None else {}
        features = decision_feature_map(decision, signals)
        pseudo = aipw_candidate_values(
            decision.candidates,
            decision.selected_card,
            float(decision.event_match_wins),
            prediction.behavior,
            prediction.q_values,
            weight_cap=weight_cap,
        )
        row_weight = decision_weights[decision.decision_id] / len(decision.candidates)
        for candidate in decision.candidates:
            rows.append(features[candidate])
            targets.append(pseudo[candidate])
            weights.append(row_weight)

    regression = RidgeOutcomeModel.fit(
        rows,
        targets,
        sample_weights=weights,
        l2=l2,
    )
    return ContextualValueModel(
        regression=regression,
        training_draft_count=len(all_ids),
        training_weight_cap=weight_cap,
        l2=l2,
    )
