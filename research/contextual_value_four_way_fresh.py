#!/usr/bin/env python3
"""Fresh-environment confirmation for frozen #529 H/J/N/Q score models.

Each environment uses a deterministic 60/15/25 split from an 8k-draft cap.
The four score models are loaded from the frozen core bundle before any fresh
outcomes are loaded. Fresh TRAIN is used only for leakage-safe signal
construction, fixed ridge margin calibration, and two fixed behavior nuisances
for OPE sensitivity. Fresh VALIDATION is scored once. Fresh ASSESSMENT is not
loaded.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import pickle
import random
import sys
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path

import numpy as np
from scipy.optimize import minimize

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "research"))

from build_replays import stable_score
from contextual_value import PRIMARY_PACK, PRIMARY_PICK_START, PRIMARY_PICK_STOP
from contextual_value.archive import ArchiveSignalProvider, GameStore, load_decisions, select_global_draft_ids
from contextual_value.dataset import draft_split
from contextual_value.diagnostics import paired_dr_delta_ci
from contextual_value.dr import PolicyObservation, evaluate_policy
from contextual_value.features import model_feature_map, strong_choice_offsets
from contextual_value.nuisance import build_fold_training_rows, nuisance_fold
from contextual_value.propensity import LinearSoftmaxPropensityModel, PropensityExample
from contextual_value.rich_features import rich_feature_bundle
from contextual_value_phase_a_features import _fetch_rich_set

STRONG_FIELDS = frozenset({"strong_choice_probability", "log_strong_choice_probability"})
CAL_L2 = 10.0
PROP_L2 = 1.0
GTOL = 1e-6
FTOL = 1e-12
MAXITER = 500
MAXLS = 50
BOOT = 5000
SEED = 529
WEIGHT_CAPS = (10.0, 20.0, 50.0)
INNER_FEATURE_FOLDS = 5
MIN_METADATA_COVERAGE = 0.98
MODELS = ("H", "J", "N", "Q")
BENCHMARKS = ("A", "GIH")
ALL = MODELS + BENCHMARKS


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--expansion", choices=("EOE", "FIN", "TDM", "DFT"), required=True)
    p.add_argument("--draft-archive", type=Path, required=True)
    p.add_argument("--game-archive", type=Path, required=True)
    p.add_argument("--max-drafts", type=int, default=8000)
    p.add_argument("--freeze-json", type=Path, required=True)
    p.add_argument("--freeze-q-pickle", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    return p.parse_args()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def _drop_strong(row):
    return {k: float(v) for k, v in row.items() if k not in STRONG_FIELDS}


def _drop_strong_map(features):
    return {a: _drop_strong(row) for a, row in features.items()}


def _argmax(values, names):
    return min(range(len(names)), key=lambda i: (-float(values[i]), str(names[i])))


def _signed_margin(values, selected):
    if len(values) <= 1:
        return 0.0
    other = max(float(values[i]) for i in range(len(values)) if i != selected)
    return float(values[selected]) - other


def _leader_margin(values, names):
    order = sorted(range(len(values)), key=lambda i: (-float(values[i]), str(names[i])))
    leader = order[0]
    return leader, (0.0 if len(order) == 1 else float(values[leader] - values[order[1]]))


def _std_predict(payload, x):
    x = np.asarray(x, dtype=np.float64)
    mean = np.asarray(payload["mean"], dtype=np.float64)
    scale = np.asarray(payload["scale"], dtype=np.float64)
    active = np.asarray(payload["active"], dtype=bool)
    beta = np.asarray(payload["beta"], dtype=np.float64)
    z = (x[:, active] - mean[active]) / scale[active]
    return float(payload["intercept"]) + z @ beta


def _ridge_predict(payload, x):
    return float(payload["intercept"]) + np.asarray(x, dtype=np.float64) @ np.asarray(payload["coef"], dtype=np.float64)


def _fit_std_ridge(x, y, l2=CAL_L2):
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    mean = x.mean(axis=0)
    scale = x.std(axis=0)
    active = scale > 1e-10
    z = (x[:, active] - mean[active]) / scale[active]
    d = np.empty((len(z), z.shape[1] + 1), dtype=np.float64)
    d[:, 0] = 1.0
    d[:, 1:] = z
    gram = d.T @ d
    gram[1:, 1:] += np.eye(z.shape[1]) * l2
    beta = np.linalg.solve(gram, d.T @ y)
    return mean, scale, active, float(beta[0]), beta[1:]


def _pred_std(model, x):
    mean, scale, active, intercept, beta = model
    x = np.asarray(x, dtype=np.float64)
    z = (x[:, active] - mean[active]) / scale[active]
    return intercept + z @ beta


def _metrics(y, pred):
    e = np.asarray(pred, dtype=float) - np.asarray(y, dtype=float)
    return {"n": int(len(e)), "rmse": float(np.sqrt(np.mean(e * e))), "mae": float(np.mean(np.abs(e))), "bias": float(np.mean(e))}


def _bootstrap_delta(y, base, alt):
    y = np.asarray(y, dtype=float)
    b = np.asarray(base, dtype=float) - y
    a = np.asarray(alt, dtype=float) - y
    dmse = a * a - b * b
    dmae = np.abs(a) - np.abs(b)
    rng = random.Random(SEED)
    ms, ma = [], []
    n = len(y)
    for _ in range(BOOT):
        idx = [rng.randrange(n) for __ in range(n)]
        ms.append(sum(dmse[i] for i in idx) / n)
        ma.append(sum(dmae[i] for i in idx) / n)
    ms.sort(); ma.sort()
    lo, hi = int(.025 * BOOT), int(.975 * BOOT)
    return {"draws": BOOT, "seed": SEED, "mse_delta": float(dmse.mean()), "mse_ci95": [float(ms[lo]), float(ms[hi])], "mae_delta": float(dmae.mean()), "mae_ci95": [float(ma[lo]), float(ma[hi])]}


def _cal_fit_predict(train_x, train_y, test_x):
    return _pred_std(_fit_std_ridge(train_x, train_y), test_x)


def _cal_cv(rows, cols, base_key="b1"):
    y = np.asarray([r["y"] for r in rows], dtype=float)
    folds = np.asarray([r["fold"] for r in rows], dtype=int)
    x = np.asarray([[*r[base_key], *[r[c] for c in cols]] for r in rows], dtype=float)
    pred = np.empty(len(rows), dtype=float)
    for fold in range(5):
        tr, te = folds != fold, folds == fold
        if not np.any(te) or not np.any(tr):
            raise SystemExit("calibration fold missing train or held rows")
        pred[te] = _cal_fit_predict(x[tr], y[tr], x[te])
    return pred


def _cal_validation(train, val, cols, base_key="b1"):
    tx = np.asarray([[*r[base_key], *[r[c] for c in cols]] for r in train], dtype=float)
    ty = np.asarray([r["y"] for r in train], dtype=float)
    vx = np.asarray([[*r[base_key], *[r[c] for c in cols]] for r in val], dtype=float)
    return _cal_fit_predict(tx, ty, vx)


def _compile_propensity(examples):
    for ex in examples:
        ex.validate()
    names = tuple(sorted({name for ex in examples for row in ex.features.values() for name in row}))
    at = {name: i for i, name in enumerate(names)}
    total = sum(ex.sample_weight for ex in examples)
    compiled = []
    for ex in examples:
        actions = tuple(ex.features)
        selected = actions.index(ex.selected_action)
        sparse = tuple(tuple((at[n], float(v)) for n, v in ex.features[a].items() if float(v) != 0.0) for a in actions)
        offsets = tuple(float(ex.offsets[a]) if ex.offsets is not None else 0.0 for a in actions)
        compiled.append((float(ex.sample_weight), selected, sparse, offsets))
    return names, compiled, float(total)


def _prop_objective(beta, compiled, total, l2):
    beta = np.asarray(beta, dtype=float)
    loss = 0.0
    grad = np.zeros(len(beta), dtype=float)
    for weight, selected, sparse_rows, offsets in compiled:
        scores = []
        for off, row in zip(offsets, sparse_rows):
            scores.append(off + sum(beta[i] * v for i, v in row))
        peak = max(scores)
        aw = [math.exp(s - peak) for s in scores]
        den = sum(aw)
        loss += weight * (peak + math.log(den) - scores[selected])
        for ai, row in enumerate(sparse_rows):
            residual = aw[ai] / den - (1.0 if ai == selected else 0.0)
            for i, v in row:
                grad[i] += weight * residual * v
    loss += .5 * l2 * float(np.dot(beta, beta))
    grad += l2 * beta
    return loss / total, grad / total


def _fit_propensity(rows, keep_offsets):
    examples = [PropensityExample(features=_drop_strong_map(r.features), selected_action=r.selected_action, sample_weight=r.sample_weight, offsets=(r.offsets if keep_offsets else None)) for r in rows]
    names, compiled, total = _compile_propensity(examples)
    def objective(beta):
        return _prop_objective(beta, compiled, total, PROP_L2)
    result = minimize(objective, x0=np.zeros(len(names), dtype=float), method="L-BFGS-B", jac=True, options={"gtol": GTOL, "ftol": FTOL, "maxiter": MAXITER, "maxls": MAXLS, "maxcor": 20})
    value, gradient = objective(result.x)
    gmax = float(np.max(np.abs(gradient))) if len(gradient) else 0.0
    if not result.success or gmax > GTOL:
        raise SystemExit(f"propensity convergence failure success={result.success} grad={gmax} message={result.message}")
    model = LinearSoftmaxPropensityModel(feature_names=names, coefficients=tuple(float(x) for x in result.x), l2=PROP_L2)
    return model, {"success": True, "iterations": int(result.nit), "objective": float(value), "gradient_max_abs": gmax, "features": len(names), "offset_mode": "keep" if keep_offsets else "none"}


def _load_fresh(args):
    selected = select_global_draft_ids([args.draft_archive], args.max_drafts)
    dev_ids = frozenset(d for d in selected if draft_split(d) in {"train", "validation"})
    assess_ids = frozenset(selected) - dev_ids
    decisions = load_decisions(args.draft_archive, keep_ids=dev_ids)
    if any(d.expansion != args.expansion for d in decisions):
        raise SystemExit("expansion mismatch")
    games = GameStore.from_archives([args.game_archive], dev_ids)
    train = [d for d in decisions if draft_split(d.draft_id) == "train"]
    validation = [d for d in decisions if draft_split(d.draft_id) == "validation"]
    if not train or not validation:
        raise SystemExit("fresh split missing train or validation")
    return selected, assess_ids, decisions, games, train, validation


def _metadata(expansion, train, validation):
    wanted = set()
    for d in [*train, *validation]:
        if int(d.pack_number) != PRIMARY_PACK or not (PRIMARY_PICK_START <= int(d.pick_number) < PRIMARY_PICK_STOP):
            continue
        wanted.update(d.candidates)
        wanted.update(name for name, _ in d.pool)
    resolved, unresolved = _fetch_rich_set(expansion, wanted)
    coverage = len(resolved) / max(1, len(wanted))
    if coverage < MIN_METADATA_COVERAGE:
        raise SystemExit(f"metadata coverage {coverage:.2%} below threshold")
    return resolved, unresolved, coverage


def _score_decision(decision, base_features, metadata, freeze, q_model):
    state, cand = rich_feature_bundle(decision, base_features, metadata)
    state_names = freeze["schema"]["state_feature_names"]
    cand_names = freeze["schema"]["candidate_feature_names"]
    unknown_cand = set().union(*(set(row) for row in cand.values())) - set(cand_names)
    if unknown_cand:
        raise SystemExit("unknown candidate features: " + ",".join(sorted(unknown_cand)[:20]))
    unknown_state = set(state) - set(state_names)
    bad_state = {n for n in unknown_state if not n.startswith("base:set=")}
    if bad_state:
        raise SystemExit("unknown non-set state features: " + ",".join(sorted(bad_state)[:20]))

    names = list(decision.candidates)
    state_vec = np.asarray([float(state.get(n, 0.0)) for n in state_names], dtype=float)
    cand_mat = np.asarray([[float(cand[a].get(n, 0.0)) for n in cand_names] for a in names], dtype=float)
    simple_state = np.asarray([float(state.get(n, 0.0)) for n in freeze["schema"]["simple_state_feature_names"]], dtype=float)
    simple_cand = np.asarray([[float(cand[a].get(n, 0.0)) for n in freeze["schema"]["simple_candidate_feature_names"]] for a in names], dtype=float)
    sx = np.concatenate([np.repeat(simple_state[None, :], len(names), axis=0), simple_cand], axis=1)
    h = _ridge_predict(freeze["H"], sx)
    n = _ridge_predict(freeze["N"], sx)
    qsimple = _ridge_predict(freeze["simple_Q"], sx)

    rawj = np.asarray(freeze["J"]["raw"], dtype=float)
    j = qsimple + (cand_mat - cand_mat.mean(axis=0)) @ rawj

    control = np.asarray([float(state.get(nm, 0.0)) for nm in freeze["schema"]["control_state_feature_names"]], dtype=float)
    nonlinear = np.asarray([float(state.get(nm, 0.0)) for nm in freeze["schema"]["nonlinear_state_feature_names"]], dtype=np.float32)
    qx = np.concatenate([np.repeat(nonlinear[None, :], len(names), axis=0), cand_mat.astype(np.float32)], axis=1)
    qcontrol = float(freeze["rich_Q_control"]["intercept"]) + control @ np.asarray(freeze["rich_Q_control"]["coef"], dtype=float)
    q = qcontrol + q_model.predict(qx).astype(float)

    strong = np.asarray([float(base_features[a].get("strong_choice_probability", 0.0)) for a in names], dtype=float)
    gih = np.asarray([float(base_features[a].get("gih_wr", 0.0)) for a in names], dtype=float)
    return state_vec, {"H": h, "J": j, "N": n, "Q": q, "A": strong, "GIH": gih}, qsimple


def _build_records(rows_with_scores, freeze, role):
    groups = defaultdict(lambda: {"state": [], "gih_mean": [], "gih_max": [], "qsel": [], "qmax": [], "qm": [], "m": defaultdict(list), "agree": defaultdict(list), "y": None})
    decision_details = []
    for item in rows_with_scores:
        d = item["decision"]
        if int(d.pack_number) != PRIMARY_PACK or not (PRIMARY_PICK_START <= int(d.pick_number) < PRIMARY_PICK_STOP):
            continue
        names = list(d.candidates)
        sel = names.index(d.selected_card)
        scores = item["scores"]
        qsimple = item["qsimple"]
        g = groups[d.draft_id]
        g["state"].append(item["state"])
        g["gih_mean"].append(float(np.mean(scores["GIH"])))
        g["gih_max"].append(float(np.max(scores["GIH"])))
        g["qsel"].append(float(qsimple[sel]))
        g["qmax"].append(float(np.max(qsimple)))
        g["qm"].append(_signed_margin(qsimple, sel))
        g["y"] = float(d.event_match_wins)
        detail = {"decision": d, "base_features": item["base_features"], "offsets": item.get("offsets"), "scores": scores, "qsimple": qsimple, "sel": sel}
        for k in ALL:
            lead, lm = _leader_margin(scores[k], names)
            g["m"][k].append(_signed_margin(scores[k], sel))
            g["agree"][k].append(int(lead == sel))
            detail[k + "_leader"] = lead
            detail[k + "_leader_margin"] = lm
        decision_details.append(detail)
    out = []
    for draft in sorted(groups):
        g = groups[draft]
        mean_state = np.mean(np.asarray(g["state"], dtype=float), axis=0)
        # Timing of public skill/experience fields remains unresolved. Exclude them
        # from B0 and let the shared frozen Q baseline carry any common predictive use.
        state_names = freeze["schema"]["state_feature_names"]
        safe_idx = [i for i, n in enumerate(state_names) if n not in {"base:user_game_win_rate", "base:log1p_user_games"} and not n.startswith("base:rank=")]
        b0 = np.concatenate([mean_state[safe_idx], [np.mean(g["gih_mean"]), np.mean(g["gih_max"])]]).tolist()
        b1 = [*b0, float(np.mean(g["qsel"])), float(np.mean(g["qmax"])), float(np.mean(g["qm"]))]
        rec = {"draft_id": str(draft), "fold": nuisance_fold(str(draft), 5), "y": float(g["y"]), "b0": b0, "b1": b1, "state_resid": float(_std_predict(freeze["J_state_only"], mean_state[None, :])[0])}
        for k in ALL:
            rec[k] = float(np.mean(g["m"][k]))
            rec[k + "_hist_agree"] = float(np.mean(g["agree"][k]))
        out.append(rec)
    if not out:
        raise SystemExit(f"{role}: no primary draft records")
    return out, decision_details


def _primary_ope_details(details):
    by = defaultdict(list)
    for item in details:
        d = item["decision"]
        by[str(d.draft_id)].append(item)
    return [min(by[d], key=lambda x: stable_score(f"contextual-value-v1-primary:{x['decision'].decision_id}")) for d in sorted(by)]


def _ope_observations(details, policy, behavior_model, keep_offsets):
    out = []
    for item in details:
        d = item["decision"]
        names = list(d.candidates)
        features = _drop_strong_map(item["base_features"])
        # Use the exact offsets already built from leakage-safe signals.
        raw_offsets = item.get("offsets")
        behavior = behavior_model.probabilities(features, raw_offsets if keep_offsets else None)
        lead = int(item[policy + "_leader"])
        out.append(PolicyObservation(action=d.selected_card, outcome=float(d.event_match_wins), behavior=behavior, target={a: 1.0 if i == lead else 0.0 for i, a in enumerate(names)}, q_values={a: float(item["qsimple"][i]) for i, a in enumerate(names)}, cluster=d.draft_id))
    return out


def _estimate_ope(obs, aobs):
    est = {str(int(c)): asdict(evaluate_policy(obs, c)) for c in WEIGHT_CAPS}
    aest = {str(int(c)): asdict(evaluate_policy(aobs, c)) for c in WEIGHT_CAPS}
    return {"estimates": est, "minus_A_cap20": {k: float(est["20"][k] - aest["20"][k]) for k in ("dr", "direct", "snips", "ipw")} | {"dr_ci95": paired_dr_delta_ci(obs, aobs, weight_cap=20.0)}}


def main():
    args = parse_args()
    freeze = json.loads(args.freeze_json.read_text(encoding="utf-8"))
    if freeze.get("assessment_opened") is not False or freeze.get("parity", {}).get("passed") is not True:
        raise SystemExit("invalid frozen bundle")
    with args.freeze_q_pickle.open("rb") as f:
        q_model = pickle.load(f)
    frozen_fingerprint = freeze["fingerprint_sha256"]

    selected, assess_ids, decisions, games, train, validation = _load_fresh(args)
    provider = ArchiveSignalProvider(decisions, games)
    train_ids = frozenset(d.draft_id for d in train)
    metadata, unresolved, coverage = _metadata(args.expansion, train, validation)

    # Cross-fitted training feature maps are used both for calibration and for the
    # two fixed behavior nuisances. This is the expensive step, done once.
    train_rows = build_fold_training_rows(train, train_ids, signal_provider=provider, inner_feature_folds=INNER_FEATURE_FOLDS)
    decision_by_id = {d.decision_id: d for d in train}
    train_scored = []
    for idx, row in enumerate(train_rows, start=1):
        d = decision_by_id[row.decision_id]
        if int(d.pack_number) != PRIMARY_PACK or not (PRIMARY_PICK_START <= int(d.pick_number) < PRIMARY_PICK_STOP):
            continue
        state, scores, qsimple = _score_decision(d, row.features, metadata, freeze, q_model)
        train_scored.append({"decision": d, "base_features": row.features, "offsets": row.offsets, "state": state, "scores": scores, "qsimple": qsimple})

    strong_behavior, strong_fit = _fit_propensity(train_rows, True)
    nostrong_behavior, nostrong_fit = _fit_propensity(train_rows, False)

    val_scored = []
    for d in validation:
        if int(d.pack_number) != PRIMARY_PACK or not (PRIMARY_PICK_START <= int(d.pick_number) < PRIMARY_PICK_STOP):
            continue
        signals = provider(d, train_ids)
        features = model_feature_map(d, signals)
        state, scores, qsimple = _score_decision(d, features, metadata, freeze, q_model)
        val_scored.append({"decision": d, "base_features": features, "offsets": strong_choice_offsets(signals, d.candidates), "state": state, "scores": scores, "qsimple": qsimple})

    train_records, train_details = _build_records(train_scored, freeze, "train")
    val_records, val_details = _build_records(val_scored, freeze, "validation")
    ty = np.asarray([r["y"] for r in train_records], dtype=float)
    vy = np.asarray([r["y"] for r in val_records], dtype=float)

    b0_cv = _cal_cv(train_records, [], "b0")
    b0_val = _cal_validation(train_records, val_records, [], "b0")
    b1_cv = _cal_cv(train_records, [], "b1")
    b1_val = _cal_validation(train_records, val_records, [], "b1")
    incremental = {
        "B0_pre_pick_state": {"train_cv": _metrics(ty, b0_cv), "validation": _metrics(vy, b0_val)},
        "B1_shared_simple_Q": {"train_cv": _metrics(ty, b1_cv), "validation": _metrics(vy, b1_val), "validation_vs_B0": _bootstrap_delta(vy, b0_val, b1_val)},
    }
    for k in ALL:
        cvp = _cal_cv(train_records, [k], "b1")
        vp = _cal_validation(train_records, val_records, [k], "b1")
        incremental[k] = {"train_cv": _metrics(ty, cvp), "validation": _metrics(vy, vp), "validation_vs_B1": _bootstrap_delta(vy, b1_val, vp), "historical_agreement": float(np.mean([r[k + "_hist_agree"] for r in val_records]))}

    scv = _cal_cv(train_records, ["state_resid"], "b1")
    sval = _cal_validation(train_records, val_records, ["state_resid"], "b1")
    sjcv = _cal_cv(train_records, ["state_resid", "J"], "b1")
    sjval = _cal_validation(train_records, val_records, ["state_resid", "J"], "b1")
    card_specific = {"state_only": {"train_cv": _metrics(ty, scv), "validation": _metrics(vy, sval), "validation_vs_B1": _bootstrap_delta(vy, b1_val, sval)}, "state_plus_J_margin": {"train_cv": _metrics(ty, sjcv), "validation": _metrics(vy, sjval), "validation_vs_state_only": _bootstrap_delta(vy, sval, sjval)}}

    # Disagreement/stability and J-vs-simple-Q leader change.
    disagreements = {}
    for i, left in enumerate(ALL):
        for right in ALL[i + 1:]:
            rows = []
            for item in val_details:
                if item[left + "_leader"] != item[right + "_leader"]:
                    rows.append(item)
            disagreements[f"{left}_vs_{right}"] = {"decisions": len(rows), "fraction": len(rows) / max(1, len(val_details)), "drafts": len({r["decision"].draft_id for r in rows}), "historical_align_left": int(sum(r[left + "_leader"] == r["sel"] for r in rows)), "historical_align_right": int(sum(r[right + "_leader"] == r["sel"] for r in rows))}
    j_change = 0
    for item in val_details:
        names = list(item["decision"].candidates)
        qlead = _argmax(item["qsimple"], names)
        j_change += int(item["J_leader"] != qlead)

    primary = _primary_ope_details(val_details)
    ope = {}
    for ename, model, keep in (("strong_offset_only", strong_behavior, True), ("no_strong_entirely", nostrong_behavior, False)):
        aobs = _ope_observations(primary, "A", model, keep)
        ope[ename] = {}
        for k in ALL:
            ope[ename][k] = _estimate_ope(_ope_observations(primary, k, model, keep), aobs)

    report = {
        "phase": "four_way_fresh_environment_confirmation",
        "scope": "fresh_environment_validation_only",
        "expansion": args.expansion,
        "assessment_opened": False,
        "assessment_outcomes_loaded": False,
        "assessment_outcomes_used": False,
        "model_tuning_authorized": False,
        "frozen_score_fingerprint": frozen_fingerprint,
        "archive_snapshot": {"draft_sha256": sha256(args.draft_archive), "game_sha256": sha256(args.game_archive), "max_drafts": args.max_drafts},
        "cohort": {"selected_drafts": len(selected), "train_drafts": len({d.draft_id for d in train}), "validation_drafts": len({d.draft_id for d in validation}), "assessment_drafts_withheld": len(assess_ids), "train_primary_drafts": len(train_records), "validation_primary_drafts": len(val_records), "validation_primary_decisions": len(val_details)},
        "metadata": {"coverage": coverage, "unresolved_count": len(unresolved), "unresolved": unresolved},
        "behavior_nuisance": {"strong_offset_only": strong_fit, "no_strong_entirely": nostrong_fit},
        "incremental_prediction": incremental,
        "J_card_specific_test": card_specific,
        "J_leader_change_vs_simple_Q": {"decisions": len(val_details), "count": int(j_change), "fraction": float(j_change / max(1, len(val_details)))},
        "disagreements": disagreements,
        "ope_sensitivity": ope,
        "interpretation_boundary": "Fresh held-out predictive improvement shows transport of ranking information beyond the shared baseline; it is not proof of the causal effect of an unchosen card. The four score models and hyperparameters are frozen from core. Fresh train is used only for leakage-safe aggregate signals, common calibration, and behavior nuisances. Assessment remains withheld.",
        "next_gate": {"assessment_authorized": False, "model_tuning_authorized": False, "instruction": "Aggregate all four predeclared environments before changing the finalist set or any model specification."},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"expansion": args.expansion, "cohort": report["cohort"], "mse_delta_vs_B1": {k: incremental[k]["validation_vs_B1"]["mse_delta"] for k in ALL}, "J_card_specific_delta": card_specific["state_plus_J_margin"]["validation_vs_state_only"]["mse_delta"], "assessment_opened": False}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()