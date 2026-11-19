"""Cross-fitted nuisance-model plumbing for contextual-value-v1.

The unit of splitting is always a whole draft. Candidate features are
pre-treatment inputs; terminal outcomes are labels only on the observed action.

There are two separation layers:
* an outer nuisance fold produces predictions for held drafts; and
* an inner feature fold builds aggregate/card signals for nuisance training rows
  from an explicit subset that excludes both the outer held drafts and the
  training row's own inner fold.

This prevents a held draft from influencing its nuisance fit indirectly through
another training row's aggregate features.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Mapping, Sequence

from build_replays import stable_score

from .dataset import Decision, normalized_draft_weights
from .features import CardSignals, model_feature_map, strong_choice_offsets
from .outcome import RidgeOutcomeModel
from .propensity import LinearSoftmaxPropensityModel, PropensityExample

NUISANCE_SPLIT_SALT = "contextual-value-v1-nuisance"
FEATURE_SPLIT_SALT = "contextual-value-v1-feature-crossfit"


@dataclass(frozen=True)
class NuisancePrediction:
    decision_id: str
    draft_id: str
    fold: int
    training_draft_count: int
    behavior: Mapping[str, float]
    q_values: Mapping[str, float]


@dataclass(frozen=True)
class NuisanceFit:
    fold: int
    training_ids: frozenset[str]
    propensity: LinearSoftmaxPropensityModel
    outcome: RidgeOutcomeModel


@dataclass(frozen=True)
class NuisanceTrainingRow:
    decision_id: str
    draft_id: str
    expansion: str
    features: Mapping[str, Mapping[str, float]]
    selected_action: str
    sample_weight: float
    offsets: Mapping[str, float] | None
    outcome: float


SignalProvider = Callable[[Decision, frozenset[str]], Mapping[str, CardSignals]]


def nuisance_fold(draft_id: str, folds: int) -> int:
    if folds < 2:
        raise ValueError("at least two nuisance folds are required")
    return stable_score(f"{NUISANCE_SPLIT_SALT}:{draft_id}") % folds


def feature_fold(draft_id: str, folds: int) -> int:
    if folds < 2:
        raise ValueError("at least two feature folds are required")
    return stable_score(f"{FEATURE_SPLIT_SALT}:{draft_id}") % folds


def _feature_bundle(
    decision: Decision,
    training_ids: frozenset[str],
    signal_provider: SignalProvider | None,
) -> tuple[dict[str, dict[str, float]], dict[str, float] | None]:
    if decision.draft_id in training_ids and signal_provider is not None:
        raise AssertionError("same draft reached its own aggregate feature complement")
    signals = signal_provider(decision, training_ids) if signal_provider is not None else {}
    features = model_feature_map(decision, signals)
    offsets = strong_choice_offsets(signals, decision.candidates) if signals else None
    return features, offsets


def _training_feature_complement(
    draft_id: str,
    training_ids: frozenset[str],
    inner_folds: int,
) -> frozenset[str]:
    if draft_id not in training_ids:
        raise AssertionError("training feature row is not in nuisance training IDs")
    if len(training_ids) < 2:
        raise ValueError("cross-fitted aggregate signals require at least two training drafts")
    folds = max(2, min(inner_folds, len(training_ids)))
    held_fold = feature_fold(draft_id, folds)
    allowed = frozenset(
        candidate_id
        for candidate_id in training_ids
        if feature_fold(candidate_id, folds) != held_fold
    )
    if not allowed:
        allowed = frozenset(training_ids - {draft_id})
    if draft_id in allowed or not allowed:
        raise AssertionError("invalid training complement for aggregate features")
    return allowed


def build_fold_training_rows(
    decisions: Sequence[Decision],
    training_ids: frozenset[str],
    *,
    signal_provider: SignalProvider | None = None,
    inner_feature_folds: int = 5,
    expansion: str | None = None,
    progress_callback: Callable[[int, int], None] | None = None,
) -> list[NuisanceTrainingRow]:
    """Materialize nuisance-training rows, optionally for one environment shard.

    Per-decision weights are always computed from the complete outer-fold
    training complement before any environment filter is applied. Recombining
    environment shards is therefore algebraically identical to the monolithic
    fit.
    """
    training = [decision for decision in decisions if decision.draft_id in training_ids]
    if not training:
        raise ValueError("no decisions belong to the requested training complement")
    per_decision_weight = normalized_draft_weights(training)
    if expansion is not None:
        training = [decision for decision in training if decision.expansion == expansion]
        if not training:
            raise ValueError(f"no nuisance-training decisions for expansion {expansion}")

    rows: list[NuisanceTrainingRow] = []
    total = len(training)
    for index, decision in enumerate(training, start=1):
        feature_ids = (
            _training_feature_complement(
                decision.draft_id,
                training_ids,
                inner_feature_folds,
            )
            if signal_provider is not None
            else frozenset()
        )
        features, offsets = _feature_bundle(decision, feature_ids, signal_provider)
        rows.append(NuisanceTrainingRow(
            decision_id=decision.decision_id,
            draft_id=decision.draft_id,
            expansion=decision.expansion,
            features=features,
            selected_action=decision.selected_card,
            sample_weight=per_decision_weight[decision.decision_id],
            offsets=offsets,
            outcome=float(decision.event_match_wins),
        ))
        if progress_callback is not None and (index == total or index % 250 == 0):
            progress_callback(index, total)
    return rows


def fit_fold_from_training_rows(
    rows: Sequence[NuisanceTrainingRow],
    training_ids: frozenset[str],
    *,
    propensity_l2: float = 1.0,
    outcome_l2: float = 10.0,
    fold: int = -1,
) -> NuisanceFit:
    """Fit the unchanged nuisance models from precomputed feature rows."""
    if not rows:
        raise ValueError("at least one nuisance-training row is required")
    if any(row.draft_id not in training_ids for row in rows):
        raise ValueError("nuisance-training row falls outside the outer training complement")
    propensity_examples = [
        PropensityExample(
            features=row.features,
            selected_action=row.selected_action,
            sample_weight=row.sample_weight,
            offsets=row.offsets,
        )
        for row in rows
    ]
    outcome_rows = [row.features[row.selected_action] for row in rows]
    outcomes = [row.outcome for row in rows]
    outcome_weights = [row.sample_weight for row in rows]
    propensity = LinearSoftmaxPropensityModel.fit(
        propensity_examples,
        l2=propensity_l2,
    )
    outcome = RidgeOutcomeModel.fit(
        outcome_rows,
        outcomes,
        sample_weights=outcome_weights,
        l2=outcome_l2,
    )
    return NuisanceFit(
        fold=fold,
        training_ids=training_ids,
        propensity=propensity,
        outcome=outcome,
    )


def fit_fold(
    decisions: Sequence[Decision],
    training_ids: frozenset[str],
    *,
    signal_provider: SignalProvider | None = None,
    propensity_l2: float = 1.0,
    outcome_l2: float = 10.0,
    inner_feature_folds: int = 5,
    fold: int = -1,
) -> NuisanceFit:
    """Fit broad propensity and direct-Q on an explicit draft complement."""
    rows = build_fold_training_rows(
        decisions,
        training_ids,
        signal_provider=signal_provider,
        inner_feature_folds=inner_feature_folds,
    )
    return fit_fold_from_training_rows(
        rows,
        training_ids,
        propensity_l2=propensity_l2,
        outcome_l2=outcome_l2,
        fold=fold,
    )


def predict_fold(
    fit: NuisanceFit,
    decisions: Sequence[Decision],
    *,
    signal_provider: SignalProvider | None = None,
) -> list[NuisancePrediction]:
    predictions: list[NuisancePrediction] = []
    for decision in decisions:
        if decision.draft_id in fit.training_ids:
            raise AssertionError("held-out nuisance prediction draft reached its training complement")
        features, offsets = _feature_bundle(decision, fit.training_ids, signal_provider)
        behavior = fit.propensity.probabilities(features, offsets)
        q_values = {
            candidate: fit.outcome.predict(features[candidate])
            for candidate in decision.candidates
        }
        predictions.append(NuisancePrediction(
            decision_id=decision.decision_id,
            draft_id=decision.draft_id,
            fold=fit.fold,
            training_draft_count=len(fit.training_ids),
            behavior=behavior,
            q_values=q_values,
        ))
    return predictions


def crossfit_nuisance_fold(
    decisions: Sequence[Decision],
    fold: int,
    *,
    folds: int = 5,
    signal_provider: SignalProvider | None = None,
    propensity_l2: float = 1.0,
    outcome_l2: float = 10.0,
    inner_feature_folds: int = 5,
) -> list[NuisancePrediction]:
    """Return held-draft predictions for exactly one deterministic outer fold."""
    if folds < 2:
        raise ValueError("at least two nuisance folds are required")
    if fold < 0 or fold >= folds:
        raise ValueError("fold must be in [0, folds)")
    if not decisions:
        return []
    all_ids = frozenset(decision.draft_id for decision in decisions)
    held_ids = frozenset(
        draft_id for draft_id in all_ids
        if nuisance_fold(draft_id, folds) == fold
    )
    if not held_ids:
        return []
    training_ids = frozenset(all_ids - held_ids)
    if training_ids & held_ids:
        raise AssertionError("nuisance training and held draft IDs overlap")
    fit = fit_fold(
        decisions,
        training_ids,
        signal_provider=signal_provider,
        propensity_l2=propensity_l2,
        outcome_l2=outcome_l2,
        inner_feature_folds=inner_feature_folds,
        fold=fold,
    )
    held = [decision for decision in decisions if decision.draft_id in held_ids]
    return sorted(
        predict_fold(fit, held, signal_provider=signal_provider),
        key=lambda item: item.decision_id,
    )


def crossfit_nuisance(
    decisions: Sequence[Decision],
    *,
    folds: int = 5,
    signal_provider: SignalProvider | None = None,
    propensity_l2: float = 1.0,
    outcome_l2: float = 10.0,
    inner_feature_folds: int = 5,
) -> list[NuisancePrediction]:
    """Return one nuisance prediction per decision, always out of draft."""
    if folds < 2:
        raise ValueError("at least two nuisance folds are required")
    if not decisions:
        return []
    predictions: list[NuisancePrediction] = []
    seen: set[str] = set()

    for fold in range(folds):
        for prediction in crossfit_nuisance_fold(
            decisions,
            fold,
            folds=folds,
            signal_provider=signal_provider,
            propensity_l2=propensity_l2,
            outcome_l2=outcome_l2,
            inner_feature_folds=inner_feature_folds,
        ):
            if prediction.decision_id in seen:
                raise AssertionError("decision received multiple nuisance predictions")
            seen.add(prediction.decision_id)
            predictions.append(prediction)

    expected = {decision.decision_id for decision in decisions}
    if seen != expected:
        missing = sorted(expected - seen)[:3]
        raise AssertionError(f"nuisance cross-fitting did not cover all decisions: {missing}")
    return sorted(predictions, key=lambda item: item.decision_id)
