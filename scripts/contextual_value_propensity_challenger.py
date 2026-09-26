#!/usr/bin/env python3
"""Run the frozen core-pool propensity challenger on train + validation only."""

from __future__ import annotations

import argparse
import gzip
import json
import math
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Mapping, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))

from contextual_value.archive import ArchiveSignalProvider
from contextual_value.checkpoint import CORE_DEVELOPMENT_ENVIRONMENTS, load_preprocessed_cohort
from contextual_value.dataset import choose_primary_decision, draft_split
from contextual_value.diagnostics import policy_overlap_diagnostics, policy_overlap_slices, propensity_diagnostics
from contextual_value.dr import PolicyObservation, evaluate_policy
from contextual_value.features import model_feature_map, strong_choice_offsets
from contextual_value.nuisance import NuisancePrediction, NuisanceTrainingRow
from contextual_value.outcome import RidgeOutcomeModel
from contextual_value.propensity import LinearSoftmaxPropensityModel, PropensityExample
from contextual_value.value import ContextualValueModel, argmax_policy


@dataclass(frozen=True)
class PropensityStandardizer:
    skill_mean: float
    skill_scale: float
    experience_mean: float
    experience_scale: float

    def standardize_skill(self, value: float) -> float:
        return (float(value) - self.skill_mean) / self.skill_scale

    def standardize_experience(self, value: float) -> float:
        return (float(value) - self.experience_mean) / self.experience_scale


def _state_value(features: Mapping[str, Mapping[str, float]], name: str) -> float:
    values = [float(row.get(name, 0.0)) for row in features.values()]
    if not values:
        raise ValueError("empty action feature map")
    if max(values) - min(values) > 1e-12:
        raise ValueError(f"{name} is not action-invariant within the decision")
    return values[0]


def _weighted_mean_scale(values: Sequence[tuple[float, float]]) -> tuple[float, float]:
    total = sum(weight for _, weight in values)
    if total <= 0:
        raise ValueError("positive total weight is required for standardization")
    mean = sum(value * weight for value, weight in values) / total
    variance = sum(weight * (value - mean) ** 2 for value, weight in values) / total
    scale = math.sqrt(max(0.0, variance))
    if scale <= 1e-12:
        scale = 1.0
    return mean, scale


def fit_propensity_standardizer(rows: Sequence[NuisanceTrainingRow]) -> PropensityStandardizer:
    if not rows:
        raise ValueError("at least one nuisance training row is required")
    skill = []
    experience = []
    for row in rows:
        weight = float(row.sample_weight)
        if weight < 0 or not math.isfinite(weight):
            raise ValueError("sample weights must be finite and non-negative")
        skill.append((_state_value(row.features, "user_game_win_rate"), weight))
        experience.append((_state_value(row.features, "log1p_user_games"), weight))
    skill_mean, skill_scale = _weighted_mean_scale(skill)
    exp_mean, exp_scale = _weighted_mean_scale(experience)
    return PropensityStandardizer(
        skill_mean=skill_mean,
        skill_scale=skill_scale,
        experience_mean=exp_mean,
        experience_scale=exp_scale,
    )


def candidate_varying_feature_map(
    features: Mapping[str, Mapping[str, float]],
) -> dict[str, dict[str, float]]:
    """Keep exactly the current terms that vary across candidates."""
    if not features:
        raise ValueError("empty action feature map")
    actions = tuple(features)
    names = sorted({name for row in features.values() for name in row})
    varying = []
    for name in names:
        values = [float(features[action].get(name, 0.0)) for action in actions]
        if max(values) - min(values) > 1e-12:
            varying.append(name)
    return {
        action: {
            name: float(features[action].get(name, 0.0))
            for name in varying
            if float(features[action].get(name, 0.0)) != 0.0
        }
        for action in actions
    }


def _rank_group(features: Mapping[str, Mapping[str, float]]) -> str:
    first = next(iter(features.values()))
    active = sorted(
        name.split("=", 1)[1]
        for name, value in first.items()
        if name.startswith("rank=") and float(value) != 0.0
    )
    if len(active) > 1:
        raise ValueError("multiple rank groups are active for one decision")
    label = active[0] if active else "unknown"
    for row in features.values():
        if float(row.get(f"rank={label}", 0.0)) != float(first.get(f"rank={label}", 0.0)):
            raise ValueError("rank group is not action-invariant within the decision")
    return label


def challenger_feature_map(
    features: Mapping[str, Mapping[str, float]],
    standardizer: PropensityStandardizer,
) -> dict[str, dict[str, float]]:
    """Return the single predeclared propensity-only interaction challenger."""
    varying = candidate_varying_feature_map(features)
    z_skill = standardizer.standardize_skill(_state_value(features, "user_game_win_rate"))
    z_experience = standardizer.standardize_experience(_state_value(features, "log1p_user_games"))
    rank = _rank_group(features)

    result = {}
    for action, base in varying.items():
        row = dict(base)
        source = features[action]
        log_strong = source.get("log_strong_choice_probability")
        if log_strong is not None:
            value = float(log_strong)
            row["skill_x_log_strong_choice_probability"] = z_skill * value
            row["experience_x_log_strong_choice_probability"] = z_experience * value
            row[f"rank={rank}_x_log_strong_choice_probability"] = value
        if "gih_wr" in source:
            row["skill_x_gih_wr"] = z_skill * float(source["gih_wr"])
        if "iwd" in source:
            row["skill_x_iwd"] = z_skill * float(source["iwd"])
        result[action] = row
    return result


def build_challenger_examples(
    rows: Sequence[NuisanceTrainingRow],
    standardizer: PropensityStandardizer,
) -> list[PropensityExample]:
    return [
        PropensityExample(
            features=challenger_feature_map(row.features, standardizer),
            selected_action=row.selected_action,
            sample_weight=float(row.sample_weight),
            offsets=row.offsets,
        )
        for row in rows
    ]


def fit_challenger(
    rows: Sequence[NuisanceTrainingRow],
    *,
    l2: float = 1.0,
) -> tuple[LinearSoftmaxPropensityModel, PropensityStandardizer, list[PropensityExample]]:
    standardizer = fit_propensity_standardizer(rows)
    examples = build_challenger_examples(rows, standardizer)
    model = LinearSoftmaxPropensityModel.fit(examples, l2=l2)
    return model, standardizer, examples


def optimizer_diagnostics(
    model: LinearSoftmaxPropensityModel,
    examples: Sequence[PropensityExample],
) -> dict[str, float | int | bool]:
    if not examples:
        raise ValueError("at least one propensity example is required")
    names = tuple(model.feature_names)
    index = {name: i for i, name in enumerate(names)}
    gradient = [0.0] * len(names)
    total_weight = 0.0
    weighted_log_loss = 0.0
    for example in examples:
        example.validate()
        weight = float(example.sample_weight)
        total_weight += weight
        probabilities = model.probabilities(example.features, example.offsets)
        selected_probability = max(1e-15, float(probabilities[example.selected_action]))
        weighted_log_loss -= weight * math.log(selected_probability)
        for action, row in example.features.items():
            residual = (1.0 if action == example.selected_action else 0.0) - probabilities[action]
            for name, value in row.items():
                position = index.get(name)
                if position is not None:
                    gradient[position] += weight * residual * float(value)
    if total_weight <= 0:
        raise ValueError("positive total sample weight is required")
    penalized = [
        gradient[i] / total_weight - model.l2 * float(model.coefficients[i]) / total_weight
        for i in range(len(names))
    ]
    return {
        "available": True,
        "epochs": 250,
        "weighted_training_log_loss": weighted_log_loss / total_weight,
        "penalized_gradient_l2": math.sqrt(sum(value * value for value in penalized)),
        "penalized_gradient_max_abs": max((abs(value) for value in penalized), default=0.0),
        "feature_count": len(names),
    }


def _read_training_rows(paths: list[Path]) -> list[NuisanceTrainingRow]:
    rows = []
    seen = set()
    expansions = set()
    for path in paths:
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            for line in handle:
                if not line.strip():
                    continue
                row = NuisanceTrainingRow(**json.loads(line))
                if row.decision_id in seen:
                    raise SystemExit(f"duplicate training decision {row.decision_id}")
                seen.add(row.decision_id)
                expansions.add(row.expansion)
                rows.append(row)
    expected = set(CORE_DEVELOPMENT_ENVIRONMENTS)
    if expansions != expected:
        raise SystemExit(f"training shards do not cover frozen core pool: {sorted(expansions)}")
    return rows


def _read_predictions(path: Path) -> list[NuisancePrediction]:
    rows = []
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(NuisancePrediction(**json.loads(line)))
    return rows


def _load_value_model(path: Path) -> ContextualValueModel:
    data = json.loads(path.read_text(encoding="utf-8"))
    regression = RidgeOutcomeModel(
        feature_names=tuple(data["feature_names"]),
        coefficients=tuple(float(value) for value in data["coefficients"]),
        l2=float(data["l2"]),
    )
    return ContextualValueModel(
        regression=regression,
        training_draft_count=int(data["training_draft_count"]),
        training_weight_cap=float(data["training_weight_cap"]),
        l2=float(data["l2"]),
    )


def _primary_validation(decisions):
    grouped = {}
    for decision in decisions:
        grouped.setdefault(decision.draft_id, []).append(decision)
    chosen = []
    for draft_id in sorted(grouped):
        row = choose_primary_decision(grouped[draft_id])
        if row is not None:
            chosen.append(row)
    return chosen


def _strong_target(signals, candidates):
    values = {}
    for candidate in candidates:
        row = signals.get(candidate)
        probability = row.strong_choice_probability if row is not None else None
        values[candidate] = math.log(max(1e-9, float(probability or 1e-9)))
    return argmax_policy(values)


def _observation(decision, behavior, target, q_values):
    return PolicyObservation(
        action=decision.selected_card,
        outcome=float(decision.event_match_wins),
        behavior=behavior,
        target=target,
        q_values=q_values,
        cluster=decision.draft_id,
    )


def _calibration_mae(diags: dict) -> float | None:
    weighted = 0.0
    total = 0.0
    for row in diags.get("candidate_probability_calibration_deciles") or []:
        predicted = row.get("predicted_choice_probability")
        observed = row.get("observed_choice_frequency")
        weight = float(row.get("weight") or 0.0)
        if predicted is None or observed is None or weight <= 0:
            continue
        weighted += weight * abs(float(predicted) - float(observed))
        total += weight
    return weighted / total if total else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preprocessed-cohort", type=Path, required=True)
    parser.add_argument("--feature-shard", type=Path, action="append", required=True)
    parser.add_argument("--baseline-validation-nuisance", type=Path, required=True)
    parser.add_argument("--baseline-report", type=Path, required=True)
    parser.add_argument("--value-model", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--propensity-l2", type=float, default=1.0)
    args = parser.parse_args()

    decisions, games, cohort = load_preprocessed_cohort(args.preprocessed_cohort)
    if cohort.get("assessment_outcomes_serialized") is not False:
        raise SystemExit("assessment outcomes are present in the development cohort")
    if any(draft_split(row.draft_id) == "assessment" for row in decisions):
        raise SystemExit("assessment decisions reached the development challenger")

    train = [row for row in decisions if draft_split(row.draft_id) == "train"]
    validation = [row for row in decisions if draft_split(row.draft_id) == "validation"]
    train_ids = frozenset(row.draft_id for row in train)
    if not train or not validation:
        raise SystemExit("challenger requires non-empty train and validation partitions")

    training_rows = _read_training_rows(args.feature_shard)
    if {row.decision_id for row in training_rows} != {row.decision_id for row in train}:
        raise SystemExit("feature shards do not exactly cover frozen training decisions")

    baseline_predictions = _read_predictions(args.baseline_validation_nuisance)
    baseline_by_id = {row.decision_id: row for row in baseline_predictions}
    if len(baseline_by_id) != len(baseline_predictions):
        raise SystemExit("baseline validation nuisance contains duplicate decisions")
    if set(baseline_by_id) != {row.decision_id for row in validation}:
        raise SystemExit("baseline validation nuisance does not match frozen validation decisions")

    baseline_report = json.loads(args.baseline_report.read_text(encoding="utf-8"))
    if baseline_report.get("assessment_opened") is not False:
        raise SystemExit("baseline report did not keep assessment sealed")
    if baseline_report.get("cohort", {}).get("cohort_id") != cohort.get("cohort_id"):
        raise SystemExit("baseline report cohort ID does not match downloaded cohort")

    model, standardizer, examples = fit_challenger(training_rows, l2=args.propensity_l2)
    convergence = optimizer_diagnostics(model, examples)
    provider = ArchiveSignalProvider(decisions, games)

    primary = _primary_validation(validation)
    primary_ids = {row.decision_id for row in primary}
    challenger_predictions = []
    signal_cache = {}
    for decision in validation:
        signals = provider(decision, train_ids)
        if decision.decision_id in primary_ids:
            signal_cache[decision.decision_id] = signals
        base_features = model_feature_map(decision, signals)
        propensity_features = challenger_feature_map(base_features, standardizer)
        offsets = strong_choice_offsets(signals, decision.candidates) if signals else None
        behavior = model.probabilities(propensity_features, offsets)
        challenger_predictions.append(NuisancePrediction(
            decision_id=decision.decision_id,
            draft_id=decision.draft_id,
            fold=-1,
            training_draft_count=len(train_ids),
            behavior=behavior,
            q_values=baseline_by_id[decision.decision_id].q_values,
        ))

    challenger_by_id = {row.decision_id: row for row in challenger_predictions}
    baseline_diags = baseline_report["diagnostics"]["propensity"]["validation"]
    challenger_diags = propensity_diagnostics(validation, challenger_predictions)
    challenger_diags["optimizer_convergence"] = convergence

    value_model = _load_value_model(args.value_model)
    selected_temperature = float(
        baseline_report["models"]["G_contextual_value"]["selected_validation_temperature"].split("=", 1)[1]
    )
    baseline_g = []
    challenger_g = []
    baseline_a = []
    challenger_a = []
    for decision in primary:
        signals = signal_cache[decision.decision_id]
        features = model_feature_map(decision, signals)
        g_target = value_model.probabilities(features, temperature=selected_temperature)
        a_target = _strong_target(signals, decision.candidates)
        baseline = baseline_by_id[decision.decision_id]
        challenger = challenger_by_id[decision.decision_id]
        baseline_g.append(_observation(decision, baseline.behavior, g_target, baseline.q_values))
        challenger_g.append(_observation(decision, challenger.behavior, g_target, baseline.q_values))
        baseline_a.append(_observation(decision, baseline.behavior, a_target, baseline.q_values))
        challenger_a.append(_observation(decision, challenger.behavior, a_target, baseline.q_values))

    def policy_summary(g_rows, a_rows):
        g = evaluate_policy(g_rows, 20.0)
        a = evaluate_policy(a_rows, 20.0)
        return {
            "G": asdict(g),
            "A": asdict(a),
            "G_minus_A_dr": g.dr - a.dr,
            "G_minus_A_direct": g.direct - a.direct,
            "G_minus_A_snips": g.snips - a.snips,
            "G_overlap": policy_overlap_diagnostics(g_rows),
            "G_local_overlap": policy_overlap_slices(primary, g_rows),
        }

    baseline_overall = baseline_diags["overall"]
    challenger_overall = challenger_diags["overall"]
    report = {
        "scope": "development_only",
        "experiment": "candidate_varying_skill_interactions_v1",
        "source_run_id": 36256947308,
        "core_pool": list(CORE_DEVELOPMENT_ENVIRONMENTS),
        "cohort": {
            "cohort_id": cohort["cohort_id"],
            "selected_drafts_sha256": cohort["selected_drafts_sha256"],
            "train_drafts": len(train_ids),
            "validation_drafts": len({row.draft_id for row in validation}),
            "assessment_drafts_withheld": int(cohort["split_counts"]["assessment"]),
        },
        "assessment_opened": False,
        "assessment_boundary": {
            "outcomes_loaded_into_pipeline": False,
            "outcomes_used_for_fit": False,
            "outcomes_scored": False,
        },
        "specification": {
            "baseline": "current shared-coefficient propensity from source run",
            "challenger": [
                "candidate-varying current terms only",
                "train-complement-standardized skill x log strong-choice probability",
                "train-complement-standardized skill x GIH",
                "train-complement-standardized skill x IWD",
                "train-complement-standardized experience x log strong-choice probability",
                "rank group x log strong-choice probability",
            ],
            "propensity_l2": args.propensity_l2,
            "q_value_model_changed": False,
            "contextual_value_model_changed": False,
        },
        "standardizer": standardizer.__dict__,
        "baseline_propensity": baseline_diags,
        "challenger_propensity": challenger_diags,
        "comparison": {
            "validation_log_loss_delta_challenger_minus_baseline": (
                challenger_overall["log_loss"] - baseline_overall["log_loss"]
            ),
            "validation_top1_accuracy_delta": (
                challenger_overall["top1_accuracy"] - baseline_overall["top1_accuracy"]
            ),
            "validation_calibration_mae_baseline": _calibration_mae(baseline_diags),
            "validation_calibration_mae_challenger": _calibration_mae(challenger_diags),
            "downstream_ope_sensitivity_cap20": {
                "baseline_behavior": policy_summary(baseline_g, baseline_a),
                "challenger_behavior": policy_summary(challenger_g, challenger_a),
                "note": (
                    "Development-only sensitivity: target G/value model and Q nuisance are held fixed "
                    "from source run 36256947308; only the broad behavior propensity changes."
                ),
            },
        },
        "decision_rule": (
            "Retain the simpler baseline unless the challenger materially improves held-out "
            "propensity fit/calibration or local support without unstable downstream OPE behavior. "
            "This report does not freeze or adopt the challenger automatically."
        ),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "out": str(args.out),
        "cohort_id": cohort["cohort_id"],
        "baseline_log_loss": baseline_overall["log_loss"],
        "challenger_log_loss": challenger_overall["log_loss"],
        "log_loss_delta": report["comparison"]["validation_log_loss_delta_challenger_minus_baseline"],
        "assessment_opened": False,
    }, indent=2))


if __name__ == "__main__":
    main()
