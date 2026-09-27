#!/usr/bin/env python3
"""Export the frozen four-way #529 score models for fresh-environment confirmation.

The resulting bundle contains the exact core-fitted H, J, N, simple-Q, and rich-Q
score layers used by the bounded margin comparison. It is constructed only from
core train artifacts and asserts parity against the retained core validation Q
scores before it can be used elsewhere.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pickle
import sqlite3
import sys
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "research"))

from contextual_value_margin_comparison import (
    J_L2,
    VALUE_L2,
    _align_prediction_arrays,
    _design,
    _fit_from_stats,
    _fit_j,
    _fold_from_path,
    _j_rows,
    _load_npz,
    _prediction_map,
    _pseudo_from_arrays,
    _raw_coef,
    _sum_stats,
    _suff,
)
from contextual_value_phase_a_bakeoff import (
    HGB_REG,
    RIDGE_L2,
    _fit_weighted_ridge,
    _load_all_candidates,
    _load_decisions,
    _load_selected_candidates,
    _predict_ridge,
    _schema,
    _simple_indices,
    _state_control_indices,
    _state_nonlinear_indices,
)

# Numerical re-fit parity only; observed retained-vs-reconstructed simple-Q drift is ~1.75e-8.
TOL = 5e-8


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--train-shard", action="append", type=Path, required=True)
    p.add_argument("--validation-shard", type=Path, required=True)
    p.add_argument("--strong-prediction", action="append", type=Path, required=True)
    p.add_argument("--no-strong-prediction", action="append", type=Path, required=True)
    p.add_argument("--feature-report", type=Path, required=True)
    p.add_argument("--compact-db", type=Path, required=True)
    p.add_argument("--compact-schema", type=Path, required=True)
    p.add_argument("--margin-report", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    return p.parse_args()


def _std_payload(model):
    mean, scale, active, intercept, beta = model
    raw = np.zeros(len(mean), dtype=np.float64)
    raw[active] = beta / scale[active]
    return {
        "mean": mean.tolist(),
        "scale": scale.tolist(),
        "active": active.astype(int).tolist(),
        "intercept": float(intercept),
        "beta": beta.tolist(),
        "raw": raw.tolist(),
    }


def main():
    args = parse_args()
    margin = json.loads(args.margin_report.read_text(encoding="utf-8"))
    if margin.get("assessment_opened") is not False or margin.get("parity", {}).get("passed") is not True:
        raise SystemExit("source margin comparison is not a valid frozen source")
    if float(margin["models"]["J_l2"]) != J_L2:
        raise SystemExit("source margin comparison J L2 mismatch")

    feature_report = json.loads(args.feature_report.read_text(encoding="utf-8"))
    if feature_report.get("assessment_opened") is not False:
        raise SystemExit("feature report assessment boundary violation")
    state_names = list(feature_report["state_feature_names"])
    candidate_names = list(feature_report["candidate_feature_names"])

    shard_paths = {_fold_from_path(p): p for p in args.train_shard}
    strong_paths = {_fold_from_path(p): p for p in args.strong_prediction}
    no_paths = {_fold_from_path(p): p for p in args.no_strong_prediction}
    if set(shard_paths) != set(range(5)):
        raise SystemExit("train shards must be folds 0..4")
    if set(strong_paths) != set(range(5)) or set(no_paths) != set(range(5)):
        raise SystemExit("training predictions must be folds 0..4")

    stats = {}
    jparts = {}
    for fold in range(5):
        sh = _load_npz(shard_paths[fold])
        if int(sh["fold"][0]) != fold:
            raise SystemExit("training shard fold mismatch")
        qs, bs = _align_prediction_arrays(sh, _prediction_map(strong_paths[fold]))
        qn, bn = _align_prediction_arrays(sh, _prediction_map(no_paths[fold]))
        phin = _pseudo_from_arrays(sh, qn, bn)
        x, w = _design(sh)
        stats[fold] = _suff(x, w, sh["phi_simple"].astype(np.float64), phin)
        ids, xj, xs, base, y = _j_rows(sh, qs)
        jparts[fold] = {"ids": ids, "xj": xj, "xs": xs, "base": base, "y": y}

    all_stats = _sum_stats([stats[f] for f in range(5)])
    h_model = _fit_from_stats(all_stats, "rhs_h")
    n_model = _fit_from_stats(all_stats, "rhs_n")
    all_jx = np.concatenate([jparts[f]["xj"] for f in range(5)])
    all_js = np.concatenate([jparts[f]["xs"] for f in range(5)])
    all_base = np.concatenate([jparts[f]["base"] for f in range(5)])
    all_y = np.concatenate([jparts[f]["y"] for f in range(5)])
    j_model = _fit_j(all_jx, all_y, all_base)
    state_model = _fit_j(all_js, all_y, all_base)

    schema = _schema(args.compact_schema)
    if list(schema["state_feature_names"]) != state_names or list(schema["candidate_feature_names"]) != candidate_names:
        raise SystemExit("compact/feature-report schema mismatch")
    simple_state_idx = _simple_indices(state_names)
    simple_candidate_idx = _simple_indices(candidate_names)
    control_idx = _state_control_indices(state_names)
    nonlinear_idx = _state_nonlinear_indices(state_names)

    conn = sqlite3.connect(f"file:{args.compact_db}?mode=ro", uri=True)
    try:
        train = _load_decisions(conn, "train", len(state_names))
        train_selected = _load_selected_candidates(conn, "train", len(candidate_names), train["decision_idx"])
        held = _load_decisions(conn, "held", len(state_names))
        held_cand, held_names, held_offsets = _load_all_candidates(conn, "held", len(candidate_names), held["decision_idx"])
    finally:
        conn.close()

    simple_train_x = np.concatenate([
        train["state"][:, simple_state_idx].astype(np.float64),
        train_selected[:, simple_candidate_idx].astype(np.float64),
    ], axis=1)
    simple_intercept, simple_coef = _fit_weighted_ridge(
        simple_train_x,
        train["outcome"],
        train["sample_weight"],
        l2=RIDGE_L2,
    )

    counts = np.diff(held_offsets).astype(np.int64)
    simple_held_x = np.concatenate([
        np.repeat(held["state"][:, simple_state_idx].astype(np.float64), counts, axis=0),
        held_cand[:, simple_candidate_idx].astype(np.float64),
    ], axis=1)
    simple_pred = _predict_ridge(simple_intercept, simple_coef, simple_held_x)

    control_intercept, control_coef = _fit_weighted_ridge(
        train["state"][:, control_idx],
        train["outcome"],
        train["sample_weight"],
        l2=RIDGE_L2,
    )
    control_pred = _predict_ridge(control_intercept, control_coef, train["state"][:, control_idx])
    q_train_x = np.concatenate([
        train["state"][:, nonlinear_idx].astype(np.float32),
        train_selected.astype(np.float32),
    ], axis=1)
    q_model = HistGradientBoostingRegressor(**HGB_REG)
    q_model.fit(q_train_x, train["outcome"] - control_pred, sample_weight=train["sample_weight"])

    q_held_x = np.concatenate([
        np.repeat(held["state"][:, nonlinear_idx].astype(np.float32), counts, axis=0),
        held_cand.astype(np.float32),
    ], axis=1)
    q_control = _predict_ridge(control_intercept, control_coef, held["state"][:, control_idx])
    rich_pred = np.repeat(q_control, counts) + q_model.predict(q_held_x).astype(np.float64)

    val = _load_npz(args.validation_shard)
    if int(val["fold"][0]) != -1:
        raise SystemExit("validation shard must be fold -1")
    if len(val["candidate_names"]) != len(held_names) or not np.array_equal(val["candidate_names"].astype(str), held_names.astype(str)):
        raise SystemExit("compact held candidates do not align with retained validation shard")
    simple_error = float(np.max(np.abs(simple_pred - val["q_simple"].astype(np.float64))))
    rich_error = float(np.max(np.abs(rich_pred - val["q_rich"].astype(np.float64))))
    if simple_error > TOL or rich_error > TOL:
        raise SystemExit(f"frozen Q parity failed simple={simple_error} rich={rich_error}")

    h_coef = np.asarray(h_model[1], dtype=np.float64)
    n_coef = np.asarray(n_model[1], dtype=np.float64)
    expected_width = len(simple_state_idx) + len(simple_candidate_idx)
    if len(h_coef) != expected_width or len(n_coef) != expected_width or len(simple_coef) != expected_width:
        raise SystemExit("simple model width mismatch")
    if len(_raw_coef(j_model, len(candidate_names))) != len(candidate_names):
        raise SystemExit("J candidate width mismatch")

    bundle = {
        "phase": "four_way_frozen_score_bundle",
        "scope": "core_train_only",
        "assessment_opened": False,
        "assessment_outcomes_used": False,
        "source_margin_phase": margin.get("phase"),
        "models": ["H", "J", "N", "Q"],
        "benchmarks": ["A", "GIH"],
        "constants": {
            "value_l2": VALUE_L2,
            "q_l2": RIDGE_L2,
            "j_l2": J_L2,
            "rich_q": HGB_REG,
        },
        "schema": {
            "state_feature_names": state_names,
            "candidate_feature_names": candidate_names,
            "simple_state_feature_names": [state_names[i] for i in simple_state_idx],
            "simple_candidate_feature_names": [candidate_names[i] for i in simple_candidate_idx],
            "control_state_feature_names": [state_names[i] for i in control_idx],
            "nonlinear_state_feature_names": [state_names[i] for i in nonlinear_idx],
        },
        "H": {"intercept": float(h_model[0]), "coef": h_coef.tolist()},
        "N": {"intercept": float(n_model[0]), "coef": n_coef.tolist()},
        "simple_Q": {"intercept": float(simple_intercept), "coef": np.asarray(simple_coef, dtype=float).tolist()},
        "rich_Q_control": {"intercept": float(control_intercept), "coef": np.asarray(control_coef, dtype=float).tolist()},
        "J": _std_payload(j_model),
        "J_state_only": _std_payload(state_model),
        "parity": {
            "simple_q_validation_max_abs_error": simple_error,
            "rich_q_validation_max_abs_error": rich_error,
            "tolerance": TOL,
            "source_margin_HN_parity_passed": True,
            "passed": True,
        },
    }
    canonical = json.dumps(bundle, sort_keys=True, separators=(",", ":")).encode("utf-8")
    bundle["fingerprint_sha256"] = hashlib.sha256(canonical).hexdigest()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "four-way-freeze.json").write_text(json.dumps(bundle, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    with (args.output_dir / "four-way-rich-q.pkl").open("wb") as f:
        pickle.dump(q_model, f, protocol=pickle.HIGHEST_PROTOCOL)
    print(json.dumps({
        "fingerprint": bundle["fingerprint_sha256"],
        "simple_q_parity": simple_error,
        "rich_q_parity": rich_error,
        "assessment_opened": False,
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()