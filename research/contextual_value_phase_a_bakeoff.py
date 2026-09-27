#!/usr/bin/env python3
"""Frozen Phase A2 H/H1/H2/H3 development bake-off for #529.

This script consumes only validated compact Phase A1 development artifacts and
the retained strong-offset-only behavior nuisance. Assessment remains sealed.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import sqlite3
import sys
import time
from collections import Counter, defaultdict
from dataclasses import asdict
from pathlib import Path
from typing import Mapping, Sequence

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor

from build_replays import stable_score
from contextual_value import PRIMARY_PACK, PRIMARY_PICK_START, PRIMARY_PICK_STOP
from contextual_value.dataset import Decision
from contextual_value.diagnostics import (
    paired_dr_delta_ci,
    paired_policy_delta_slices,
    policy_overlap_diagnostics,
    policy_overlap_slices,
)
from contextual_value.dr import PolicyObservation, evaluate_policy
from contextual_value.propensity import support_threshold

SKLEARN_VERSION = "1.9.1"
WEIGHT_CAPS = (10.0, 20.0, 50.0)
PSEUDO_CAP = 20.0
RIDGE_L2 = 10.0
H2_MAX_OPPONENTS = 4
H3_MARGIN = 0.05

HGB_REG = {
    "loss": "squared_error",
    "learning_rate": 0.05,
    "max_iter": 200,
    "max_leaf_nodes": 15,
    "min_samples_leaf": 100,
    "l2_regularization": 10.0,
    "early_stopping": False,
    "random_state": 529,
}
HGB_CLASS = {
    "loss": "log_loss",
    "learning_rate": 0.05,
    "max_iter": 200,
    "max_leaf_nodes": 15,
    "min_samples_leaf": 100,
    "l2_regularization": 10.0,
    "early_stopping": False,
    "random_state": 529,
}


def parse_args():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="mode", required=True)

    fold = sub.add_parser("fit-fold")
    fold.add_argument("--fold", type=int, required=True)
    fold.add_argument("--compact-db", type=Path, required=True)
    fold.add_argument("--compact-schema", type=Path, required=True)
    fold.add_argument("--behavior-predictions", type=Path, required=True)
    fold.add_argument("--held-features", type=Path, required=True)
    fold.add_argument("--out", type=Path, required=True)

    aggregate = sub.add_parser("aggregate")
    aggregate.add_argument("--train-shard", action="append", type=Path, required=True)
    aggregate.add_argument("--train-report", action="append", type=Path, required=True)
    aggregate.add_argument("--validation-shard", type=Path, required=True)
    aggregate.add_argument("--validation-report", type=Path, required=True)
    aggregate.add_argument("--ablation-report", type=Path, required=True)
    aggregate.add_argument("--out", type=Path, required=True)
    return parser.parse_args()


def _read_jsonl_gz(path: Path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)


def _skill_group(rate: float) -> str:
    if rate < 0.50:
        return "<0.50"
    if rate < 0.55:
        return "0.50-0.55"
    if rate < 0.60:
        return "0.55-0.60"
    return ">=0.60"


def _experience_group(value: int) -> str:
    if value < 100:
        return "<100"
    if value < 500:
        return "100-499"
    return ">=500"


def _weighted_error(y: np.ndarray, pred: np.ndarray, weight: np.ndarray) -> dict:
    total = float(weight.sum())
    if total <= 0:
        raise ValueError("positive diagnostic weight required")
    error = pred - y
    return {
        "n": int(len(y)),
        "mae": float(np.sum(weight * np.abs(error)) / total),
        "rmse": float(math.sqrt(np.sum(weight * error * error) / total)),
        "mean_bias": float(np.sum(weight * error) / total),
        "observed_mean": float(np.sum(weight * y) / total),
        "predicted_mean": float(np.sum(weight * pred) / total),
    }


def _q_diagnostics(meta: Mapping[str, np.ndarray], selected_q: np.ndarray) -> dict:
    y = meta["outcome"].astype(np.float64)
    weight = meta["decision_weight"].astype(np.float64)
    result = {"overall": _weighted_error(y, selected_q, weight)}
    axes = {
        "set": [str(x) for x in meta["expansion"]],
        "pick": [
            f"P{int(pack)+1}P{int(pick)+1}"
            for pack, pick in zip(meta["pack_number"], meta["pick_number"])
        ],
        "skill": [_skill_group(float(x)) for x in meta["skill_rate"]],
        "experience": [_experience_group(int(x)) for x in meta["user_games_lower_bound"]],
    }
    for axis, labels in axes.items():
        grouped = defaultdict(list)
        for index, label in enumerate(labels):
            grouped[label].append(index)
        result[f"by_{axis}"] = {}
        for label, indices in sorted(grouped.items()):
            idx = np.asarray(indices, dtype=np.int64)
            result[f"by_{axis}"][label] = _weighted_error(
                y[idx], selected_q[idx], weight[idx]
            )

    order = np.argsort(selected_q, kind="mergesort")
    deciles = []
    for bucket in range(10):
        lo = bucket * len(order) // 10
        hi = (bucket + 1) * len(order) // 10
        idx = order[lo:hi]
        if len(idx):
            deciles.append({
                "decile": bucket + 1,
                **_weighted_error(y[idx], selected_q[idx], weight[idx]),
            })
    result["calibration_deciles"] = deciles
    return result


def _fit_weighted_ridge(
    x: np.ndarray,
    y: np.ndarray,
    weight: np.ndarray,
    *,
    l2: float,
) -> tuple[float, np.ndarray]:
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    weight = np.asarray(weight, dtype=np.float64)
    if len(x) != len(y) or len(y) != len(weight) or not len(y):
        raise ValueError("weighted ridge inputs must align and be non-empty")
    design = np.empty((len(x), x.shape[1] + 1), dtype=np.float64)
    design[:, 0] = 1.0
    design[:, 1:] = x
    xtw = design.T * weight
    gram = xtw @ design
    rhs = xtw @ y
    gram[1:, 1:] += np.eye(x.shape[1], dtype=np.float64) * l2
    beta = np.linalg.solve(gram, rhs)
    return float(beta[0]), beta[1:]


def _predict_ridge(intercept: float, coef: np.ndarray, x: np.ndarray) -> np.ndarray:
    return intercept + np.asarray(x, dtype=np.float64) @ np.asarray(coef, dtype=np.float64)


def _schema(path: Path) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("schema_version") != 1:
        raise SystemExit("unsupported compact schema")
    if raw.get("assessment_opened") is not False:
        raise SystemExit("compact schema assessment boundary violation")
    if raw.get("assessment_outcomes_used") is not False:
        raise SystemExit("compact schema assessment outcome violation")
    return raw


def _state_control_indices(names: Sequence[str]) -> list[int]:
    return [
        index
        for index, name in enumerate(names)
        if name in {"base:user_game_win_rate", "base:log1p_user_games"}
        or name.startswith("base:rank=")
    ]


def _state_nonlinear_indices(names: Sequence[str]) -> list[int]:
    controls = set(_state_control_indices(names))
    return [index for index in range(len(names)) if index not in controls]


def _simple_indices(names: Sequence[str]) -> list[int]:
    return [index for index, name in enumerate(names) if name.startswith("base:")]


def _load_decisions(conn: sqlite3.Connection, role: str, state_count: int) -> dict:
    state_cols = ",".join(f"s{i}" for i in range(state_count))
    query = (
        "SELECT decision_idx,decision_id,draft_id,fold,role,training_draft_count,"
        "expansion,selected_action,outcome,sample_weight"
        + ("," + state_cols if state_cols else "")
        + " FROM decisions WHERE role=? ORDER BY decision_idx"
    )
    rows = conn.execute(query, (role,)).fetchall()
    if not rows:
        raise SystemExit(f"compact DB has no {role} decisions")
    n = len(rows)
    state = np.empty((n, state_count), dtype=np.float64)
    decision_idx = np.empty(n, dtype=np.int64)
    decision_ids = []
    draft_ids = []
    expansions = []
    selected = []
    outcomes = np.empty(n, dtype=np.float64)
    sample_weight = np.empty(n, dtype=np.float64)
    sample_weight[:] = np.nan
    training_count = np.empty(n, dtype=np.int64)
    for local, row in enumerate(rows):
        decision_idx[local] = int(row[0])
        decision_ids.append(str(row[1]))
        draft_ids.append(str(row[2]))
        training_count[local] = int(row[5])
        expansions.append(str(row[6]))
        selected.append(str(row[7]))
        outcomes[local] = float(row[8])
        if row[9] is not None:
            sample_weight[local] = float(row[9])
        state[local, :] = [
            0.0 if value is None else float(value)
            for value in row[10:]
        ]
    return {
        "decision_idx": decision_idx,
        "decision_ids": decision_ids,
        "draft_ids": draft_ids,
        "training_count": training_count,
        "expansion": expansions,
        "selected_action": selected,
        "outcome": outcomes,
        "sample_weight": sample_weight,
        "state": state,
    }


def _load_selected_candidates(
    conn: sqlite3.Connection,
    role: str,
    candidate_count: int,
    decision_idx: np.ndarray,
) -> np.ndarray:
    cols = ",".join(f"c{i}" for i in range(candidate_count))
    query = (
        "SELECT d.decision_idx"
        + ("," + ",".join(f"c.c{i}" for i in range(candidate_count)) if candidate_count else "")
        + " FROM decisions d JOIN candidates c ON c.decision_idx=d.decision_idx "
        "AND c.candidate=d.selected_action WHERE d.role=? ORDER BY d.decision_idx"
    )
    rows = conn.execute(query, (role,)).fetchall()
    if len(rows) != len(decision_idx):
        raise SystemExit("selected candidate query does not cover decisions")
    result = np.empty((len(rows), candidate_count), dtype=np.float64)
    for local, row in enumerate(rows):
        if int(row[0]) != int(decision_idx[local]):
            raise SystemExit("selected candidate decision order mismatch")
        result[local, :] = [
            0.0 if value is None else float(value)
            for value in row[1:]
        ]
    return result


def _load_all_candidates(
    conn: sqlite3.Connection,
    role: str,
    candidate_count: int,
    decision_idx: np.ndarray,
):
    query = (
        "SELECT c.decision_idx,c.candidate_ord,c.candidate"
        + ("," + ",".join(f"c.c{i}" for i in range(candidate_count)) if candidate_count else "")
        + " FROM candidates c JOIN decisions d ON d.decision_idx=c.decision_idx "
        "WHERE d.role=? ORDER BY c.decision_idx,c.candidate_ord"
    )
    rows = conn.execute(query, (role,)).fetchall()
    local_of = {int(value): index for index, value in enumerate(decision_idx)}
    counts = np.zeros(len(decision_idx), dtype=np.int64)
    cand = np.empty((len(rows), candidate_count), dtype=np.float64)
    names = []
    local_decision = np.empty(len(rows), dtype=np.int64)
    for row_index, row in enumerate(rows):
        source_idx = int(row[0])
        if source_idx not in local_of:
            raise SystemExit("candidate row references unknown decision")
        local = local_of[source_idx]
        local_decision[row_index] = local
        counts[local] += 1
        names.append(str(row[2]))
        cand[row_index, :] = [
            0.0 if value is None else float(value)
            for value in row[3:]
        ]
    offsets = np.zeros(len(decision_idx) + 1, dtype=np.int64)
    offsets[1:] = np.cumsum(counts)
    if int(offsets[-1]) != len(rows):
        raise SystemExit("candidate offsets do not cover candidate rows")
    if not np.all(local_decision == np.repeat(np.arange(len(counts)), counts)):
        raise SystemExit("candidate row order is not grouped by decision")
    return cand, np.asarray(names), offsets


def _read_behavior_predictions(path: Path) -> dict:
    result = {}
    for raw in _read_jsonl_gz(path):
        decision_id = str(raw["decision_id"])
        if decision_id in result:
            raise SystemExit("duplicate behavior prediction")
        result[decision_id] = {
            "fold": int(raw["fold"]),
            "training_draft_count": int(raw["training_draft_count"]),
            "behavior": {str(k): float(v) for k, v in raw["behavior"].items()},
            "q_values": {str(k): float(v) for k, v in raw["q_values"].items()},
        }
    return result


def _read_held_metadata(path: Path) -> dict:
    result = {}
    for row in _read_jsonl_gz(path):
        features = row["features"]
        values = {
            action: float(candidate.get("strong_choice_probability", 0.0))
            for action, candidate in features.items()
        }
        incumbent = min(values, key=lambda action: (-values[action], action))
        decision_id = str(row["decision_id"])
        result[decision_id] = {
            "incumbent": incumbent,
            "expansion": str(row["expansion"]),
            "pack_number": int(row["pack_number"]),
            "pick_number": int(row["pick_number"]),
            "skill_rate": float(row["user_game_win_rate"]),
            "user_games_lower_bound": int(row["user_games_lower_bound"]),
            "outcome": float(row["outcome"]),
            "selected_action": str(row["selected_action"]),
        }
    return result


def _decision_weights(draft_ids: Sequence[str]) -> np.ndarray:
    counts = Counter(str(value) for value in draft_ids)
    return np.asarray([1.0 / counts[str(value)] for value in draft_ids], dtype=np.float64)


def _align_held(
    *,
    fold: int,
    decisions: dict,
    candidate_names: np.ndarray,
    offsets: np.ndarray,
    behavior_rows: Mapping[str, Mapping[str, object]],
    held_meta: Mapping[str, Mapping[str, object]],
):
    n_decisions = len(decisions["decision_ids"])
    n_candidates = len(candidate_names)
    behavior = np.empty(n_candidates, dtype=np.float64)
    q_simple = np.empty(n_candidates, dtype=np.float64)
    selected_ord = np.empty(n_decisions, dtype=np.int16)
    incumbent_ord = np.empty(n_decisions, dtype=np.int16)
    pack_number = np.empty(n_decisions, dtype=np.int16)
    pick_number = np.empty(n_decisions, dtype=np.int16)
    skill_rate = np.empty(n_decisions, dtype=np.float64)
    games = np.empty(n_decisions, dtype=np.int32)

    for index, decision_id in enumerate(decisions["decision_ids"]):
        prediction = behavior_rows.get(decision_id)
        meta = held_meta.get(decision_id)
        if prediction is None or meta is None:
            raise SystemExit(f"held nuisance/meta missing {decision_id}")
        if int(prediction["fold"]) != fold:
            raise SystemExit("held behavior fold mismatch")
        if int(prediction["training_draft_count"]) != int(decisions["training_count"][index]):
            raise SystemExit("held behavior training provenance mismatch")
        if meta["selected_action"] != decisions["selected_action"][index]:
            raise SystemExit("held selected action mismatch")
        if meta["expansion"] != decisions["expansion"][index]:
            raise SystemExit("held expansion mismatch")
        if float(meta["outcome"]) != float(decisions["outcome"][index]):
            raise SystemExit("held outcome mismatch")

        start, stop = int(offsets[index]), int(offsets[index + 1])
        names = [str(x) for x in candidate_names[start:stop]]
        if set(names) != set(prediction["behavior"]) or set(names) != set(prediction["q_values"]):
            raise SystemExit("held nuisance candidate set mismatch")
        selected = decisions["selected_action"][index]
        incumbent = str(meta["incumbent"])
        selected_ord[index] = names.index(selected)
        incumbent_ord[index] = names.index(incumbent)
        for local, name in enumerate(names):
            behavior[start + local] = float(prediction["behavior"][name])
            q_simple[start + local] = float(prediction["q_values"][name])
        if abs(float(behavior[start:stop].sum()) - 1.0) > 1e-9:
            raise SystemExit("held behavior probabilities do not sum to one")

        pack_number[index] = int(meta["pack_number"])
        pick_number[index] = int(meta["pick_number"])
        skill_rate[index] = float(meta["skill_rate"])
        games[index] = int(meta["user_games_lower_bound"])

    if set(behavior_rows) != set(decisions["decision_ids"]):
        raise SystemExit("behavior predictions do not exactly cover held decisions")
    if set(held_meta) != set(decisions["decision_ids"]):
        raise SystemExit("held metadata does not exactly cover held decisions")
    return {
        "behavior": behavior,
        "q_simple": q_simple,
        "selected_ord": selected_ord,
        "incumbent_ord": incumbent_ord,
        "pack_number": pack_number,
        "pick_number": pick_number,
        "skill_rate": skill_rate,
        "user_games_lower_bound": games,
    }


def _pseudo_values(
    q: np.ndarray,
    behavior: np.ndarray,
    outcomes: np.ndarray,
    selected_ord: np.ndarray,
    offsets: np.ndarray,
) -> np.ndarray:
    phi = np.asarray(q, dtype=np.float64).copy()
    for index in range(len(outcomes)):
        start = int(offsets[index])
        selected = start + int(selected_ord[index])
        propensity = float(behavior[selected])
        if propensity <= 0:
            raise SystemExit("selected action has non-positive behavior probability")
        inverse = min(1.0 / propensity, PSEUDO_CAP)
        phi[selected] += inverse * (float(outcomes[index]) - float(q[selected]))
    return phi


def _selected_values(values: np.ndarray, selected_ord: np.ndarray, offsets: np.ndarray) -> np.ndarray:
    return np.asarray([
        float(values[int(offsets[index]) + int(selected_ord[index])])
        for index in range(len(selected_ord))
    ], dtype=np.float64)


def run_fit_fold(args):
    if sklearn.__version__ != SKLEARN_VERSION:
        raise SystemExit(f"expected scikit-learn {SKLEARN_VERSION}, found {sklearn.__version__}")
    if args.fold not in {-1, 0, 1, 2, 3, 4}:
        raise SystemExit("fold must be -1 or 0..4")

    started = time.perf_counter()
    schema = _schema(args.compact_schema)
    if int(schema["fold"]) != args.fold:
        raise SystemExit("compact schema fold mismatch")
    state_names = list(schema["state_feature_names"])
    candidate_feature_names = list(schema["candidate_feature_names"])
    control_idx = _state_control_indices(state_names)
    nonlinear_state_idx = _state_nonlinear_indices(state_names)
    simple_state_idx = _simple_indices(state_names)
    simple_candidate_idx = _simple_indices(candidate_feature_names)

    conn = sqlite3.connect(f"file:{args.compact_db}?mode=ro", uri=True)
    try:
        train = _load_decisions(conn, "train", len(state_names))
        if np.isnan(train["sample_weight"]).any():
            raise SystemExit("training rows are missing sample weights")
        train_selected = _load_selected_candidates(
            conn,
            "train",
            len(candidate_feature_names),
            train["decision_idx"],
        )

        control_intercept, control_coef = _fit_weighted_ridge(
            train["state"][:, control_idx],
            train["outcome"],
            train["sample_weight"],
            l2=RIDGE_L2,
        )
        control_pred = _predict_ridge(
            control_intercept,
            control_coef,
            train["state"][:, control_idx],
        )
        residual = train["outcome"] - control_pred
        q_train_x = np.concatenate(
            [
                train["state"][:, nonlinear_state_idx].astype(np.float32),
                train_selected.astype(np.float32),
            ],
            axis=1,
        )
        q_model = HistGradientBoostingRegressor(**HGB_REG)
        q_model.fit(
            q_train_x,
            residual,
            sample_weight=train["sample_weight"],
        )

        held = _load_decisions(conn, "held", len(state_names))
        held_cand, candidate_names, offsets = _load_all_candidates(
            conn,
            "held",
            len(candidate_feature_names),
            held["decision_idx"],
        )
    finally:
        conn.close()

    counts = np.diff(offsets)
    repeated_state = np.repeat(
        held["state"][:, nonlinear_state_idx].astype(np.float32),
        counts,
        axis=0,
    )
    q_held_x = np.concatenate(
        [repeated_state, held_cand.astype(np.float32)],
        axis=1,
    )
    q_control = _predict_ridge(
        control_intercept,
        control_coef,
        held["state"][:, control_idx],
    )
    q_rich = (
        np.repeat(q_control, counts)
        + q_model.predict(q_held_x).astype(np.float64)
    )

    behavior_rows = _read_behavior_predictions(args.behavior_predictions)
    held_meta = _read_held_metadata(args.held_features)
    aligned = _align_held(
        fold=args.fold,
        decisions=held,
        candidate_names=candidate_names,
        offsets=offsets,
        behavior_rows=behavior_rows,
        held_meta=held_meta,
    )
    decision_weight = _decision_weights(held["draft_ids"])
    meta = {
        "outcome": held["outcome"],
        "decision_weight": decision_weight,
        "expansion": np.asarray(held["expansion"]),
        "pack_number": aligned["pack_number"],
        "pick_number": aligned["pick_number"],
        "skill_rate": aligned["skill_rate"],
        "user_games_lower_bound": aligned["user_games_lower_bound"],
    }
    selected_rich_q = _selected_values(
        q_rich, aligned["selected_ord"], offsets
    )
    selected_simple_q = _selected_values(
        aligned["q_simple"], aligned["selected_ord"], offsets
    )

    phi_rich = _pseudo_values(
        q_rich,
        aligned["behavior"],
        held["outcome"],
        aligned["selected_ord"],
        offsets,
    )
    phi_simple = _pseudo_values(
        aligned["q_simple"],
        aligned["behavior"],
        held["outcome"],
        aligned["selected_ord"],
        offsets,
    )

    state_rich = held["state"].astype(np.float32)
    cand_rich = held_cand.astype(np.float32)
    state_simple = held["state"][:, simple_state_idx].astype(np.float64)
    cand_simple = held_cand[:, simple_candidate_idx].astype(np.float64)

    args.out.mkdir(parents=True, exist_ok=True)
    shard_path = args.out / f"phase-a2-fold-{args.fold}.npz"
    save = {
        "fold": np.asarray([args.fold], dtype=np.int16),
        "state_rich": state_rich,
        "cand_rich": cand_rich,
        "state_simple": state_simple,
        "cand_simple": cand_simple,
        "offsets": offsets,
        "candidate_names": candidate_names,
        "decision_ids": np.asarray(held["decision_ids"]),
        "draft_ids": np.asarray(held["draft_ids"]),
        "expansion": np.asarray(held["expansion"]),
        "pack_number": aligned["pack_number"],
        "pick_number": aligned["pick_number"],
        "skill_rate": aligned["skill_rate"],
        "user_games_lower_bound": aligned["user_games_lower_bound"],
        "selected_ord": aligned["selected_ord"],
        "incumbent_ord": aligned["incumbent_ord"],
        "outcome": held["outcome"].astype(np.float64),
        "decision_weight": decision_weight,
    }
    if args.fold == -1:
        save.update({
            "behavior": aligned["behavior"],
            "q_rich": q_rich,
            "q_simple": aligned["q_simple"],
        })
    else:
        save.update({
            "phi_rich": phi_rich,
            "phi_simple": phi_simple,
        })
    np.savez_compressed(shard_path, **save)

    report = {
        "scope": "development_only",
        "phase": "A2_shared_rich_q_fold",
        "fold": args.fold,
        "sklearn_version": sklearn.__version__,
        "training_decisions": len(train["decision_ids"]),
        "held_decisions": len(held["decision_ids"]),
        "held_candidate_rows": int(offsets[-1]),
        "state_feature_count": len(state_names),
        "candidate_feature_count": len(candidate_feature_names),
        "skill_control_feature_names": [state_names[i] for i in control_idx],
        "nonlinear_state_feature_names": [state_names[i] for i in nonlinear_state_idx],
        "nonlinear_state_indices": list(nonlinear_state_idx),
        "simple_state_feature_names": [state_names[i] for i in simple_state_idx],
        "simple_state_indices": list(simple_state_idx),
        "simple_candidate_indices": list(simple_candidate_idx),
        "simple_candidate_feature_names": [candidate_feature_names[i] for i in simple_candidate_idx],
        "q_control": {
            "family": "weighted_ridge_additive_control",
            "l2": RIDGE_L2,
            "intercept": control_intercept,
            "coefficients": {
                state_names[i]: float(value)
                for i, value in zip(control_idx, control_coef)
            },
        },
        "q_nonlinear": {
            "family": "HistGradientBoostingRegressor_on_control_residual",
            "configuration": HGB_REG,
        },
        "q_diagnostics_rich": _q_diagnostics(meta, selected_rich_q),
        "q_diagnostics_simple_retained": _q_diagnostics(meta, selected_simple_q),
        "assessment_opened": False,
        "assessment_outcomes_used": False,
        "elapsed_seconds": time.perf_counter() - started,
    }
    report_path = args.out / f"phase-a2-fold-{args.fold}-report.json"
    report_path.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({
        "fold": args.fold,
        "training_decisions": report["training_decisions"],
        "held_decisions": report["held_decisions"],
        "rich_q": report["q_diagnostics_rich"]["overall"],
        "simple_q": report["q_diagnostics_simple_retained"]["overall"],
        "elapsed_seconds": report["elapsed_seconds"],
    }, sort_keys=True))


def _load_train_shards(paths: Sequence[Path], reports: Sequence[Path]):
    report_by_fold = {}
    for path in reports:
        raw = json.loads(path.read_text(encoding="utf-8"))
        fold = int(raw["fold"])
        if fold in report_by_fold:
            raise SystemExit("duplicate training fold report")
        if raw.get("assessment_opened") is not False:
            raise SystemExit("training fold report assessment violation")
        report_by_fold[fold] = raw
    if set(report_by_fold) != {0, 1, 2, 3, 4}:
        raise SystemExit("training fold reports must be exactly 0..4")

    loaded = []
    for path in paths:
        data = np.load(path, allow_pickle=False)
        if "fold" not in data.files or len(data["fold"]) != 1:
            raise SystemExit("training shard missing scalar fold id")
        fold = int(data["fold"][0])
        if fold not in report_by_fold:
            raise SystemExit(f"unexpected training shard fold {fold}")
        loaded.append((fold, data))
    if {fold for fold, _ in loaded} != {0, 1, 2, 3, 4}:
        raise SystemExit("training shards must be exactly folds 0..4")
    loaded.sort(key=lambda item: item[0])

    state_rich = np.concatenate([d["state_rich"] for _, d in loaded], axis=0)
    cand_rich = np.concatenate([d["cand_rich"] for _, d in loaded], axis=0)
    state_simple = np.concatenate([d["state_simple"] for _, d in loaded], axis=0)
    cand_simple = np.concatenate([d["cand_simple"] for _, d in loaded], axis=0)
    candidate_names = np.concatenate([d["candidate_names"] for _, d in loaded], axis=0)
    decision_weight = np.concatenate([d["decision_weight"] for _, d in loaded])
    phi_rich = np.concatenate([d["phi_rich"] for _, d in loaded])
    phi_simple = np.concatenate([d["phi_simple"] for _, d in loaded])

    counts_parts = [np.diff(d["offsets"]).astype(np.int64) for _, d in loaded]
    counts = np.concatenate(counts_parts)
    offsets = np.zeros(len(counts) + 1, dtype=np.int64)
    offsets[1:] = np.cumsum(counts)
    if int(offsets[-1]) != len(candidate_names):
        raise SystemExit("concatenated training offsets do not align with candidates")
    return {
        "state_rich": state_rich,
        "cand_rich": cand_rich,
        "state_simple": state_simple,
        "cand_simple": cand_simple,
        "candidate_names": candidate_names,
        "decision_weight": decision_weight,
        "phi_rich": phi_rich,
        "phi_simple": phi_simple,
        "offsets": offsets,
        "reports": report_by_fold,
    }


def _argmax_local(values: np.ndarray, names: np.ndarray) -> int:
    return min(
        range(len(values)),
        key=lambda index: (-float(values[index]), str(names[index])),
    )


def _estimate_by_cap(observations: Sequence[PolicyObservation]) -> dict:
    return {
        str(int(cap)): asdict(evaluate_policy(observations, cap))
        for cap in WEIGHT_CAPS
    }


def _delta_cap20(candidate, incumbent) -> dict:
    left = evaluate_policy(candidate, 20.0)
    right = evaluate_policy(incumbent, 20.0)
    return {
        "dr": left.dr - right.dr,
        "direct": left.direct - right.direct,
        "snips": left.snips - right.snips,
        "ipw": left.ipw - right.ipw,
    }


def _minimal_decisions(validation, primary_indices, candidate_names, offsets):
    result = []
    for index in primary_indices:
        start, stop = int(offsets[index]), int(offsets[index + 1])
        names = tuple(str(x) for x in candidate_names[start:stop])
        selected = names[int(validation["selected_ord"][index])]
        outcome = int(round(float(validation["outcome"][index])))
        result.append(Decision(
            draft_id=str(validation["draft_ids"][index]),
            expansion=str(validation["expansion"][index]),
            event_type="PremierDraft",
            draft_time="",
            rank="unknown",
            pack_number=int(validation["pack_number"][index]),
            pick_number=int(validation["pick_number"][index]),
            selected_card=selected,
            candidates=names,
            pool=(),
            user_game_win_rate=float(validation["skill_rate"][index]),
            user_games_lower_bound=int(validation["user_games_lower_bound"][index]),
            event_match_wins=outcome,
            event_match_losses=None,
        ))
    return result


def _primary_indices(validation) -> list[int]:
    by_draft = defaultdict(list)
    for index, draft_id in enumerate(validation["draft_ids"]):
        if (
            int(validation["pack_number"][index]) == PRIMARY_PACK
            and PRIMARY_PICK_START <= int(validation["pick_number"][index]) < PRIMARY_PICK_STOP
        ):
            by_draft[str(draft_id)].append(index)
    result = []
    for draft_id in sorted(by_draft):
        result.append(min(
            by_draft[draft_id],
            key=lambda index: stable_score(
                f"contextual-value-v1-primary:{str(validation['decision_ids'][index])}"
            ),
        ))
    if not result:
        raise SystemExit("validation has no primary OPE decisions")
    return result


def _policy_observations(
    validation,
    primary_indices,
    chosen_ord: np.ndarray,
    candidate_names: np.ndarray,
    offsets: np.ndarray,
    *,
    q_key: str,
):
    observations = []
    for pos, decision_index in enumerate(primary_indices):
        start, stop = int(offsets[decision_index]), int(offsets[decision_index + 1])
        names = [str(x) for x in candidate_names[start:stop]]
        behavior = {
            name: float(validation["behavior"][start + local])
            for local, name in enumerate(names)
        }
        q_values = {
            name: float(validation[q_key][start + local])
            for local, name in enumerate(names)
        }
        selected = names[int(validation["selected_ord"][decision_index])]
        chosen = names[int(chosen_ord[pos])]
        target = {name: 1.0 if name == chosen else 0.0 for name in names}
        observations.append(PolicyObservation(
            action=selected,
            outcome=float(validation["outcome"][decision_index]),
            behavior=behavior,
            target=target,
            q_values=q_values,
            cluster=str(validation["draft_ids"][decision_index]),
        ))
    return observations


def _pairwise_training(train, nonlinear_state_names: Sequence[str]):
    counts = np.diff(train["offsets"]).astype(np.int64)
    pair_count = sum(2 * min(H2_MAX_OPPONENTS, max(0, int(count) - 1)) for count in counts)
    x = np.empty(
        (pair_count, len(nonlinear_state_names) + train["cand_rich"].shape[1]),
        dtype=np.float32,
    )
    y = np.empty(pair_count, dtype=np.uint8)
    w = np.empty(pair_count, dtype=np.float64)
    cursor = 0
    for decision_index, count_raw in enumerate(counts):
        count = int(count_raw)
        if count < 2:
            continue
        start = int(train["offsets"][decision_index])
        stop = int(train["offsets"][decision_index + 1])
        values = train["phi_rich"][start:stop]
        names = train["candidate_names"][start:stop]
        order = sorted(
            range(count),
            key=lambda local: (-float(values[local]), str(names[local])),
        )
        leader = order[0]
        opponents = order[1:1 + H2_MAX_OPPONENTS]
        pair_weight = float(train["decision_weight"][decision_index]) / (2.0 * len(opponents))
        state = train["state_nonlinear"][decision_index]
        for opponent in opponents:
            diff = train["cand_rich"][start + leader] - train["cand_rich"][start + opponent]
            x[cursor, :len(nonlinear_state_names)] = state
            x[cursor, len(nonlinear_state_names):] = diff
            y[cursor] = 1
            w[cursor] = pair_weight
            cursor += 1

            x[cursor, :len(nonlinear_state_names)] = state
            x[cursor, len(nonlinear_state_names):] = -diff
            y[cursor] = 0
            w[cursor] = pair_weight
            cursor += 1
    if cursor != pair_count:
        raise SystemExit("pairwise training allocation mismatch")
    return x, y, w


def _h2_scores_for_primary(
    model,
    validation,
    primary_indices,
    nonlinear_state_idx,
):
    total_pairs = 0
    for index in primary_indices:
        count = int(validation["offsets"][index + 1] - validation["offsets"][index])
        total_pairs += count * max(0, count - 1)

    width = len(nonlinear_state_idx) + validation["cand_rich"].shape[1]
    x = np.empty((total_pairs, width), dtype=np.float32)
    left_global = np.empty(total_pairs, dtype=np.int64)
    cursor = 0
    for index in primary_indices:
        start, stop = int(validation["offsets"][index]), int(validation["offsets"][index + 1])
        state = validation["state_rich"][index, nonlinear_state_idx]
        for left in range(start, stop):
            for right in range(start, stop):
                if left == right:
                    continue
                x[cursor, :len(nonlinear_state_idx)] = state
                x[cursor, len(nonlinear_state_idx):] = (
                    validation["cand_rich"][left] - validation["cand_rich"][right]
                )
                left_global[cursor] = left
                cursor += 1
    if cursor != total_pairs:
        raise SystemExit("H2 primary pair allocation mismatch")
    probability = model.predict_proba(x)[:, 1]
    score_sum = np.zeros(len(validation["candidate_names"]), dtype=np.float64)
    score_count = np.zeros(len(validation["candidate_names"]), dtype=np.int32)
    np.add.at(score_sum, left_global, probability)
    np.add.at(score_count, left_global, 1)
    scores = np.zeros_like(score_sum)
    mask = score_count > 0
    scores[mask] = score_sum[mask] / score_count[mask]
    return scores


def run_aggregate(args):
    if sklearn.__version__ != SKLEARN_VERSION:
        raise SystemExit(f"expected scikit-learn {SKLEARN_VERSION}, found {sklearn.__version__}")
    started = time.perf_counter()

    train = _load_train_shards(args.train_shard, args.train_report)
    validation_data = np.load(args.validation_shard, allow_pickle=False)
    validation = {key: validation_data[key] for key in validation_data.files}
    validation_report = json.loads(args.validation_report.read_text(encoding="utf-8"))
    if int(validation_report["fold"]) != -1:
        raise SystemExit("validation report is not fold -1")
    if validation_report.get("assessment_opened") is not False:
        raise SystemExit("validation report assessment violation")

    state_names = list(validation_report["nonlinear_state_feature_names"])
    full_state_count = validation["state_rich"].shape[1]
    validation_schema_nonlin = set(state_names)
    # Reports list nonlinear names in source order. Recover their indices from
    # the complete state name list encoded by the fold report.
    all_state_names = (
        list(validation_report["skill_control_feature_names"])
        + [name for name in state_names]
    )
    # Use training report to reconstruct exact complete-order names.
    sample_train_report = train["reports"][0]
    control_names = set(sample_train_report["skill_control_feature_names"])
    nonlinear_names_ordered = list(sample_train_report["nonlinear_state_feature_names"])
    if nonlinear_names_ordered != list(validation_report["nonlinear_state_feature_names"]):
        raise SystemExit("nonlinear state schema differs between train and validation folds")
    # state_rich persisted in original Phase A1 order. Derive that order from
    # simple+nonlinear report names by using the source schema embedded in the
    # compact fold report was not carried forward; fit-fold therefore stores
    # explicit nonlinear positions below in its report.
    nonlinear_state_idx = list(validation_report["nonlinear_state_indices"])
    if any(index < 0 or index >= full_state_count for index in nonlinear_state_idx):
        raise SystemExit("invalid nonlinear state index in validation report")

    train_nonlin_idx = list(sample_train_report["nonlinear_state_indices"])
    if train_nonlin_idx != nonlinear_state_idx:
        raise SystemExit("nonlinear state indices differ across folds")
    train["state_nonlinear"] = train["state_rich"][:, train_nonlin_idx]

    counts = np.diff(train["offsets"]).astype(np.int64)
    row_weight = np.repeat(train["decision_weight"] / counts, counts)

    # H: exact simple deterministic benchmark.
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
    del x_h

    # H1: rich nonlinear DR value learner.
    x_h1 = np.concatenate(
        [
            np.repeat(train["state_nonlinear"], counts, axis=0),
            train["cand_rich"],
        ],
        axis=1,
    ).astype(np.float32)
    h1_model = HistGradientBoostingRegressor(**HGB_REG)
    h1_model.fit(x_h1, train["phi_rich"], sample_weight=row_weight)
    del x_h1

    # H2: direct pairwise policy learner.
    pair_x, pair_y, pair_w = _pairwise_training(
        train,
        nonlinear_names_ordered,
    )
    h2_model = HistGradientBoostingClassifier(**HGB_CLASS)
    h2_model.fit(pair_x, pair_y, sample_weight=pair_w)
    pair_training_rows = len(pair_y)
    del pair_x, pair_y, pair_w

    primary = _primary_indices(validation)
    if len(primary) != 1218:
        raise SystemExit(f"expected 1218 validation primary drafts, found {len(primary)}")

    # H/H1 scalar scores on primary candidates.
    h_chosen = np.empty(len(primary), dtype=np.int16)
    h1_chosen = np.empty(len(primary), dtype=np.int16)
    h_action_order_by_draft: dict[str, tuple[str, ...]] = {}
    h1_action_order_by_draft: dict[str, tuple[str, ...]] = {}
    for pos, index in enumerate(primary):
        start, stop = int(validation["offsets"][index]), int(validation["offsets"][index + 1])
        names = validation["candidate_names"][start:stop]
        simple_x = np.concatenate(
            [
                np.repeat(validation["state_simple"][index:index+1], stop-start, axis=0),
                validation["cand_simple"][start:stop],
            ],
            axis=1,
        )
        h_scores = _predict_ridge(h_intercept, h_coef, simple_x)
        h_chosen[pos] = _argmax_local(h_scores, names)
        cluster = str(validation["draft_ids"][index])
        h_order = sorted(
            range(len(h_scores)),
            key=lambda local: (-float(h_scores[local]), str(names[local])),
        )
        h_action_order_by_draft[cluster] = tuple(
            str(names[local]) for local in h_order
        )

        rich_x = np.concatenate(
            [
                np.repeat(
                    validation["state_rich"][index:index+1, nonlinear_state_idx],
                    stop-start,
                    axis=0,
                ),
                validation["cand_rich"][start:stop],
            ],
            axis=1,
        ).astype(np.float32)
        h1_scores = h1_model.predict(rich_x)
        h1_chosen[pos] = _argmax_local(h1_scores, names)
        h1_order = sorted(
            range(len(h1_scores)),
            key=lambda local: (-float(h1_scores[local]), str(names[local])),
        )
        h1_action_order_by_draft[cluster] = tuple(
            str(names[local]) for local in h1_order
        )

    h2_all_scores = _h2_scores_for_primary(
        h2_model,
        validation,
        primary,
        nonlinear_state_idx,
    )
    h2_chosen = np.empty(len(primary), dtype=np.int16)
    h3_chosen = np.empty(len(primary), dtype=np.int16)
    incumbent_chosen = np.empty(len(primary), dtype=np.int16)
    h2_action_order_by_draft: dict[str, tuple[str, ...]] = {}
    h3_action_order_by_draft: dict[str, tuple[str, ...]] = {}
    fallback = Counter()
    h2_margins = []
    for pos, index in enumerate(primary):
        start, stop = int(validation["offsets"][index]), int(validation["offsets"][index + 1])
        names = validation["candidate_names"][start:stop]
        scores = h2_all_scores[start:stop]
        order = sorted(
            range(len(scores)),
            key=lambda local: (-float(scores[local]), str(names[local])),
        )
        leader = order[0]
        runner = order[1] if len(order) > 1 else order[0]
        h2_chosen[pos] = leader
        incumbent = int(validation["incumbent_ord"][index])
        incumbent_chosen[pos] = incumbent
        cluster = str(validation["draft_ids"][index])
        h2_action_order_by_draft[cluster] = tuple(
            str(names[local]) for local in order
        )
        margin = float(scores[leader] - scores[runner]) if len(order) > 1 else 1.0
        h2_margins.append(margin)
        threshold = support_threshold(stop - start)
        leader_supported = float(validation["behavior"][start + leader]) >= threshold
        runner_supported = float(validation["behavior"][start + runner]) >= threshold
        reasons = []
        if not leader_supported:
            reasons.append("leader_support")
        if not runner_supported:
            reasons.append("runner_support")
        if margin < H3_MARGIN:
            reasons.append("margin")
        if reasons:
            h3_chosen[pos] = incumbent
            fallback["any"] += 1
            for reason in reasons:
                fallback[reason] += 1
            h3_order = [incumbent] + [
                local for local in order if local != incumbent
            ]
        else:
            h3_chosen[pos] = leader
            h3_order = list(order)
        h3_action_order_by_draft[cluster] = tuple(
            str(names[local]) for local in h3_order
        )

    # OPE under shared rich nuisance.
    rich_a = _policy_observations(
        validation, primary, incumbent_chosen,
        validation["candidate_names"], validation["offsets"], q_key="q_rich",
    )
    rich_h = _policy_observations(
        validation, primary, h_chosen,
        validation["candidate_names"], validation["offsets"], q_key="q_rich",
    )
    rich_h1 = _policy_observations(
        validation, primary, h1_chosen,
        validation["candidate_names"], validation["offsets"], q_key="q_rich",
    )
    rich_h2 = _policy_observations(
        validation, primary, h2_chosen,
        validation["candidate_names"], validation["offsets"], q_key="q_rich",
    )
    rich_h3 = _policy_observations(
        validation, primary, h3_chosen,
        validation["candidate_names"], validation["offsets"], q_key="q_rich",
    )

    # Historical H reproduction under retained simple Q.
    simple_a = _policy_observations(
        validation, primary, incumbent_chosen,
        validation["candidate_names"], validation["offsets"], q_key="q_simple",
    )
    simple_h = _policy_observations(
        validation, primary, h_chosen,
        validation["candidate_names"], validation["offsets"], q_key="q_simple",
    )

    ablation = json.loads(args.ablation_report.read_text(encoding="utf-8"))
    expected = ablation["ablations"]["strong_offset_only"]
    actual_h = _estimate_by_cap(simple_h)
    actual_a = _estimate_by_cap(simple_a)
    actual_delta = _delta_cap20(simple_h, simple_a)
    expected_delta = expected["G_argmax_minus_A_cap20"]
    parity_fields = ("dr", "direct", "snips", "ipw")
    parity_error = max(
        abs(float(actual_delta[name]) - float(expected_delta[name]))
        for name in parity_fields
    )
    absolute_error = max(
        abs(float(actual_h["20"][name]) - float(expected["G_argmax_secondary"]["20"][name]))
        for name in parity_fields
    )
    if parity_error > 1e-6 or absolute_error > 1e-6:
        raise SystemExit(
            f"H benchmark reproduction failed: delta_error={parity_error} "
            f"absolute_error={absolute_error}"
        )

    policies = {
        "H_simple_deterministic": rich_h,
        "H1_rich_nonlinear_value": rich_h1,
        "H2_direct_pairwise_policy": rich_h2,
        "H3_conservative_pairwise": rich_h3,
    }
    primary_decisions = _minimal_decisions(
        validation,
        primary,
        validation["candidate_names"],
        validation["offsets"],
    )
    action_orders = {
        "H_simple_deterministic": h_action_order_by_draft,
        "H1_rich_nonlinear_value": h1_action_order_by_draft,
        "H2_direct_pairwise_policy": h2_action_order_by_draft,
        "H3_conservative_pairwise": h3_action_order_by_draft,
    }
    results = {}
    for name, observations in policies.items():
        results[name] = {
            "estimates": _estimate_by_cap(observations),
            "minus_A_cap20": {
                **_delta_cap20(observations, rich_a),
                "dr_ci95": paired_dr_delta_ci(
                    observations, rich_a, weight_cap=20.0
                ),
            },
            "minus_H_cap20": (
                None
                if name == "H_simple_deterministic"
                else {
                    **_delta_cap20(observations, rich_h),
                    "dr_ci95": paired_dr_delta_ci(
                        observations, rich_h, weight_cap=20.0
                    ),
                }
            ),
            "overlap": policy_overlap_diagnostics(
                observations,
                action_order_by_cluster=action_orders[name],
            ),
            "local_overlap": policy_overlap_slices(
                primary_decisions,
                observations,
                action_order_by_cluster=action_orders[name],
            ),
            "stability_vs_A": paired_policy_delta_slices(
                primary_decisions,
                observations,
                rich_a,
                weight_cap=20.0,
            ),
        }

    chosen = {
        "A": incumbent_chosen,
        "H": h_chosen,
        "H1": h1_chosen,
        "H2": h2_chosen,
        "H3": h3_chosen,
    }
    agreement = {}
    labels = list(chosen)
    for i, left in enumerate(labels):
        for right in labels[i + 1:]:
            agreement[f"{left}_vs_{right}"] = float(
                np.mean(chosen[left] == chosen[right])
            )

    report = {
        "scope": "development_only",
        "phase": "A2_bounded_model_bakeoff",
        "assessment_opened": False,
        "assessment_boundary": {
            "outcomes_loaded_into_pipeline": False,
            "outcomes_used_for_fit": False,
            "outcomes_scored": False,
        },
        "sklearn_version": sklearn.__version__,
        "frozen_spec": {
            "pseudo_outcome_cap": PSEUDO_CAP,
            "weight_caps": list(WEIGHT_CAPS),
            "ridge_l2": RIDGE_L2,
            "H1_HGB": HGB_REG,
            "H2_HGB_classifier": HGB_CLASS,
            "H2_max_opponents": H2_MAX_OPPONENTS,
            "H3_support_gate": "observed_propensity >= max(0.01, 0.10 / candidate_count) for leader and runner-up",
            "H3_margin": H3_MARGIN,
            "nonlinear_skill_rank_interactions": False,
        },
        "benchmark_reproduction": {
            "expected_strong_offset_only_argmax_minus_A_cap20": expected_delta,
            "actual_minus_A_cap20": actual_delta,
            "max_abs_delta_error": parity_error,
            "max_abs_H_cap20_estimate_error": absolute_error,
            "passed": True,
        },
        "rich_q_validation": validation_report["q_diagnostics_rich"],
        "simple_q_validation_retained": validation_report["q_diagnostics_simple_retained"],
        "A_incumbent_shared_rich_q": _estimate_by_cap(rich_a),
        "models": results,
        "H3_fallback": {
            "primary_decisions": len(primary),
            "fallback_count": int(fallback["any"]),
            "fallback_fraction": float(fallback["any"] / len(primary)),
            "reason_counts": {
                key: int(value)
                for key, value in sorted(fallback.items())
                if key != "any"
            },
        },
        "H2_margin": {
            "mean": float(np.mean(h2_margins)),
            "median": float(np.median(h2_margins)),
            "p05": float(np.quantile(h2_margins, 0.05)),
            "p95": float(np.quantile(h2_margins, 0.95)),
        },
        "policy_agreement": agreement,
        "pairwise_training_rows": pair_training_rows,
        "development_interpretation_boundary": (
            "Validation-visible bounded bake-off only. Do not open assessment from "
            "this result. Any selected challenger must first complete its required "
            "ablation/support/fallback/OOD checklist and then be frozen."
        ),
        "elapsed_seconds": time.perf_counter() - started,
    }
    args.out.mkdir(parents=True, exist_ok=True)
    out = args.out / "phase-a2-bakeoff-report.json"
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "benchmark_reproduction": report["benchmark_reproduction"],
        "models": {
            name: value["minus_A_cap20"]
            for name, value in results.items()
        },
        "H3_fallback": report["H3_fallback"],
        "rich_q_validation": report["rich_q_validation"]["overall"],
        "elapsed_seconds": report["elapsed_seconds"],
    }, indent=2, sort_keys=True))


def main():
    args = parse_args()
    if args.mode == "fit-fold":
        run_fit_fold(args)
    else:
        run_aggregate(args)


if __name__ == "__main__":
    main()
