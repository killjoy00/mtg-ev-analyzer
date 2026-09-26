#!/usr/bin/env python3
"""Development-only contextual-value-v1 ablation audit.

The audit preserves the frozen 8,000-draft development cohort and never reads
assessment outcomes. It materializes held-draft feature maps once, refits the
nuisance models under predeclared feature removals, then refits the contextual
value layer from out-of-fold AIPW pseudo-outcomes.

Ablation comparisons hold the primary target-policy temperature fixed at the
already-selected baseline T=0.25. Validation is diagnostic only.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import statistics
import sys
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path
from typing import Mapping, Sequence

import numpy as np
import scipy
from scipy.optimize import minimize

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from contextual_value.archive import ArchiveSignalProvider
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
from contextual_value.features import model_feature_map, strong_choice_offsets
from contextual_value.nuisance import (
    NuisancePrediction,
    NuisanceTrainingRow,
    nuisance_fold,
)
from contextual_value.outcome import RidgeOutcomeModel
from contextual_value.propensity import (
    LinearSoftmaxPropensityModel,
    PropensityExample,
)
from contextual_value.value import argmax_policy, softmax_values

from contextual_value_propensity_lbfgs import (
    FTOL,
    GTOL,
    L2,
    MAXITER,
    MAXLS,
    SCIPY_VERSION,
    _compile,
    _gradient_self_check,
    _load_source_cohort,
    _meta_path,
    _objective_gradient,
)

CORE = ("MSH", "SOS", "ECL", "TLA")
SOURCE_RUN = 36256947308
SOURCE_SHA = "aa5b17d96b43f3ce08f52fad55ba17f327472c1b"
BASELINE_POOLED_RUN = 36276431003
BASELINE_TEMPERATURE = 0.25
WEIGHT_CAPS = (10.0, 20.0, 50.0)
OUTCOME_L2 = 10.0
VALUE_L2 = 10.0

PROFILE_SPECS = {
    # Full removal: strong choice is absent from learned rows and no longer
    # enters the broad-population propensity as a fixed log-probability offset.
    "no_strong_entirely": {
        "drop_exact": {
            "strong_choice_probability",
            "log_strong_choice_probability",
        },
        "drop_prefix": (),
        "offset_mode": "none",
        "behavior_refit": True,
        "protocol_role": "required_ablation_and_strong_evidence_omitted",
    },
    # Strong evidence only as the existing fixed propensity offset.
    "strong_offset_only": {
        "drop_exact": {
            "strong_choice_probability",
            "log_strong_choice_probability",
        },
        "drop_prefix": (),
        "offset_mode": "keep",
        "behavior_refit": True,
        "protocol_role": "strong_evidence_offset_only",
    },
    # Strong evidence only as learned Q/value/propensity features, no fixed offset.
    "strong_feature_only": {
        "drop_exact": set(),
        "drop_prefix": (),
        "offset_mode": "none",
        "behavior_refit": True,
        "protocol_role": "strong_evidence_feature_only",
    },
    "no_gih": {
        "drop_exact": {
            "gih_wr",
            "log1p_gih_games",
            "gih_x_deck_probability",
        },
        "drop_prefix": (),
        "offset_mode": "keep",
        "behavior_refit": True,
        "protocol_role": "required_ablation",
    },
    "no_iwd": {
        "drop_exact": {"iwd"},
        "drop_prefix": (),
        "offset_mode": "keep",
        "behavior_refit": True,
        "protocol_role": "required_ablation",
    },
    "no_gnd": {
        "drop_exact": {"gnd_wr", "log1p_gnd_games"},
        "drop_prefix": (),
        "offset_mode": "keep",
        "behavior_refit": True,
        "protocol_role": "required_ablation",
    },
    "no_deck_fit": {
        "drop_exact": {
            "deck_inclusion_probability",
            "gih_x_deck_probability",
        },
        "drop_prefix": (),
        "offset_mode": "keep",
        "behavior_refit": True,
        "protocol_role": "required_ablation",
    },
    # These state-only fields are action-invariant in the current feature map,
    # so they algebraically cancel from conditional-logit probabilities.
    "no_pool_context": {
        "drop_exact": {
            "pack_number",
            "pick_number",
            "pool_size",
            "candidate_count",
        },
        "drop_prefix": (),
        "offset_mode": "keep",
        "behavior_refit": False,
        "protocol_role": "required_ablation",
    },
    "no_skill_controls": {
        "drop_exact": {
            "user_game_win_rate",
            "log1p_user_games",
        },
        "drop_prefix": ("rank=",),
        "offset_mode": "keep",
        "behavior_refit": False,
        "protocol_role": "required_ablation",
    },
}

STRUCTURAL_PROTOCOL_ITEMS = {
    "card_metadata": {
        "status": "not_present_in_v1_feature_map",
        "evidence": (
            "model_feature_map explicitly excludes card identity; the feature builder "
            "states that richer metadata/color/archetype features are future work"
        ),
    },
    "relative_to_pack_features": {
        "status": "not_present_in_v1_feature_map",
        "evidence": "no relative-to-pack candidate features exist in model_feature_map",
    },
    "strong_player_prior": {
        "status": "not_implemented_as_distinct_role",
        "evidence": (
            "v1 uses strong evidence as propensity offset and learned feature; no "
            "separate prior mechanism is defined"
        ),
    },
    "strong_player_fallback": {
        "status": "not_implemented_as_distinct_role",
        "evidence": (
            "the frozen protocol requires a fallback comparison, but v1 has no "
            "frozen strong-player fallback rule"
        ),
    },
}


def parse_args():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="mode", required=True)

    held = sub.add_parser("materialize-held")
    held.add_argument("--fold", type=int, required=True)
    held.add_argument("--cohort-dir", type=Path, required=True)
    held.add_argument("--baseline-train", type=Path, required=True)
    held.add_argument("--baseline-validation", type=Path, required=True)
    held.add_argument("--source-sha", required=True)
    held.add_argument("--out", type=Path, required=True)

    fit = sub.add_parser("fit-profile")
    fit.add_argument("--fold", type=int, required=True)
    fit.add_argument("--profile", choices=sorted(PROFILE_SPECS), required=True)
    fit.add_argument("--cohort-dir", type=Path, required=True)
    fit.add_argument("--feature-shard", action="append", type=Path, required=True)
    fit.add_argument("--held-features", type=Path, required=True)
    fit.add_argument("--source-sha", required=True)
    fit.add_argument("--out", type=Path, required=True)

    agg = sub.add_parser("aggregate")
    agg.add_argument("--cohort-dir", type=Path, required=True)
    agg.add_argument("--held-feature", action="append", type=Path, required=True)
    agg.add_argument("--profile-prediction", action="append", type=Path, required=True)
    agg.add_argument("--profile-report", action="append", type=Path, required=True)
    agg.add_argument("--baseline-report", type=Path, required=True)
    agg.add_argument("--source-sha", required=True)
    agg.add_argument("--out", type=Path, required=True)

    return parser.parse_args()


def _parts(train: Sequence[Decision], validation: Sequence[Decision], fold: int):
    all_ids = frozenset(row.draft_id for row in train)
    if fold == -1:
        held = list(validation)
        held_ids = frozenset(row.draft_id for row in held)
        return all_ids, held_ids, held
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


def _write_jsonl_gz(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")


def _read_predictions(path: Path) -> dict[str, NuisancePrediction]:
    result = {}
    for raw in _read_jsonl_gz(path):
        row = NuisancePrediction(**raw)
        if row.decision_id in result:
            raise SystemExit(f"{path}: duplicate nuisance prediction")
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
) -> list[NuisanceTrainingRow]:
    from contextual_value.checkpoint import draft_id_sha256
    from contextual_value.schema import file_sha256

    rows = []
    seen = set()
    for path in paths:
        meta = json.loads(_meta_path(path).read_text(encoding="utf-8"))
        expansion = meta.get("expansion")
        if expansion not in CORE or expansion in seen:
            raise SystemExit(f"{path}: invalid/duplicate expansion {expansion!r}")
        expected = {
            "kind": "nuisance_training_features",
            "cohort_id": manifest["cohort_id"],
            "selected_drafts_sha256": manifest["selected_drafts_sha256"],
            "code_revision": source_sha,
            "fold": fold,
            "training_drafts_sha256": draft_id_sha256(training_ids),
            "held_drafts_sha256": draft_id_sha256(held_ids),
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
        raise SystemExit("feature rows do not cover the training complement")
    return rows


def _drop_row(row: Mapping[str, float], spec: Mapping[str, object]) -> dict[str, float]:
    exact = spec["drop_exact"]
    prefixes = spec["drop_prefix"]
    return {
        name: float(value)
        for name, value in row.items()
        if name not in exact and not any(name.startswith(prefix) for prefix in prefixes)
    }


def _drop_map(
    features: Mapping[str, Mapping[str, float]],
    spec: Mapping[str, object],
) -> dict[str, dict[str, float]]:
    return {
        action: _drop_row(row, spec)
        for action, row in features.items()
    }


def _offsets_for(
    offsets: Mapping[str, float] | None,
    spec: Mapping[str, object],
):
    return offsets if spec["offset_mode"] == "keep" else None


def _fit_propensity(
    examples: Sequence[PropensityExample],
) -> tuple[LinearSoftmaxPropensityModel, dict]:
    if scipy.__version__ != SCIPY_VERSION:
        raise SystemExit(f"expected scipy {SCIPY_VERSION}, found {scipy.__version__}")
    gradient_check = _gradient_self_check(examples)
    names, compiled, total_weight = _compile(examples)

    def objective(beta):
        return _objective_gradient(beta, compiled, total_weight, L2)

    result = minimize(
        objective,
        x0=np.zeros(len(names), dtype=np.float64),
        method="L-BFGS-B",
        jac=True,
        options={
            "gtol": GTOL,
            "ftol": FTOL,
            "maxiter": MAXITER,
            "maxls": MAXLS,
            "maxcor": 20,
        },
    )
    value, gradient = objective(result.x)
    grad_l2 = float(np.linalg.norm(gradient))
    grad_max = float(np.max(np.abs(gradient))) if len(gradient) else 0.0
    if not result.success:
        raise SystemExit(
            f"L-BFGS did not converge: status={result.status} message={result.message}"
        )
    if grad_max > GTOL:
        raise SystemExit(f"L-BFGS gradient criterion failed: {grad_max} > {GTOL}")
    model = LinearSoftmaxPropensityModel(
        feature_names=names,
        coefficients=tuple(float(x) for x in result.x),
        l2=L2,
    )
    return model, {
        "success": True,
        "status": int(result.status),
        "message": str(result.message),
        "iterations": int(result.nit),
        "function_evaluations": int(result.nfev),
        "objective": float(value),
        "gradient_l2": grad_l2,
        "gradient_max_abs": grad_max,
        "gradient_self_check": gradient_check,
    }


def _primary(decisions: Sequence[Decision]) -> list[Decision]:
    grouped = defaultdict(list)
    for decision in decisions:
        grouped[decision.draft_id].append(decision)
    result = []
    for draft_id in sorted(grouped):
        row = choose_primary_decision(grouped[draft_id])
        if row is not None:
            result.append(row)
    return result


def run_materialize_held(args):
    if args.source_sha != SOURCE_SHA:
        raise SystemExit("unexpected frozen source SHA")
    decisions, games, manifest = _load_source_cohort(args.cohort_dir, args.source_sha)
    train = [row for row in decisions if draft_split(row.draft_id) == "train"]
    validation = [row for row in decisions if draft_split(row.draft_id) == "validation"]
    training_ids, held_ids, held = _parts(train, validation, args.fold)

    baseline = _read_predictions(
        args.baseline_validation if args.fold == -1 else args.baseline_train
    )
    provider = ArchiveSignalProvider(decisions, games)

    rows = []
    variation_present = defaultdict(int)
    variation_count = defaultdict(int)
    for index, decision in enumerate(held, start=1):
        old = baseline.get(decision.decision_id)
        if old is None:
            raise SystemExit("baseline pooled predictions do not cover held decision")
        if int(old.fold) != args.fold:
            raise SystemExit("baseline prediction fold mismatch")
        if int(old.training_draft_count) != len(training_ids):
            raise SystemExit("baseline training-draft provenance mismatch")

        signals = provider(decision, training_ids)
        features = model_feature_map(decision, signals)
        offsets = strong_choice_offsets(signals, decision.candidates)
        names = set().union(*(row.keys() for row in features.values()))
        for name in names:
            values = [float(row.get(name, 0.0)) for row in features.values()]
            variation_present[name] += 1
            if max(values) - min(values) > 1e-12:
                variation_count[name] += 1

        rows.append({
            "decision_id": decision.decision_id,
            "draft_id": decision.draft_id,
            "fold": args.fold,
            "training_draft_count": len(training_ids),
            "features": features,
            "offsets": offsets,
            "selected_action": decision.selected_card,
            "outcome": float(decision.event_match_wins),
            "expansion": decision.expansion,
            "pack_number": int(decision.pack_number),
            "pick_number": int(decision.pick_number),
            "user_game_win_rate": float(decision.user_game_win_rate),
            "user_games_lower_bound": int(decision.user_games_lower_bound),
            "baseline_behavior": dict(old.behavior),
            "baseline_q_values": dict(old.q_values),
        })
        if index % 5000 == 0 or index == len(held):
            print(json.dumps({
                "event": "held_feature_progress",
                "fold": args.fold,
                "completed": index,
                "total": len(held),
            }), flush=True)

    output = args.out / f"held-features-fold-{args.fold}.jsonl.gz"
    _write_jsonl_gz(output, rows)
    report = {
        "scope": "development_only",
        "source_run": SOURCE_RUN,
        "baseline_pooled_run": BASELINE_POOLED_RUN,
        "source_sha": args.source_sha,
        "cohort_id": manifest["cohort_id"],
        "fold": args.fold,
        "training_drafts": len(training_ids),
        "held_drafts": len(held_ids),
        "held_decisions": len(held),
        "assessment_opened": False,
        "assessment_outcomes_used": False,
        "candidate_variation": {
            name: {
                "present_decisions": variation_present[name],
                "varying_decisions": variation_count[name],
                "varying_fraction_of_held": variation_count[name] / len(held),
            }
            for name in sorted(variation_present)
        },
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / f"held-features-fold-{args.fold}-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def run_fit_profile(args):
    if args.source_sha != SOURCE_SHA:
        raise SystemExit("unexpected frozen source SHA")
    spec = PROFILE_SPECS[args.profile]
    decisions, _games, manifest = _load_source_cohort(args.cohort_dir, args.source_sha)
    train = [row for row in decisions if draft_split(row.draft_id) == "train"]
    validation = [row for row in decisions if draft_split(row.draft_id) == "validation"]
    training_ids, held_ids, held = _parts(train, validation, args.fold)

    rows = _read_training_rows(
        args.feature_shard,
        manifest=manifest,
        source_sha=args.source_sha,
        fold=args.fold,
        training_ids=training_ids,
        held_ids=held_ids,
    )
    expected_training = {
        row.decision_id for row in train if row.draft_id in training_ids
    }
    if {row.decision_id for row in rows} != expected_training:
        raise SystemExit("training rows do not exactly cover outer complement")

    held_rows = {
        row["decision_id"]: row
        for row in _read_jsonl_gz(args.held_features)
    }
    if set(held_rows) != {row.decision_id for row in held}:
        raise SystemExit("held feature shard does not exactly cover held decisions")

    outcome_rows = [
        _drop_row(row.features[row.selected_action], spec)
        for row in rows
    ]
    outcome = RidgeOutcomeModel.fit(
        outcome_rows,
        [row.outcome for row in rows],
        sample_weights=[row.sample_weight for row in rows],
        l2=OUTCOME_L2,
    )

    propensity = None
    propensity_solver = {
        "mode": "reused_baseline_behavior",
        "reason": "removed features are action-invariant in current conditional-logit map",
    }
    if spec["behavior_refit"]:
        examples = [
            PropensityExample(
                features=_drop_map(row.features, spec),
                selected_action=row.selected_action,
                sample_weight=row.sample_weight,
                offsets=_offsets_for(row.offsets, spec),
            )
            for row in rows
        ]
        propensity, propensity_solver = _fit_propensity(examples)

    predictions = []
    for decision in held:
        full = held_rows[decision.decision_id]
        features = _drop_map(full["features"], spec)
        if propensity is None:
            behavior = {
                key: float(value)
                for key, value in full["baseline_behavior"].items()
            }
        else:
            behavior = propensity.probabilities(
                features,
                _offsets_for(full.get("offsets"), spec),
            )
        q_values = {
            action: float(outcome.predict(features[action]))
            for action in decision.candidates
        }
        predictions.append(NuisancePrediction(
            decision_id=decision.decision_id,
            draft_id=decision.draft_id,
            fold=args.fold,
            training_draft_count=len(training_ids),
            behavior=behavior,
            q_values=q_values,
        ))

    args.out.mkdir(parents=True, exist_ok=True)
    prediction_path = args.out / f"{args.profile}-fold-{args.fold}.jsonl.gz"
    _write_jsonl_gz(
        prediction_path,
        (asdict(row) for row in sorted(predictions, key=lambda item: item.decision_id)),
    )
    report = {
        "scope": "development_only",
        "source_run": SOURCE_RUN,
        "baseline_pooled_run": BASELINE_POOLED_RUN,
        "source_sha": args.source_sha,
        "cohort_id": manifest["cohort_id"],
        "profile": args.profile,
        "profile_spec": {
            "drop_exact": sorted(spec["drop_exact"]),
            "drop_prefix": list(spec["drop_prefix"]),
            "offset_mode": spec["offset_mode"],
            "behavior_refit": spec["behavior_refit"],
            "protocol_role": spec["protocol_role"],
        },
        "fold": args.fold,
        "training_drafts": len(training_ids),
        "held_drafts": len(held_ids),
        "training_rows": len(rows),
        "held_predictions": len(predictions),
        "outcome_model_features": list(outcome.feature_names),
        "propensity_solver": propensity_solver,
        "assessment_opened": False,
        "assessment_outcomes_used": False,
    }
    (args.out / f"{args.profile}-fold-{args.fold}-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _load_held(paths: Sequence[Path]):
    result = {}
    fold_of = {}
    for path in paths:
        for row in _read_jsonl_gz(path):
            decision_id = row["decision_id"]
            if decision_id in result:
                raise SystemExit("duplicate held-feature decision")
            result[decision_id] = row
            fold_of[decision_id] = int(row["fold"])
    return result, fold_of


def _load_profile_predictions(paths: Sequence[Path]):
    profiles = defaultdict(dict)
    for path in paths:
        for raw in _read_jsonl_gz(path):
            prediction = NuisancePrediction(**raw)
            name = path.name.rsplit("-fold-", 1)[0]
            if prediction.decision_id in profiles[name]:
                raise SystemExit(f"duplicate prediction for profile {name}")
            profiles[name][prediction.decision_id] = prediction
    return profiles


def _fit_value_from_held(
    train: Sequence[Decision],
    predictions: Mapping[str, NuisancePrediction],
    held_features: Mapping[str, Mapping[str, object]],
    spec: Mapping[str, object],
):
    all_ids = frozenset(row.draft_id for row in train)
    decision_weights = normalized_draft_weights(train)
    rows = []
    targets = []
    weights = []
    for decision in train:
        prediction = predictions[decision.decision_id]
        if prediction.fold != nuisance_fold(decision.draft_id, 5):
            raise SystemExit("profile nuisance fold mismatch")
        held = held_features[decision.decision_id]
        features = _drop_map(held["features"], spec)
        pseudo = aipw_candidate_values(
            decision.candidates,
            decision.selected_card,
            float(decision.event_match_wins),
            prediction.behavior,
            prediction.q_values,
            weight_cap=20.0,
        )
        row_weight = decision_weights[decision.decision_id] / len(decision.candidates)
        for candidate in decision.candidates:
            rows.append(features[candidate])
            targets.append(float(pseudo[candidate]))
            weights.append(row_weight)
    model = RidgeOutcomeModel.fit(rows, targets, sample_weights=weights, l2=VALUE_L2)
    return model, len(all_ids)


def _observation(
    decision: Decision,
    prediction: NuisancePrediction,
    target: Mapping[str, float],
) -> PolicyObservation:
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


def _action_variation(held_features, train_ids):
    present = defaultdict(int)
    varying = defaultdict(int)
    decisions = 0
    for row in held_features.values():
        if row["draft_id"] not in train_ids:
            continue
        decisions += 1
        features = row["features"]
        names = set().union(*(candidate.keys() for candidate in features.values()))
        for name in names:
            present[name] += 1
            values = [float(candidate.get(name, 0.0)) for candidate in features.values()]
            if max(values) - min(values) > 1e-12:
                varying[name] += 1
    return {
        name: {
            "present_decisions": present[name],
            "varying_decisions": varying[name],
            "varying_fraction": varying[name] / decisions if decisions else None,
            "action_invariant_on_all_observed_decisions": varying[name] == 0,
        }
        for name in sorted(present)
    }


def run_aggregate(args):
    if args.source_sha != SOURCE_SHA:
        raise SystemExit("unexpected frozen source SHA")
    decisions, _games, manifest = _load_source_cohort(args.cohort_dir, args.source_sha)
    train = [row for row in decisions if draft_split(row.draft_id) == "train"]
    validation = [row for row in decisions if draft_split(row.draft_id) == "validation"]
    if any(draft_split(row.draft_id) == "assessment" for row in decisions):
        raise SystemExit("assessment decision entered aggregate")

    held_features, _fold_of = _load_held(args.held_feature)
    expected = {row.decision_id for row in train + validation}
    if set(held_features) != expected:
        raise SystemExit("held features do not cover all development decisions exactly once")

    profiles = _load_profile_predictions(args.profile_prediction)
    if set(profiles) != set(PROFILE_SPECS):
        raise SystemExit(
            f"incomplete profile predictions: have={sorted(profiles)}"
        )
    train_ids = {row.decision_id for row in train}
    validation_ids = {row.decision_id for row in validation}
    for name, predictions in profiles.items():
        if set(predictions) != expected:
            raise SystemExit(f"profile {name} does not cover all development decisions")

    reports = []
    for path in args.profile_report:
        reports.append(json.loads(path.read_text(encoding="utf-8")))
    expected_reports = {
        (profile, fold)
        for profile in PROFILE_SPECS
        for fold in (-1, 0, 1, 2, 3, 4)
    }
    observed_reports = {
        (str(row["profile"]), int(row["fold"]))
        for row in reports
    }
    if observed_reports != expected_reports:
        raise SystemExit("profile reports are incomplete")
    for row in reports:
        if row["assessment_opened"] is not False or row["assessment_outcomes_used"] is not False:
            raise SystemExit("assessment boundary violation in profile report")
        solver = row["propensity_solver"]
        if row["profile_spec"]["behavior_refit"]:
            if solver.get("success") is not True:
                raise SystemExit("behavior-refit profile did not converge")
            if float(solver["gradient_max_abs"]) > GTOL:
                raise SystemExit("behavior-refit profile violates gradient gate")
            if float(solver["gradient_self_check"]["max_abs_error"]) > 2e-6:
                raise SystemExit("behavior-refit profile gradient check failed")

    primary = _primary(validation)
    primary_ids = {row.decision_id for row in primary}
    results = {}
    for name, spec in PROFILE_SPECS.items():
        predictions = profiles[name]
        train_predictions = {key: predictions[key] for key in train_ids}
        validation_predictions = {key: predictions[key] for key in validation_ids}

        value_model, training_drafts = _fit_value_from_held(
            train,
            train_predictions,
            held_features,
            spec,
        )

        incumbent_obs = []
        contextual_obs = []
        argmax_obs = []
        for decision in primary:
            prediction = validation_predictions[decision.decision_id]
            full_features = held_features[decision.decision_id]["features"]
            features = _drop_map(full_features, spec)
            scores = {
                action: value_model.predict(features[action])
                for action in decision.candidates
            }
            incumbent = _strong_target(full_features)
            contextual = softmax_values(scores, BASELINE_TEMPERATURE)
            deterministic = argmax_policy(scores)
            incumbent_obs.append(_observation(decision, prediction, incumbent))
            contextual_obs.append(_observation(decision, prediction, contextual))
            argmax_obs.append(_observation(decision, prediction, deterministic))

        a = _estimate(incumbent_obs)
        g = _estimate(contextual_obs)
        argmax = _estimate(argmax_obs)
        cap = "20"
        results[name] = {
            "profile_spec": {
                "drop_exact": sorted(spec["drop_exact"]),
                "drop_prefix": list(spec["drop_prefix"]),
                "offset_mode": spec["offset_mode"],
                "behavior_refit": spec["behavior_refit"],
                "protocol_role": spec["protocol_role"],
            },
            "value_model": {
                "training_drafts": training_drafts,
                "feature_names": list(value_model.feature_names),
                "coefficients": list(value_model.coefficients),
                "l2": value_model.l2,
            },
            "A_incumbent": a,
            "G_fixed_T_0_25": g,
            "G_argmax_secondary": argmax,
            "G_minus_A_cap20": {
                "dr": g[cap]["dr"] - a[cap]["dr"],
                "direct": g[cap]["direct"] - a[cap]["direct"],
                "snips": g[cap]["snips"] - a[cap]["snips"],
                "ipw": g[cap]["ipw"] - a[cap]["ipw"],
                "dr_ci95": paired_dr_delta_ci(
                    contextual_obs,
                    incumbent_obs,
                    weight_cap=20.0,
                ),
            },
            "G_argmax_minus_A_cap20": {
                "dr": argmax[cap]["dr"] - a[cap]["dr"],
                "direct": argmax[cap]["direct"] - a[cap]["direct"],
                "snips": argmax[cap]["snips"] - a[cap]["snips"],
                "ipw": argmax[cap]["ipw"] - a[cap]["ipw"],
                "dr_ci95": paired_dr_delta_ci(
                    argmax_obs,
                    incumbent_obs,
                    weight_cap=20.0,
                ),
            },
            "diagnostics": {
                "outcome_q_validation": outcome_diagnostics(
                    validation,
                    list(validation_predictions.values()),
                ),
                "propensity_validation": propensity_diagnostics(
                    validation,
                    list(validation_predictions.values()),
                ),
                "overlap_G": policy_overlap_diagnostics(contextual_obs),
                "stability_G_vs_A": paired_policy_delta_slices(
                    primary,
                    contextual_obs,
                    incumbent_obs,
                    weight_cap=20.0,
                ),
            },
        }

    baseline = json.loads(args.baseline_report.read_text(encoding="utf-8"))
    baseline_a = baseline["models"]["A_current_v4_strong_player"]["20"]
    baseline_g = baseline["models"]["G_contextual_value"]["selected_estimates"]["20"]
    baseline_f = baseline["models"]["F_direct_q"]["20"]
    action_variation = _action_variation(
        held_features,
        {row.draft_id for row in train},
    )

    report = {
        "scope": "development_only",
        "assessment_opened": False,
        "assessment_boundary": {
            "outcomes_loaded_into_pipeline": False,
            "outcomes_used_for_fit": False,
            "outcomes_scored": False,
        },
        "source_run": SOURCE_RUN,
        "source_sha": args.source_sha,
        "baseline_pooled_run": BASELINE_POOLED_RUN,
        "cohort_id": manifest["cohort_id"],
        "baseline_temperature_held_fixed": BASELINE_TEMPERATURE,
        "baseline_reference": {
            "A_cap20": baseline_a,
            "G_cap20": baseline_g,
            "G_minus_A": {
                "dr": baseline_g["dr"] - baseline_a["dr"],
                "direct": baseline_g["direct"] - baseline_a["direct"],
                "snips": baseline_g["snips"] - baseline_a["snips"],
            },
            "no_propensity_correction_existing_F": {
                "definition": "frozen comparator F: deterministic argmax of direct Q",
                "F_cap20": baseline_f,
                "F_minus_A": {
                    "dr": baseline_f["dr"] - baseline_a["dr"],
                    "direct": baseline_f["direct"] - baseline_a["direct"],
                    "snips": baseline_f["snips"] - baseline_a["snips"],
                },
            },
        },
        "structural_diagnostics": {
            "feature_action_variation_train_oof": action_variation,
            "action_invariant_feature_names": [
                name
                for name, row in action_variation.items()
                if row["action_invariant_on_all_observed_decisions"]
            ],
            "interpretation": (
                "Features that are constant across all candidate actions in a decision "
                "cannot directly change within-pack rankings in the current additive "
                "linear Q/value models and cancel exactly from shared conditional-logit "
                "propensity scores absent interactions."
            ),
            "protocol_items": STRUCTURAL_PROTOCOL_ITEMS,
        },
        "ablations": results,
        "interpretation_boundary": (
            "These are development-only diagnostics. They do not authorize assessment "
            "opening or production promotion. Primary ablation comparisons hold the "
            "already-selected baseline temperature T=0.25 fixed."
        ),
    }

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "ablation-report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    compact = {
        "baseline": report["baseline_reference"]["G_minus_A"],
        "profiles": {
            name: {
                "dr": row["G_minus_A_cap20"]["dr"],
                "direct": row["G_minus_A_cap20"]["direct"],
                "snips": row["G_minus_A_cap20"]["snips"],
                "ci95": row["G_minus_A_cap20"]["dr_ci95"],
                "ess_ratio": row["G_fixed_T_0_25"]["20"]["ess_ratio"],
            }
            for name, row in results.items()
        },
        "action_invariant": report["structural_diagnostics"]["action_invariant_feature_names"],
        "protocol_items": STRUCTURAL_PROTOCOL_ITEMS,
    }
    print(json.dumps(compact, indent=2, sort_keys=True))


def main():
    args = parse_args()
    if args.mode == "materialize-held":
        run_materialize_held(args)
    elif args.mode == "fit-profile":
        run_fit_profile(args)
    else:
        run_aggregate(args)


if __name__ == "__main__":
    main()
