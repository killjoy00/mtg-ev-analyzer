#!/usr/bin/env python3
"""Focused freeze audit for the frozen H challenger in #529.

No model search occurs here. The script:
1. exactly reconstructs H from retained Phase A2 cross-fitted simple pseudo-values;
2. evaluates H/A under the frozen strong-offset-only nuisance;
3. swaps ONLY the behavior nuisance to the pre-existing no-strong-entirely fit;
4. adds draft-cluster bootstrap CIs to predeclared set/pick/skill/experience slices.

Assessment data is neither loaded nor scored.
"""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path
from typing import Mapping, Sequence

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "research"))

from contextual_value.diagnostics import paired_dr_delta_ci, policy_overlap_diagnostics
from contextual_value.dr import PolicyObservation, evaluate_policy
from contextual_value_phase_a_bakeoff import (
    RIDGE_L2,
    WEIGHT_CAPS,
    _argmax_local,
    _experience_group,
    _fit_weighted_ridge,
    _load_train_shards,
    _minimal_decisions,
    _predict_ridge,
    _primary_indices,
    _skill_group,
)

BOOTSTRAP_REPLICATES = 1000
HARM_MARGIN = -0.05
EXPECTED_PRIMARY = 1218
EXPECTED_H_DELTA = {
    "dr": 0.31316527207364153,
    "direct": 0.020655834806143858,
    "snips": 0.31724896487612386,
    "ipw": 0.5333850129547921,
}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train-shard", action="append", type=Path, required=True)
    parser.add_argument("--train-report", action="append", type=Path, required=True)
    parser.add_argument("--validation-shard", type=Path, required=True)
    parser.add_argument("--validation-report", type=Path, required=True)
    parser.add_argument("--no-strong-predictions", type=Path, required=True)
    parser.add_argument("--no-strong-report", type=Path, required=True)
    parser.add_argument("--ablation-report", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    return parser.parse_args()


def _read_jsonl_gz(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def _estimate_by_cap(observations: Sequence[PolicyObservation]) -> dict:
    return {
        str(int(cap)): asdict(evaluate_policy(observations, cap))
        for cap in WEIGHT_CAPS
    }


def _delta(candidate, incumbent, cap: float = 20.0) -> dict:
    left = evaluate_policy(candidate, cap)
    right = evaluate_policy(incumbent, cap)
    return {
        "dr": left.dr - right.dr,
        "direct": left.direct - right.direct,
        "snips": left.snips - right.snips,
        "ipw": left.ipw - right.ipw,
    }


def _behavior_predictions(path: Path) -> dict[str, dict]:
    result = {}
    for raw in _read_jsonl_gz(path):
        key = str(raw["decision_id"])
        if key in result:
            raise SystemExit("duplicate no-strong behavior prediction")
        result[key] = {
            "fold": int(raw["fold"]),
            "training_draft_count": int(raw["training_draft_count"]),
            "behavior": {str(k): float(v) for k, v in raw["behavior"].items()},
        }
    return result


def _observations(
    validation: Mapping[str, np.ndarray],
    primary: Sequence[int],
    chosen_ord: np.ndarray,
    behavior_by_decision: Mapping[str, Mapping[str, float]] | None = None,
):
    result = []
    offsets = validation["offsets"]
    candidate_names = validation["candidate_names"]
    for pos, decision_index in enumerate(primary):
        start, stop = int(offsets[decision_index]), int(offsets[decision_index + 1])
        names = [str(x) for x in candidate_names[start:stop]]
        decision_id = str(validation["decision_ids"][decision_index])
        if behavior_by_decision is None:
            behavior = {
                name: float(validation["behavior"][start + local])
                for local, name in enumerate(names)
            }
        else:
            source = behavior_by_decision.get(decision_id)
            if source is None:
                raise SystemExit(f"alternate behavior missing {decision_id}")
            if set(source) != set(names):
                raise SystemExit(f"alternate behavior candidate mismatch for {decision_id}")
            behavior = {name: float(source[name]) for name in names}

        total = sum(behavior.values())
        if abs(total - 1.0) > 1e-9 or any(value <= 0 for value in behavior.values()):
            raise SystemExit(f"invalid behavior distribution for {decision_id}")

        q_values = {
            name: float(validation["q_simple"][start + local])
            for local, name in enumerate(names)
        }
        selected = names[int(validation["selected_ord"][decision_index])]
        chosen = names[int(chosen_ord[pos])]
        target = {name: 1.0 if name == chosen else 0.0 for name in names}
        result.append(PolicyObservation(
            action=selected,
            outcome=float(validation["outcome"][decision_index]),
            behavior=behavior,
            target=target,
            q_values=q_values,
            cluster=str(validation["draft_ids"][decision_index]),
        ))
    return result


def _slice_label(decision, axis: str) -> str:
    if axis == "set":
        return decision.expansion or "unknown"
    if axis == "pick":
        return f"P{decision.pack_number + 1}P{decision.pick_number + 1}"
    if axis == "skill":
        return _skill_group(float(decision.user_game_win_rate))
    if axis == "experience":
        return _experience_group(int(decision.user_games_lower_bound))
    raise ValueError(axis)


def _slice_intervals(
    decisions,
    candidate: Sequence[PolicyObservation],
    incumbent: Sequence[PolicyObservation],
):
    if len(decisions) != len(candidate) or len(candidate) != len(incumbent):
        raise SystemExit("slice inputs do not align")
    by_draft = {row.draft_id: row for row in decisions}
    result = {}
    for axis in ("set", "pick", "skill", "experience"):
        groups = defaultdict(list)
        for left, right in zip(candidate, incumbent):
            if left.cluster is None or left.cluster != right.cluster:
                raise SystemExit("paired observations do not share draft cluster")
            decision = by_draft.get(str(left.cluster))
            if decision is None:
                raise SystemExit("slice observation missing primary decision")
            groups[_slice_label(decision, axis)].append((left, right))

        result[axis] = {}
        for label, pairs in sorted(groups.items()):
            left = [pair[0] for pair in pairs]
            right = [pair[1] for pair in pairs]
            delta = _delta(left, right)
            ci = paired_dr_delta_ci(
                left,
                right,
                weight_cap=20.0,
                replicates=BOOTSTRAP_REPLICATES,
                seed=20260925,
            )
            result[axis][label] = {
                "n": len(pairs),
                **delta,
                "dr_ci95": list(ci),
                "complete_ci_below_harm_margin": bool(ci[1] < HARM_MARGIN),
                "adequately_powered": None,
                "power_classification_reason": (
                    "the frozen protocol does not define a numeric adequate-power rule"
                ),
            }
    return result


def _ablation_reuse(ablation: Mapping[str, object]) -> dict:
    profiles = dict(ablation.get("ablations") or {})
    wanted = (
        "strong_offset_only",
        "no_strong_entirely",
        "no_deck_fit",
        "no_gih",
        "no_gnd",
        "no_iwd",
        "no_pool_context",
        "no_skill_controls",
    )
    reused = {}
    for name in wanted:
        row = profiles.get(name)
        if not isinstance(row, Mapping):
            continue
        reused[name] = {
            key: row[key]
            for key in (
                "G_argmax_minus_A_cap20",
                "G_argmax_ci95",
                "G_minus_A_cap20",
                "G_ci95",
                "q_validation",
                "propensity_validation",
            )
            if key in row
        }
    return reused


def main():
    args = parse_args()

    train = _load_train_shards(args.train_shard, args.train_report)
    data = np.load(args.validation_shard, allow_pickle=False)
    validation = {key: data[key] for key in data.files}
    validation_report = json.loads(args.validation_report.read_text(encoding="utf-8"))
    if int(validation_report.get("fold", 999)) != -1:
        raise SystemExit("validation shard/report is not fold -1")
    if validation_report.get("assessment_opened") is not False:
        raise SystemExit("validation report assessment boundary violation")
    if validation_report.get("assessment_outcomes_used") is not False:
        raise SystemExit("validation report assessment outcome violation")

    no_strong_report = json.loads(args.no_strong_report.read_text(encoding="utf-8"))
    if no_strong_report.get("scope") != "development_only":
        raise SystemExit("no-strong checkpoint is not development-only")
    if no_strong_report.get("profile") != "no_strong_entirely":
        raise SystemExit("wrong nuisance sensitivity checkpoint")
    if int(no_strong_report.get("fold", 999)) != -1:
        raise SystemExit("no-strong checkpoint is not validation fold")
    if no_strong_report.get("assessment_opened") is not False:
        raise SystemExit("no-strong checkpoint assessment violation")
    if no_strong_report.get("assessment_outcomes_used") is not False:
        raise SystemExit("no-strong checkpoint assessment outcome violation")

    # Refit the already-frozen H value layer exactly from retained OOF simple
    # pseudo-values. No hyperparameter or feature choice occurs here.
    counts = np.diff(train["offsets"]).astype(np.int64)
    row_weight = np.repeat(train["decision_weight"] / counts, counts)
    x_h = np.concatenate(
        [
            np.repeat(train["state_simple"], counts, axis=0),
            train["cand_simple"],
        ],
        axis=1,
    )
    h_intercept, h_coef = _fit_weighted_ridge(
        x_h,
        train["phi_simple"],
        row_weight,
        l2=RIDGE_L2,
    )

    primary = _primary_indices(validation)
    if len(primary) != EXPECTED_PRIMARY:
        raise SystemExit(
            f"expected {EXPECTED_PRIMARY} primary validation drafts, found {len(primary)}"
        )

    h_chosen = np.empty(len(primary), dtype=np.int16)
    incumbent_chosen = np.empty(len(primary), dtype=np.int16)
    for pos, index in enumerate(primary):
        start, stop = int(validation["offsets"][index]), int(validation["offsets"][index + 1])
        names = validation["candidate_names"][start:stop]
        x = np.concatenate(
            [
                np.repeat(validation["state_simple"][index:index + 1], stop - start, axis=0),
                validation["cand_simple"][start:stop],
            ],
            axis=1,
        )
        scores = _predict_ridge(h_intercept, h_coef, x)
        h_chosen[pos] = _argmax_local(scores, names)
        incumbent_chosen[pos] = int(validation["incumbent_ord"][index])

    baseline_h = _observations(validation, primary, h_chosen)
    baseline_a = _observations(validation, primary, incumbent_chosen)
    baseline_delta = _delta(baseline_h, baseline_a)
    reproduction_error = max(
        abs(float(baseline_delta[key]) - value)
        for key, value in EXPECTED_H_DELTA.items()
    )
    if reproduction_error > 1e-9:
        raise SystemExit(
            f"frozen H reproduction failed; max_abs_error={reproduction_error}"
        )

    alt_raw = _behavior_predictions(args.no_strong_predictions)
    validation_ids = {str(x) for x in validation["decision_ids"]}
    if set(alt_raw) != validation_ids:
        raise SystemExit("no-strong predictions do not exactly cover validation decisions")
    alt_behavior = {}
    expected_training = int(validation_report["training_decisions"])
    for decision_id, row in alt_raw.items():
        if int(row["fold"]) != -1:
            raise SystemExit("no-strong prediction fold mismatch")
        if int(row["training_draft_count"]) != expected_training:
            raise SystemExit("no-strong training provenance mismatch")
        alt_behavior[decision_id] = row["behavior"]

    sensitivity_h = _observations(
        validation, primary, h_chosen, behavior_by_decision=alt_behavior
    )
    sensitivity_a = _observations(
        validation, primary, incumbent_chosen, behavior_by_decision=alt_behavior
    )

    primary_decisions = _minimal_decisions(
        validation,
        primary,
        validation["candidate_names"],
        validation["offsets"],
    )
    baseline_slices = _slice_intervals(
        primary_decisions, baseline_h, baseline_a
    )

    baseline_ci = paired_dr_delta_ci(
        baseline_h,
        baseline_a,
        weight_cap=20.0,
        replicates=BOOTSTRAP_REPLICATES,
        seed=20260925,
    )
    sensitivity_ci = paired_dr_delta_ci(
        sensitivity_h,
        sensitivity_a,
        weight_cap=20.0,
        replicates=BOOTSTRAP_REPLICATES,
        seed=20260925,
    )

    ablation = json.loads(args.ablation_report.read_text(encoding="utf-8"))
    report = {
        "scope": "development_only",
        "phase": "H_freeze_core_audit",
        "frozen_H": {
            "behavior": "converged_strong_offset_only",
            "ranking_strong_player_features": False,
            "value_family": "ridge",
            "value_l2": RIDGE_L2,
            "target_policy": "deterministic_argmax",
            "added_context_interactions": False,
        },
        "assessment_opened": False,
        "assessment_boundary": {
            "outcomes_loaded_into_pipeline": False,
            "outcomes_used_for_fit": False,
            "outcomes_scored": False,
        },
        "benchmark_reproduction": {
            "expected_cap20_delta": EXPECTED_H_DELTA,
            "actual_cap20_delta": baseline_delta,
            "max_abs_error": reproduction_error,
            "passed": True,
        },
        "frozen_behavior": {
            "H": _estimate_by_cap(baseline_h),
            "A": _estimate_by_cap(baseline_a),
            "H_minus_A_cap20": {
                **baseline_delta,
                "dr_ci95": list(baseline_ci),
            },
            "H_overlap": policy_overlap_diagnostics(baseline_h),
        },
        "behavior_nuisance_sensitivity": {
            "alternate_nuisance": "no_strong_entirely",
            "selection_policy_changed": False,
            "q_values_changed": False,
            "only_behavior_propensity_changed": True,
            "H": _estimate_by_cap(sensitivity_h),
            "A": _estimate_by_cap(sensitivity_a),
            "H_minus_A_cap20": {
                **_delta(sensitivity_h, sensitivity_a),
                "dr_ci95": list(sensitivity_ci),
            },
            "H_overlap": policy_overlap_diagnostics(sensitivity_h),
        },
        "slice_uncertainty_frozen_behavior": baseline_slices,
        "environment_power": {
            "rule_defined_in_frozen_protocol": False,
            "classification": "unresolved",
            "harm_margin": HARM_MARGIN,
            "note": (
                "CIs are reported, but no set is labeled adequately powered because "
                "the frozen protocol provides no numeric power criterion."
            ),
        },
        "reused_prior_ablation_evidence": _ablation_reuse(ablation),
        "next_gate": {
            "core_freeze_audit_complete": True,
            "historical_ood_stress_required": True,
            "assessment_authorized": False,
        },
    }

    args.out.mkdir(parents=True, exist_ok=True)
    out = args.out / "h-freeze-core-audit.json"
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "benchmark": report["benchmark_reproduction"],
        "frozen_H": report["frozen_behavior"]["H_minus_A_cap20"],
        "no_strong_sensitivity": report["behavior_nuisance_sensitivity"]["H_minus_A_cap20"],
        "environment_power": report["environment_power"],
        "assessment_opened": report["assessment_opened"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
