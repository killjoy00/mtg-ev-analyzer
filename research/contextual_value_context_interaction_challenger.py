#!/usr/bin/env python3
"""Development-only deterministic contextual-value challenger.

Behavior/support is reused exactly from the converged strong-offset-only
ablation. Q/value ranking drops strong-player choice features and adds a compact,
predeclared candidate×context interaction map. The locked assessment is never
serialized, loaded, fit, or scored.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path
from typing import Mapping, Sequence

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from contextual_value.checkpoint import draft_id_sha256, load_preprocessed_cohort
from contextual_value.dataset import (
    Decision,
    choose_primary_decision,
    draft_split,
    normalized_draft_weights,
)
from contextual_value.diagnostics import (
    outcome_diagnostics,
    paired_dr_delta_ci,
    paired_policy_delta_slices,
    policy_overlap_diagnostics,
    propensity_diagnostics,
)
from contextual_value.dr import PolicyObservation, aipw_candidate_values, evaluate_policy
from contextual_value.nuisance import NuisancePrediction, NuisanceTrainingRow, nuisance_fold
from contextual_value.outcome import RidgeOutcomeModel
from contextual_value.schema import file_sha256
from contextual_value.value import argmax_policy

SOURCE_RUN = 36256947308
SOURCE_SHA = "aa5b17d96b43f3ce08f52fad55ba17f327472c1b"
ABLATION_RUN = 36280148906
BASELINE_POOLED_RUN = 36276431003
CORE = ("MSH", "SOS", "ECL", "TLA")
SET_DEVIATIONS = ("SOS", "ECL", "TLA")
INTERACTION_SIGNALS = ("gih_wr", "gnd_wr", "deck_inclusion_probability")
STRONG_FEATURES = {
    "strong_choice_probability",
    "log_strong_choice_probability",
}
Q_L2 = 10.0
VALUE_L2 = 10.0
PSEUDO_CAP = 20.0
WEIGHT_CAPS = (10.0, 20.0, 50.0)
EXPECTED_INTERACTIONS = tuple(
    [f"ctx:{signal}:pick_progress" for signal in INTERACTION_SIGNALS]
    + [f"ctx:{signal}:pool_progress" for signal in INTERACTION_SIGNALS]
    + [
        f"ctx:{signal}:set={expansion}"
        for signal in INTERACTION_SIGNALS
        for expansion in SET_DEVIATIONS
    ]
)


def parse_args():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="mode", required=True)

    fold = sub.add_parser("fit-fold")
    fold.add_argument("--fold", type=int, required=True)
    fold.add_argument("--cohort-dir", type=Path, required=True)
    fold.add_argument("--feature-shard", action="append", type=Path, required=True)
    fold.add_argument("--held-features", type=Path, required=True)
    fold.add_argument("--held-report", type=Path, required=True)
    fold.add_argument("--behavior-predictions", type=Path, required=True)
    fold.add_argument("--behavior-report", type=Path, required=True)
    fold.add_argument("--source-sha", required=True)
    fold.add_argument("--out", type=Path, required=True)

    aggregate = sub.add_parser("aggregate")
    aggregate.add_argument("--cohort-dir", type=Path, required=True)
    aggregate.add_argument("--held-feature", action="append", type=Path, required=True)
    aggregate.add_argument("--challenger-prediction", action="append", type=Path, required=True)
    aggregate.add_argument("--challenger-report", action="append", type=Path, required=True)
    aggregate.add_argument("--ablation-report", type=Path, required=True)
    aggregate.add_argument("--source-sha", required=True)
    aggregate.add_argument("--out", type=Path, required=True)
    return parser.parse_args()


def _load_cohort(root: Path, source_sha: str):
    if source_sha != SOURCE_SHA:
        raise SystemExit("unexpected frozen source SHA")
    raw = json.loads((root / "cohort-manifest.json").read_text(encoding="utf-8"))
    if raw.get("code_revision") != source_sha:
        raise SystemExit("cohort source revision mismatch")
    if raw.get("assessment_outcomes_serialized") is not False:
        raise SystemExit("assessment outcomes were serialized")

    prior = os.environ.pop("GITHUB_SHA", None)
    try:
        decisions, games, manifest = load_preprocessed_cohort(root)
    finally:
        if prior is not None:
            os.environ["GITHUB_SHA"] = prior
    if any(draft_split(row.draft_id) == "assessment" for row in decisions):
        raise SystemExit("assessment decision entered development cohort")
    return decisions, games, manifest


def _parts(train: Sequence[Decision], validation: Sequence[Decision], fold: int):
    all_ids = frozenset(row.draft_id for row in train)
    if fold == -1:
        held = list(validation)
        return all_ids, frozenset(row.draft_id for row in held), held
    if fold < 0 or fold >= 5:
        raise SystemExit("fold must be -1 or 0..4")
    held_ids = frozenset(
        draft_id for draft_id in all_ids
        if nuisance_fold(draft_id, 5) == fold
    )
    training_ids = frozenset(all_ids - held_ids)
    held = [row for row in train if row.draft_id in held_ids]
    if not training_ids or not held_ids or not held:
        raise SystemExit("empty nuisance fold partition")
    return training_ids, held_ids, held


def _read_jsonl_gz(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def _write_predictions(path: Path, rows: Sequence[NuisancePrediction]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        for row in sorted(rows, key=lambda item: item.decision_id):
            handle.write(json.dumps(asdict(row), sort_keys=True) + "\n")


def _read_predictions(path: Path) -> dict[str, NuisancePrediction]:
    result = {}
    for raw in _read_jsonl_gz(path):
        row = NuisancePrediction(**raw)
        if row.decision_id in result:
            raise SystemExit(f"{path}: duplicate prediction")
        result[row.decision_id] = row
    return result


def _read_training_rows(
    paths: Sequence[Path],
    *,
    manifest: Mapping[str, object],
    source_sha: str,
    fold: int,
    training_ids: frozenset[str],
    held_ids: frozenset[str],
):
    rows = []
    seen = set()
    expected_training = draft_id_sha256(training_ids)
    expected_held = draft_id_sha256(held_ids)
    for path in paths:
        meta_path = path.with_name(path.name.replace(".jsonl.gz", ".meta.json"))
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        expansion = meta.get("expansion")
        if expansion not in CORE or expansion in seen:
            raise SystemExit(f"{path}: invalid or duplicate expansion")
        expected = {
            "kind": "nuisance_training_features",
            "cohort_id": manifest["cohort_id"],
            "selected_drafts_sha256": manifest["selected_drafts_sha256"],
            "code_revision": source_sha,
            "fold": fold,
            "training_drafts_sha256": expected_training,
            "held_drafts_sha256": expected_held,
            "payload_sha256": file_sha256(path),
        }
        for key, value in expected.items():
            if meta.get(key) != value:
                raise SystemExit(f"{path}: incompatible {key}")
        before = len(rows)
        for raw in _read_jsonl_gz(path):
            rows.append(NuisanceTrainingRow(**raw))
        if len(rows) - before != int(meta.get("row_count", -1)):
            raise SystemExit(f"{path}: row-count mismatch")
        seen.add(expansion)
    if seen != set(CORE):
        raise SystemExit("incomplete core feature shards")
    if {row.draft_id for row in rows} != set(training_ids):
        raise SystemExit("training rows do not cover full outer complement")
    return rows


def _ranking_features(full: Mapping[str, float]) -> dict[str, float]:
    """Drop strong-player ranking features and add frozen candidate×context terms."""
    result = {
        name: float(value)
        for name, value in full.items()
        if name not in STRONG_FEATURES
    }
    pick_progress = min(1.0, max(0.0, float(full.get("pick_number", 0.0)) / 14.0))
    pool_progress = min(1.0, max(0.0, float(full.get("pool_size", 0.0)) / 45.0))

    for signal in INTERACTION_SIGNALS:
        if signal not in full:
            continue
        value = float(full[signal])
        result[f"ctx:{signal}:pick_progress"] = value * pick_progress
        result[f"ctx:{signal}:pool_progress"] = value * pool_progress
        for expansion in SET_DEVIATIONS:
            result[f"ctx:{signal}:set={expansion}"] = (
                value * float(full.get(f"set={expansion}", 0.0))
            )
    return result


def _assert_ranking_feature_contract(feature_names: Sequence[str]):
    names = set(feature_names)
    leaked = sorted(names & STRONG_FEATURES)
    if leaked:
        raise SystemExit(f"strong-player ranking features leaked: {leaked}")
    missing = sorted(set(EXPECTED_INTERACTIONS) - names)
    if missing:
        raise SystemExit(f"expected candidate-context interactions missing: {missing}")


def _verify_ablation_checkpoint(
    *,
    fold: int,
    held_report: Path,
    behavior_report: Path,
    manifest: Mapping[str, object],
):
    held = json.loads(held_report.read_text(encoding="utf-8"))
    behavior = json.loads(behavior_report.read_text(encoding="utf-8"))

    if held.get("scope") != "development_only":
        raise SystemExit("held checkpoint is not development-only")
    if held.get("source_run") != SOURCE_RUN or held.get("baseline_pooled_run") != BASELINE_POOLED_RUN:
        raise SystemExit("held checkpoint source provenance mismatch")
    if held.get("source_sha") != SOURCE_SHA or held.get("cohort_id") != manifest["cohort_id"]:
        raise SystemExit("held checkpoint cohort provenance mismatch")
    if int(held.get("fold")) != fold:
        raise SystemExit("held checkpoint fold mismatch")
    if held.get("assessment_opened") is not False or held.get("assessment_outcomes_used") is not False:
        raise SystemExit("held checkpoint assessment boundary violation")

    if behavior.get("scope") != "development_only":
        raise SystemExit("behavior checkpoint is not development-only")
    if behavior.get("source_run") != SOURCE_RUN or behavior.get("baseline_pooled_run") != BASELINE_POOLED_RUN:
        raise SystemExit("behavior checkpoint source provenance mismatch")
    if behavior.get("source_sha") != SOURCE_SHA or behavior.get("cohort_id") != manifest["cohort_id"]:
        raise SystemExit("behavior checkpoint cohort provenance mismatch")
    if behavior.get("profile") != "strong_offset_only":
        raise SystemExit("behavior checkpoint is not strong-offset-only")
    if int(behavior.get("fold")) != fold:
        raise SystemExit("behavior checkpoint fold mismatch")
    spec = behavior.get("profile_spec") or {}
    if spec.get("offset_mode") != "keep":
        raise SystemExit("strong-player behavior offset was not retained")
    dropped = set(spec.get("drop_exact") or [])
    if not STRONG_FEATURES.issubset(dropped):
        raise SystemExit("strong-player learned features were not removed in behavior checkpoint")
    if behavior.get("assessment_opened") is not False or behavior.get("assessment_outcomes_used") is not False:
        raise SystemExit("behavior checkpoint assessment boundary violation")


def run_fit_fold(args):
    decisions, _games, manifest = _load_cohort(args.cohort_dir, args.source_sha)
    train = [row for row in decisions if draft_split(row.draft_id) == "train"]
    validation = [row for row in decisions if draft_split(row.draft_id) == "validation"]
    training_ids, held_ids, held = _parts(train, validation, args.fold)

    _verify_ablation_checkpoint(
        fold=args.fold,
        held_report=args.held_report,
        behavior_report=args.behavior_report,
        manifest=manifest,
    )
    training_rows = _read_training_rows(
        args.feature_shard,
        manifest=manifest,
        source_sha=args.source_sha,
        fold=args.fold,
        training_ids=training_ids,
        held_ids=held_ids,
    )
    held_features = {
        row["decision_id"]: row
        for row in _read_jsonl_gz(args.held_features)
    }
    if set(held_features) != {row.decision_id for row in held}:
        raise SystemExit("held feature checkpoint does not exactly cover held decisions")

    behavior = _read_predictions(args.behavior_predictions)
    if set(behavior) != set(held_features):
        raise SystemExit("strong-offset behavior predictions do not align with held features")

    q = RidgeOutcomeModel.fit(
        [
            _ranking_features(row.features[row.selected_action])
            for row in training_rows
        ],
        [float(row.outcome) for row in training_rows],
        sample_weights=[float(row.sample_weight) for row in training_rows],
        l2=Q_L2,
    )
    _assert_ranking_feature_contract(q.feature_names)

    predictions = []
    for decision in held:
        source = held_features[decision.decision_id]
        full = source["features"]
        ranking = {
            action: _ranking_features(features)
            for action, features in full.items()
        }
        prior = behavior[decision.decision_id]
        if prior.fold != args.fold or prior.training_draft_count != len(training_ids):
            raise SystemExit("behavior nuisance fold/training provenance mismatch")
        predictions.append(NuisancePrediction(
            decision_id=decision.decision_id,
            draft_id=decision.draft_id,
            fold=args.fold,
            training_draft_count=len(training_ids),
            behavior={key: float(value) for key, value in prior.behavior.items()},
            q_values={
                action: float(q.predict(ranking[action]))
                for action in decision.candidates
            },
        ))

    args.out.mkdir(parents=True, exist_ok=True)
    prediction_path = args.out / f"context-interaction-fold-{args.fold}.jsonl.gz"
    _write_predictions(prediction_path, predictions)
    report = {
        "scope": "development_only",
        "source_run": SOURCE_RUN,
        "source_sha": SOURCE_SHA,
        "ablation_run": ABLATION_RUN,
        "baseline_pooled_run": BASELINE_POOLED_RUN,
        "cohort_id": manifest["cohort_id"],
        "fold": args.fold,
        "training_drafts": len(training_ids),
        "held_drafts": len(held_ids),
        "training_rows": len(training_rows),
        "held_predictions": len(predictions),
        "behavior": "reused_exactly_from_strong_offset_only_ablation",
        "ranking_strong_player_features_removed": True,
        "q_l2": Q_L2,
        "q_feature_names": list(q.feature_names),
        "candidate_context_interactions": list(EXPECTED_INTERACTIONS),
        "assessment_opened": False,
        "assessment_outcomes_used": False,
    }
    (args.out / f"context-interaction-fold-{args.fold}-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _load_held(paths: Sequence[Path]):
    result = {}
    for path in paths:
        for row in _read_jsonl_gz(path):
            key = row["decision_id"]
            if key in result:
                raise SystemExit("duplicate held-feature decision")
            result[key] = row
    return result


def _load_challenger(paths: Sequence[Path]):
    result = {}
    for path in paths:
        for raw in _read_jsonl_gz(path):
            row = NuisancePrediction(**raw)
            if row.decision_id in result:
                raise SystemExit("duplicate challenger prediction")
            result[row.decision_id] = row
    return result


def _primary(decisions: Sequence[Decision]):
    grouped = defaultdict(list)
    for row in decisions:
        grouped[row.draft_id].append(row)
    chosen = []
    for draft_id in sorted(grouped):
        row = choose_primary_decision(grouped[draft_id])
        if row is not None:
            chosen.append(row)
    return chosen


def _fit_value(
    train: Sequence[Decision],
    predictions: Mapping[str, NuisancePrediction],
    held_features: Mapping[str, Mapping[str, object]],
):
    weights = normalized_draft_weights(train)
    rows = []
    targets = []
    sample_weights = []
    for decision in train:
        prediction = predictions[decision.decision_id]
        if prediction.fold != nuisance_fold(decision.draft_id, 5):
            raise SystemExit("challenger train nuisance fold mismatch")
        full = held_features[decision.decision_id]["features"]
        features = {
            action: _ranking_features(row)
            for action, row in full.items()
        }
        pseudo = aipw_candidate_values(
            decision.candidates,
            decision.selected_card,
            float(decision.event_match_wins),
            prediction.behavior,
            prediction.q_values,
            weight_cap=PSEUDO_CAP,
        )
        row_weight = weights[decision.decision_id] / len(decision.candidates)
        for candidate in decision.candidates:
            rows.append(features[candidate])
            targets.append(float(pseudo[candidate]))
            sample_weights.append(row_weight)

    model = RidgeOutcomeModel.fit(
        rows,
        targets,
        sample_weights=sample_weights,
        l2=VALUE_L2,
    )
    _assert_ranking_feature_contract(model.feature_names)
    return model


def _observation(
    decision: Decision,
    prediction: NuisancePrediction,
    target: Mapping[str, float],
):
    return PolicyObservation(
        action=decision.selected_card,
        outcome=float(decision.event_match_wins),
        behavior=prediction.behavior,
        target=target,
        q_values=prediction.q_values,
        cluster=decision.draft_id,
    )


def _estimate(observations):
    return {
        str(int(cap)): asdict(evaluate_policy(observations, cap))
        for cap in WEIGHT_CAPS
    }


def _strong_target(full_features):
    values = {
        action: float(row.get("strong_choice_probability", 0.0))
        for action, row in full_features.items()
    }
    return argmax_policy(values)


def run_aggregate(args):
    decisions, _games, manifest = _load_cohort(args.cohort_dir, args.source_sha)
    train = [row for row in decisions if draft_split(row.draft_id) == "train"]
    validation = [row for row in decisions if draft_split(row.draft_id) == "validation"]
    if any(draft_split(row.draft_id) == "assessment" for row in decisions):
        raise SystemExit("assessment decision entered aggregate")

    held = _load_held(args.held_feature)
    predictions = _load_challenger(args.challenger_prediction)
    expected = {row.decision_id for row in train + validation}
    if set(held) != expected or set(predictions) != expected:
        raise SystemExit("challenger inputs do not exactly cover development decisions")

    reports = [
        json.loads(path.read_text(encoding="utf-8"))
        for path in args.challenger_report
    ]
    if {int(row["fold"]) for row in reports} != {-1, 0, 1, 2, 3, 4}:
        raise SystemExit("incomplete challenger fold reports")
    for row in reports:
        if row.get("cohort_id") != manifest["cohort_id"]:
            raise SystemExit("challenger fold cohort mismatch")
        if row.get("ranking_strong_player_features_removed") is not True:
            raise SystemExit("challenger fold retained strong-player ranking feature")
        if row.get("candidate_context_interactions") != list(EXPECTED_INTERACTIONS):
            raise SystemExit("challenger interaction specification drift")
        if row.get("assessment_opened") is not False or row.get("assessment_outcomes_used") is not False:
            raise SystemExit("challenger fold assessment boundary violation")

    train_ids = {row.decision_id for row in train}
    validation_ids = {row.decision_id for row in validation}
    train_predictions = {key: predictions[key] for key in train_ids}
    validation_predictions = {key: predictions[key] for key in validation_ids}

    value = _fit_value(train, train_predictions, held)
    primary = _primary(validation)

    incumbent = []
    challenger = []
    score_margins = []
    interaction_variation = defaultdict(int)
    for decision in primary:
        prediction = validation_predictions[decision.decision_id]
        full = held[decision.decision_id]["features"]
        ranking = {
            action: _ranking_features(row)
            for action, row in full.items()
        }
        scores = {
            action: float(value.predict(ranking[action]))
            for action in decision.candidates
        }
        target = argmax_policy(scores)
        incumbent_target = _strong_target(full)
        challenger.append(_observation(decision, prediction, target))
        incumbent.append(_observation(decision, prediction, incumbent_target))

        ordered = sorted(scores.values(), reverse=True)
        if len(ordered) >= 2:
            score_margins.append(ordered[0] - ordered[1])

        for feature in EXPECTED_INTERACTIONS:
            values = [float(ranking[action].get(feature, 0.0)) for action in decision.candidates]
            if max(values) - min(values) > 1e-12:
                interaction_variation[feature] += 1

    a = _estimate(incumbent)
    g = _estimate(challenger)
    deltas = {
        cap: {
            "dr": g[cap]["dr"] - a[cap]["dr"],
            "direct": g[cap]["direct"] - a[cap]["direct"],
            "snips": g[cap]["snips"] - a[cap]["snips"],
            "ipw": g[cap]["ipw"] - a[cap]["ipw"],
        }
        for cap in ("10", "20", "50")
    }
    ci = paired_dr_delta_ci(challenger, incumbent, weight_cap=20.0)

    ablation = json.loads(args.ablation_report.read_text(encoding="utf-8"))
    control = ablation["ablations"]["strong_offset_only"]
    control_argmax = control["G_argmax_minus_A_cap20"]
    control_stochastic = control["G_minus_A_cap20"]

    report = {
        "scope": "development_only",
        "assessment_opened": False,
        "assessment_boundary": {
            "outcomes_loaded_into_pipeline": False,
            "outcomes_used_for_fit": False,
            "outcomes_scored": False,
        },
        "source_run": SOURCE_RUN,
        "source_sha": SOURCE_SHA,
        "ablation_run": ABLATION_RUN,
        "cohort_id": manifest["cohort_id"],
        "challenger_spec": {
            "behavior": "converged strong-offset-only propensity reused unchanged",
            "ranking_strong_player_features": "removed",
            "target_policy": "deterministic_argmax",
            "q_l2": Q_L2,
            "value_l2": VALUE_L2,
            "pseudo_outcome_weight_cap": PSEUDO_CAP,
            "candidate_context_interactions": list(EXPECTED_INTERACTIONS),
            "set_reference": "MSH",
            "skill_or_rank_interactions": False,
        },
        "models": {
            "A_incumbent": a,
            "C1_context_interaction_argmax": g,
        },
        "C1_minus_A": {
            "by_cap": deltas,
            "cap20_dr_ci95": ci,
        },
        "control_from_ablation_run": {
            "strong_offset_only_no_interactions_argmax_minus_A_cap20": control_argmax,
            "strong_offset_only_no_interactions_stochastic_minus_A_cap20": control_stochastic,
        },
        "diagnostics": {
            "outcome_q_train_oof": outcome_diagnostics(
                train,
                [train_predictions[row.decision_id] for row in train],
            ),
            "outcome_q_validation": outcome_diagnostics(
                validation,
                [validation_predictions[row.decision_id] for row in validation],
            ),
            "propensity_validation": propensity_diagnostics(
                validation,
                [validation_predictions[row.decision_id] for row in validation],
            ),
            "overlap_C1": policy_overlap_diagnostics(challenger),
            "stability_C1_vs_A": paired_policy_delta_slices(
                primary,
                challenger,
                incumbent,
                weight_cap=20.0,
            ),
            "interaction_variation_on_primary": {
                feature: {
                    "varying_primary_decisions": interaction_variation[feature],
                    "varying_fraction": interaction_variation[feature] / len(primary),
                }
                for feature in EXPECTED_INTERACTIONS
            },
            "score_margin": {
                "n": len(score_margins),
                "mean": (
                    sum(score_margins) / len(score_margins)
                    if score_margins else None
                ),
                "min": min(score_margins) if score_margins else None,
                "max": max(score_margins) if score_margins else None,
            },
        },
        "value_model": {
            "feature_names": list(value.feature_names),
            "coefficients": list(value.coefficients),
            "l2": value.l2,
        },
        "interpretation_boundary": (
            "Exploratory development challenger created after validation-visible "
            "ablations. A favorable result does not authorize assessment opening; "
            "the challenger must first be frozen and complete its own required "
            "diagnostic/ablation/OOD checklist."
        ),
    }

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "context-interaction-challenger-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "C1_minus_A": report["C1_minus_A"],
        "control_argmax": control_argmax,
        "q_validation": report["diagnostics"]["outcome_q_validation"]["overall"],
        "overlap": report["diagnostics"]["overlap_C1"],
    }, indent=2, sort_keys=True))


def main():
    args = parse_args()
    if args.mode == "fit-fold":
        run_fit_fold(args)
    else:
        run_aggregate(args)


if __name__ == "__main__":
    main()
