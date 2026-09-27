#!/usr/bin/env python3
"""Bounded propensity-free margin comparison for issue #529.

Candidates: H, J, N, boosted rich-Q. Benchmarks: incumbent A and GIH-only.
Assessment remains sealed. The repeatedly examined core validation partition is
exploratory model-selection evidence only; no assessment authorization occurs.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import random
import re
import sys
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "research"))

import numpy as np

from build_replays import stable_score
from contextual_value import PRIMARY_PACK, PRIMARY_PICK_START, PRIMARY_PICK_STOP
from contextual_value.diagnostics import paired_dr_delta_ci
from contextual_value.dr import PolicyObservation, evaluate_policy

VALUE_L2 = 10.0
CAL_L2 = 10.0
J_L2 = 10000.0
PSEUDO_CAP = 20.0
BOOT = 5000
SEED = 529
WEIGHT_CAPS = (10.0, 20.0, 50.0)
MODELS = ("H", "J", "N", "Q")
BENCHMARKS = ("A", "GIH")
ALL_POLICIES = MODELS + BENCHMARKS


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--train-shard", action="append", type=Path, required=True)
    p.add_argument("--validation-shard", type=Path, required=True)
    p.add_argument("--feature-report", type=Path, required=True)
    p.add_argument("--strong-prediction", action="append", type=Path, required=True)
    p.add_argument("--no-strong-prediction", action="append", type=Path, required=True)
    p.add_argument("--held-feature", action="append", type=Path, required=True)
    p.add_argument("--ablation-report", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    return p.parse_args()


def _fold_from_path(path: Path) -> int:
    m = re.search(r"fold-(-?\d+)", path.name)
    if not m:
        raise SystemExit(f"cannot infer fold from {path}")
    return int(m.group(1))


def _load_npz(path: Path) -> dict[str, np.ndarray]:
    with np.load(path, allow_pickle=False) as d:
        return {k: d[k] for k in d.files}


def _load_jsonl_gz(path: Path) -> list[dict]:
    out = []
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                out.append(json.loads(line))
    return out


def _prediction_map(path: Path) -> dict[str, dict]:
    out = {}
    for row in _load_jsonl_gz(path):
        did = str(row["decision_id"])
        if did in out:
            raise SystemExit(f"duplicate prediction {did} in {path}")
        out[did] = row
    return out


def _held_score_map(path: Path) -> dict[str, dict[str, dict[str, float]]]:
    out = {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            if int(row["pack_number"]) != PRIMARY_PACK or not (
                PRIMARY_PICK_START <= int(row["pick_number"]) < PRIMARY_PICK_STOP
            ):
                continue
            scores = {}
            for action, feat in row["features"].items():
                scores[str(action)] = {
                    "A": float(feat.get("strong_choice_probability", 0.0)),
                    "GIH": float(feat.get("gih_wr", 0.0)),
                }
            out[str(row["decision_id"])] = scores
    return out


def _argmax(values: np.ndarray, names: np.ndarray) -> int:
    return min(
        range(len(values)),
        key=lambda i: (-float(values[i]), str(names[i])),
    )


def _signed_margin(values: np.ndarray, selected: int) -> float:
    if len(values) <= 1:
        return 0.0
    other = max(float(values[i]) for i in range(len(values)) if i != selected)
    return float(values[selected]) - other


def _leader_margin(values: np.ndarray, names: np.ndarray) -> tuple[int, float]:
    order = sorted(range(len(values)), key=lambda i: (-float(values[i]), str(names[i])))
    leader = order[0]
    margin = 0.0 if len(order) == 1 else float(values[leader] - values[order[1]])
    return leader, margin


def _align_prediction_arrays(shard: dict, predictions: dict[str, dict]):
    q = np.empty(len(shard["candidate_names"]), dtype=np.float64)
    behavior = np.empty(len(shard["candidate_names"]), dtype=np.float64)
    seen = set()
    for i, did_raw in enumerate(shard["decision_ids"]):
        did = str(did_raw)
        row = predictions.get(did)
        if row is None:
            raise SystemExit(f"missing prediction for {did}")
        seen.add(did)
        s, t = int(shard["offsets"][i]), int(shard["offsets"][i + 1])
        names = [str(x) for x in shard["candidate_names"][s:t]]
        if set(row["q_values"]) != set(names) or set(row["behavior"]) != set(names):
            raise SystemExit(f"candidate mismatch for {did}")
        for j, name in enumerate(names):
            q[s + j] = float(row["q_values"][name])
            behavior[s + j] = float(row["behavior"][name])
    if seen != set(predictions):
        raise SystemExit("prediction file contains decisions outside shard")
    return q, behavior


def _reconstruct_rich_q(shard: dict, strong_behavior: np.ndarray) -> np.ndarray:
    if "q_rich" in shard:
        return shard["q_rich"].astype(np.float64)
    phi = shard["phi_rich"].astype(np.float64)
    q = phi.copy()
    for i in range(len(shard["decision_ids"])):
        s = int(shard["offsets"][i])
        selected = int(shard["selected_ord"][i])
        g = s + selected
        inv = min(1.0 / float(strong_behavior[g]), PSEUDO_CAP)
        if abs(inv - 1.0) < 1e-12:
            raise SystemExit("cannot reconstruct selected rich Q at inverse weight 1")
        y = float(shard["outcome"][i])
        q[g] = (float(phi[g]) - inv * y) / (1.0 - inv)
    return q


def _pseudo_from_arrays(shard: dict, q: np.ndarray, behavior: np.ndarray) -> np.ndarray:
    phi = q.astype(np.float64).copy()
    for i in range(len(shard["decision_ids"])):
        s = int(shard["offsets"][i])
        selected = int(shard["selected_ord"][i])
        g = s + selected
        inv = min(1.0 / float(behavior[g]), PSEUDO_CAP)
        phi[g] += inv * (float(shard["outcome"][i]) - float(q[g]))
    return phi


def _design(shard: dict) -> tuple[np.ndarray, np.ndarray]:
    counts = np.diff(shard["offsets"]).astype(np.int64)
    x = np.concatenate([
        np.repeat(shard["state_simple"].astype(np.float64), counts, axis=0),
        shard["cand_simple"].astype(np.float64),
    ], axis=1)
    w = np.repeat(shard["decision_weight"].astype(np.float64) / counts, counts)
    return x, w


def _suff(x: np.ndarray, w: np.ndarray, yh: np.ndarray, yn: np.ndarray) -> dict:
    d = np.empty((len(x), x.shape[1] + 1), dtype=np.float64)
    d[:, 0] = 1.0
    d[:, 1:] = x
    xtw = d.T * w
    return {
        "gram": xtw @ d,
        "rhs_h": xtw @ yh,
        "rhs_n": xtw @ yn,
    }


def _sum_stats(stats: list[dict]) -> dict:
    return {
        "gram": sum((s["gram"] for s in stats), np.zeros_like(stats[0]["gram"])),
        "rhs_h": sum((s["rhs_h"] for s in stats), np.zeros_like(stats[0]["rhs_h"])),
        "rhs_n": sum((s["rhs_n"] for s in stats), np.zeros_like(stats[0]["rhs_n"])),
    }


def _fit_from_stats(stats: dict, rhs_key: str) -> tuple[float, np.ndarray]:
    gram = stats["gram"].copy()
    gram[1:, 1:] += np.eye(gram.shape[0] - 1) * VALUE_L2
    beta = np.linalg.solve(gram, stats[rhs_key])
    return float(beta[0]), beta[1:]


def _pred_ridge(model, x):
    return model[0] + np.asarray(x, dtype=np.float64) @ np.asarray(model[1], dtype=np.float64)


def _std_ridge_fit(x: np.ndarray, y: np.ndarray, l2: float):
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    mu = x.mean(axis=0)
    sd = x.std(axis=0)
    active = sd > 1e-10
    z = (x[:, active] - mu[active]) / sd[active]
    d = np.empty((len(z), z.shape[1] + 1), dtype=np.float64)
    d[:, 0] = 1.0
    d[:, 1:] = z
    gram = d.T @ d
    gram[1:, 1:] += np.eye(z.shape[1]) * l2
    rhs = d.T @ y
    beta = np.linalg.solve(gram, rhs)
    return mu, sd, active, float(beta[0]), beta[1:]


def _std_ridge_predict(model, x: np.ndarray) -> np.ndarray:
    mu, sd, active, intercept, beta = model
    z = (np.asarray(x, dtype=np.float64)[:, active] - mu[active]) / sd[active]
    return intercept + z @ beta


def _raw_coef(model, width: int) -> np.ndarray:
    mu, sd, active, intercept, beta = model
    out = np.zeros(width, dtype=np.float64)
    out[active] = beta / sd[active]
    return out


def _primary_mask(shard: dict) -> np.ndarray:
    return (
        (shard["pack_number"].astype(int) == PRIMARY_PACK)
        & (shard["pick_number"].astype(int) >= PRIMARY_PICK_START)
        & (shard["pick_number"].astype(int) < PRIMARY_PICK_STOP)
    )


def _j_rows(shard: dict, q_simple: np.ndarray):
    groups = defaultdict(lambda: [[], [], None, []])
    mask = _primary_mask(shard)
    for i in np.flatnonzero(mask):
        s, t = int(shard["offsets"][i]), int(shard["offsets"][i + 1])
        cand = shard["cand_rich"][s:t].astype(np.float64)
        rel = cand[int(shard["selected_ord"][i])] - cand.mean(axis=0)
        did = str(shard["draft_ids"][i])
        row = groups[did]
        row[0].append(rel)
        row[1].append(float(q_simple[s + int(shard["selected_ord"][i])]))
        row[2] = float(shard["outcome"][i])
        row[3].append(shard["state_rich"][i].astype(np.float64))
    ids = sorted(groups)
    xj = np.stack([np.mean(groups[d][0], axis=0) for d in ids])
    base = np.asarray([np.mean(groups[d][1]) for d in ids], dtype=np.float64)
    y = np.asarray([groups[d][2] for d in ids], dtype=np.float64)
    xs = np.stack([np.mean(groups[d][3], axis=0) for d in ids])
    return ids, xj, xs, base, y


def _fit_j(x: np.ndarray, y: np.ndarray, base: np.ndarray):
    return _std_ridge_fit(x, y - base, J_L2)


def _bootstrap_delta(y, base, alt):
    y = np.asarray(y, dtype=np.float64)
    b = np.asarray(base, dtype=np.float64) - y
    a = np.asarray(alt, dtype=np.float64) - y
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
    return {
        "draws": BOOT,
        "seed": SEED,
        "mse_delta": float(dmse.mean()),
        "mse_ci95": [float(ms[lo]), float(ms[hi])],
        "mae_delta": float(dmae.mean()),
        "mae_ci95": [float(ma[lo]), float(ma[hi])],
    }


def _metrics(y, pred):
    e = np.asarray(pred) - np.asarray(y)
    return {
        "n": int(len(e)),
        "rmse": float(np.sqrt(np.mean(e * e))),
        "mae": float(np.mean(np.abs(e))),
        "bias": float(np.mean(e)),
    }


def _b0_cv(train_rows):
    y = np.asarray([r["y"] for r in train_rows], dtype=np.float64)
    pred = np.empty(len(train_rows), dtype=np.float64)
    folds = np.asarray([r["fold"] for r in train_rows], dtype=int)
    x = np.asarray([r["b0"] for r in train_rows], dtype=np.float64)
    for fold in range(5):
        tr = folds != fold; te = folds == fold
        pred[te] = _cal_fit_predict(x[tr], y[tr], x[te])
    return pred


def _b0_validation(train_rows, val_rows):
    tx = np.asarray([r["b0"] for r in train_rows], dtype=np.float64)
    ty = np.asarray([r["y"] for r in train_rows], dtype=np.float64)
    vx = np.asarray([r["b0"] for r in val_rows], dtype=np.float64)
    return _cal_fit_predict(tx, ty, vx)


def _cal_fit_predict(train_x, train_y, test_x):
    model = _std_ridge_fit(train_x, train_y, CAL_L2)
    return _std_ridge_predict(model, test_x)


def _cal_cv(train_rows, columns):
    y = np.asarray([r["y"] for r in train_rows], dtype=np.float64)
    pred = np.empty(len(train_rows), dtype=np.float64)
    folds = np.asarray([r["fold"] for r in train_rows], dtype=int)
    x = np.asarray([[*r["b1"], *[r[c] for c in columns]] for r in train_rows], dtype=np.float64)
    for fold in range(5):
        tr = folds != fold; te = folds == fold
        pred[te] = _cal_fit_predict(x[tr], y[tr], x[te])
    return pred


def _cal_validation(train_rows, val_rows, columns):
    tx = np.asarray([[*r["b1"], *[r[c] for c in columns]] for r in train_rows], dtype=np.float64)
    ty = np.asarray([r["y"] for r in train_rows], dtype=np.float64)
    vx = np.asarray([[*r["b1"], *[r[c] for c in columns]] for r in val_rows], dtype=np.float64)
    return _cal_fit_predict(tx, ty, vx)


def _primary_ope_indices(shard: dict):
    by = defaultdict(list)
    for i, draft in enumerate(shard["draft_ids"]):
        if _primary_mask(shard)[i]:
            by[str(draft)].append(i)
    return [
        min(by[d], key=lambda i: stable_score(f"contextual-value-v1-primary:{str(shard['decision_ids'][i])}"))
        for d in sorted(by)
    ]


def _obs(shard, indices, leaders, behavior, q):
    out = []
    for i in indices:
        s, t = int(shard["offsets"][i]), int(shard["offsets"][i + 1])
        names = [str(x) for x in shard["candidate_names"][s:t]]
        selected = names[int(shard["selected_ord"][i])]
        chosen = names[int(leaders[i])]
        out.append(PolicyObservation(
            action=selected,
            outcome=float(shard["outcome"][i]),
            behavior={name: float(behavior[s+j]) for j, name in enumerate(names)},
            target={name: 1.0 if name == chosen else 0.0 for name in names},
            q_values={name: float(q[s+j]) for j, name in enumerate(names)},
            cluster=str(shard["draft_ids"][i]),
        ))
    return out


def _ope_report(obs, aobs):
    est = {str(int(cap)): asdict(evaluate_policy(obs, cap)) for cap in WEIGHT_CAPS}
    aest = {str(int(cap)): asdict(evaluate_policy(aobs, cap)) for cap in WEIGHT_CAPS}
    cap = "20"
    return {
        "estimates": est,
        "minus_A_cap20": {
            key: float(est[cap][key] - aest[cap][key])
            for key in ("dr", "direct", "snips", "ipw")
        } | {"dr_ci95": paired_dr_delta_ci(obs, aobs, weight_cap=20.0)},
    }


def main():
    args = parse_args()
    feature_report = json.loads(args.feature_report.read_text(encoding="utf-8"))
    if feature_report.get("assessment_opened") is not False:
        raise SystemExit("feature report assessment boundary violation")
    state_names = list(feature_report["state_feature_names"])

    shard_paths = {_fold_from_path(p): p for p in args.train_shard}
    if set(shard_paths) != set(range(5)):
        raise SystemExit("train shards must be folds 0..4")
    strong_paths = {_fold_from_path(p): p for p in args.strong_prediction}
    no_paths = {_fold_from_path(p): p for p in args.no_strong_prediction}
    held_paths = {_fold_from_path(p): p for p in args.held_feature}
    if set(strong_paths) != {-1,0,1,2,3,4} or set(no_paths) != {-1,0,1,2,3,4} or set(held_paths) != {-1,0,1,2,3,4}:
        raise SystemExit("prediction/held inputs must contain folds -1..4")

    folds = {}
    stats = {}
    jparts = {}
    for fold in range(5):
        sh = _load_npz(shard_paths[fold])
        if int(sh["fold"][0]) != fold or len(sh["state_rich"][0]) != len(state_names):
            raise SystemExit("training shard contract mismatch")
        sp = _prediction_map(strong_paths[fold])
        npred = _prediction_map(no_paths[fold])
        qs, bs = _align_prediction_arrays(sh, sp)
        qn, bn = _align_prediction_arrays(sh, npred)
        qr = _reconstruct_rich_q(sh, bs)
        phin = _pseudo_from_arrays(sh, qn, bn)
        x, w = _design(sh)
        stats[fold] = _suff(x, w, sh["phi_simple"].astype(np.float64), phin)
        held_scores = _held_score_map(held_paths[fold])
        ids, xj, xs, base, y = _j_rows(sh, qs)
        jparts[fold] = {"ids":ids,"xj":xj,"xs":xs,"base":base,"y":y}
        folds[fold] = {"sh":sh,"qs":qs,"qr":qr,"bs":bs,"qn":qn,"bn":bn,"held":held_scores}

    # Cross-fitted final policy scores for H/N and J/state-only controls.
    train_records = []
    all_stats = _sum_stats([stats[f] for f in range(5)])
    all_jx = np.concatenate([jparts[f]["xj"] for f in range(5)])
    all_js = np.concatenate([jparts[f]["xs"] for f in range(5)])
    all_base = np.concatenate([jparts[f]["base"] for f in range(5)])
    all_y = np.concatenate([jparts[f]["y"] for f in range(5)])

    train_score_arrays = {}
    train_state_resid = {}
    for fold in range(5):
        other_stats = _sum_stats([stats[f] for f in range(5) if f != fold])
        hmod = _fit_from_stats(other_stats, "rhs_h")
        nmod = _fit_from_stats(other_stats, "rhs_n")
        mask_parts = [f for f in range(5) if f != fold]
        jx = np.concatenate([jparts[f]["xj"] for f in mask_parts])
        js = np.concatenate([jparts[f]["xs"] for f in mask_parts])
        base = np.concatenate([jparts[f]["base"] for f in mask_parts])
        y = np.concatenate([jparts[f]["y"] for f in mask_parts])
        jmod = _fit_j(jx, y, base)
        smod = _fit_j(js, y, base)
        sh = folds[fold]["sh"]
        x, _ = _design(sh)
        hscore = _pred_ridge(hmod, x)
        nscore = _pred_ridge(nmod, x)
        raw = _raw_coef(jmod, sh["cand_rich"].shape[1])
        jscore = folds[fold]["qs"].copy()
        for i in range(len(sh["decision_ids"])):
            s,t=int(sh["offsets"][i]),int(sh["offsets"][i+1])
            cand=sh["cand_rich"][s:t].astype(np.float64)
            jscore[s:t] += (cand-cand.mean(axis=0)) @ raw
        state_pred = _std_ridge_predict(smod, jparts[fold]["xs"])
        train_state_resid.update(dict(zip(jparts[fold]["ids"], map(float,state_pred))))
        train_score_arrays[fold] = {"H":hscore,"N":nscore,"J":jscore,"Q":folds[fold]["qr"]}

    # Validation final models.
    val = _load_npz(args.validation_shard)
    if int(val["fold"][0]) != -1 or len(val["state_rich"][0]) != len(state_names):
        raise SystemExit("validation shard contract mismatch")
    vheld = _held_score_map(held_paths[-1])
    vno = _prediction_map(no_paths[-1])
    vqn, vbn = _align_prediction_arrays(val, vno)
    hfull = _fit_from_stats(all_stats, "rhs_h")
    nfull = _fit_from_stats(all_stats, "rhs_n")
    vx, _ = _design(val)
    vh = _pred_ridge(hfull, vx)
    vn = _pred_ridge(nfull, vx)
    jfull = _fit_j(all_jx, all_y, all_base)
    sfull = _fit_j(all_js, all_y, all_base)
    rawj = _raw_coef(jfull, val["cand_rich"].shape[1])
    vj = val["q_simple"].astype(np.float64).copy()
    for i in range(len(val["decision_ids"])):
        s,t=int(val["offsets"][i]),int(val["offsets"][i+1])
        cand=val["cand_rich"][s:t].astype(np.float64)
        vj[s:t] += (cand-cand.mean(axis=0)) @ rawj
    vscore = {"H":vh,"N":vn,"J":vj,"Q":val["q_rich"].astype(np.float64)}

    def draft_records(sh, scores, held, fold, qsimple, state_resid_map=None, state_model=None):
        groups = defaultdict(lambda: {"state":[],"gih_mean":[],"gih_max":[],"qsel":[],"qmax":[],"qm":[],"m":defaultdict(list),"agree":defaultdict(list),"leader":defaultdict(list),"outcome":None})
        mask = _primary_mask(sh)
        for i in np.flatnonzero(mask):
            did=str(sh["decision_ids"][i]); draft=str(sh["draft_ids"][i]); s,t=int(sh["offsets"][i]),int(sh["offsets"][i+1]); names=sh["candidate_names"][s:t].astype(str); sel=int(sh["selected_ord"][i])
            hs=held.get(did)
            if hs is None or set(hs) != set(names): raise SystemExit(f"held score mismatch {did}")
            av=np.asarray([hs[n]["A"] for n in names],dtype=float); gv=np.asarray([hs[n]["GIH"] for n in names],dtype=float)
            r=groups[draft]; r["state"].append(sh["state_rich"][i].astype(float)); r["gih_mean"].append(float(gv.mean())); r["gih_max"].append(float(gv.max())); r["qsel"].append(float(qsimple[s+sel])); r["qmax"].append(float(qsimple[s:t].max())); r["qm"].append(_signed_margin(qsimple[s:t],sel)); r["outcome"]=float(sh["outcome"][i])
            local_scores={**{k:v[s:t] for k,v in scores.items()},"A":av,"GIH":gv}
            for k,sv in local_scores.items():
                leader,lm=_leader_margin(np.asarray(sv,float),names); r["m"][k].append(_signed_margin(np.asarray(sv,float),sel)); r["agree"][k].append(int(leader==sel)); r["leader"][k].append((did,leader,lm))
        out=[]
        for draft in sorted(groups):
            r=groups[draft]; b0=np.concatenate([np.mean(r["state"],axis=0),[np.mean(r["gih_mean"]),np.mean(r["gih_max"])]]); b1=np.concatenate([b0,[np.mean(r["qsel"]),np.mean(r["qmax"]),np.mean(r["qm"])]]).tolist()
            rec={"draft_id":draft,"fold":fold,"y":r["outcome"],"b0":b0.tolist(),"b1":b1}
            for k in ALL_POLICIES:
                rec[k]=float(np.mean(r["m"][k]))
                rec[k+"_hist_agree"]=float(np.mean(r["agree"][k]))
            if state_resid_map is not None: rec["state_resid"]=float(state_resid_map[draft])
            elif state_model is not None: rec["state_resid"]=float(_std_ridge_predict(state_model,np.mean(r["state"],axis=0)[None,:])[0])
            out.append(rec)
        return out

    # Build train records; simplify J-vs-Qsimple change directly after record construction.
    for fold in range(5):
        recs = draft_records(folds[fold]["sh"], train_score_arrays[fold], folds[fold]["held"], fold, folds[fold]["qs"], state_resid_map=train_state_resid)
        train_records.extend(recs)
    val_records = draft_records(val, vscore, vheld, -1, val["q_simple"].astype(float), state_model=sfull)
    if len(train_records) != 4789 or len(val_records) != 1218:
        raise SystemExit(f"draft cohort mismatch {len(train_records)}/{len(val_records)}")

    # Calibration comparison.
    ty=np.asarray([r["y"] for r in train_records]); vy=np.asarray([r["y"] for r in val_records])
    b0_cv=_b0_cv(train_records); b0_val=_b0_validation(train_records,val_records)
    base_cv=_cal_cv(train_records,[]); base_val=_cal_validation(train_records,val_records,[])
    comparison={
        "B0_pre_pick_state": {"train_cv":_metrics(ty,b0_cv),"validation":_metrics(vy,b0_val)},
        "B1_shared_simple_Q": {"train_cv":_metrics(ty,base_cv),"validation":_metrics(vy,base_val),"validation_vs_B0":_bootstrap_delta(vy,b0_val,base_val)},
    }
    for name in ALL_POLICIES:
        pcv=_cal_cv(train_records,[name]); pval=_cal_validation(train_records,val_records,[name])
        comparison[name]={"train_cv":_metrics(ty,pcv),"validation":_metrics(vy,pval),"validation_vs_B1":_bootstrap_delta(vy,base_val,pval),"historical_agreement":float(np.mean([r[name+"_hist_agree"] for r in val_records]))}
    scv=_cal_cv(train_records,["state_resid"]); sval=_cal_validation(train_records,val_records,["state_resid"])
    sjcv=_cal_cv(train_records,["state_resid","J"]); sjval=_cal_validation(train_records,val_records,["state_resid","J"])
    card_specific={"state_only":{"train_cv":_metrics(ty,scv),"validation":_metrics(vy,sval),"validation_vs_B1":_bootstrap_delta(vy,base_val,sval)},"state_plus_J_margin":{"train_cv":_metrics(ty,sjcv),"validation":_metrics(vy,sjval),"validation_vs_state_only":_bootstrap_delta(vy,sval,sjval)},"note":"J itself contains only candidate-minus-pack-mean correction features; state_only is the pack-invariant residual control."}

    # Validation leader arrays and disagreement diagnostics.
    leaders={k:{} for k in ALL_POLICIES}; leader_margins={k:[] for k in ALL_POLICIES}; supports={k:[] for k in ALL_POLICIES}
    primary_decisions=[]
    for i in np.flatnonzero(_primary_mask(val)):
        did=str(val["decision_ids"][i]); s,t=int(val["offsets"][i]),int(val["offsets"][i+1]); names=val["candidate_names"][s:t].astype(str); hs=vheld[did]; av=np.asarray([hs[n]["A"] for n in names]); gv=np.asarray([hs[n]["GIH"] for n in names]); local={**{k:v[s:t] for k,v in vscore.items()},"A":av,"GIH":gv}
        row={"i":i,"did":did,"draft":str(val["draft_ids"][i]),"sel":int(val["selected_ord"][i]),"y":float(val["outcome"][i]),"names":names}
        for k,sv in local.items():
            lead,lm=_leader_margin(np.asarray(sv,float),names); leaders[k][i]=lead; leader_margins[k].append(lm); supports[k].append(float(val["behavior"][s+lead]))
        primary_decisions.append(row)
    disagreements={}
    labels=list(ALL_POLICIES)
    for aidx,left in enumerate(labels):
        for right in labels[aidx+1:]:
            rows=[r for r in primary_decisions if leaders[left][r["i"]] != leaders[right][r["i"]]]
            key=f"{left}_vs_{right}"; la=sum(leaders[left][r["i"]]==r["sel"] for r in rows); ra=sum(leaders[right][r["i"]]==r["sel"] for r in rows)
            lo=[r["y"] for r in rows if leaders[left][r["i"]]==r["sel"]]; ro=[r["y"] for r in rows if leaders[right][r["i"]]==r["sel"]]
            ls=[]; rs=[]
            for r in rows:
                i=r["i"]; s=int(val["offsets"][i]); ls.append(float(val["behavior"][s+leaders[left][i]])); rs.append(float(val["behavior"][s+leaders[right][i]]))
            disagreements[key]={"decisions":len(rows),"fraction":len(rows)/max(1,len(primary_decisions)),"drafts":len(set(r["draft"] for r in rows)),"historical_align_left":int(la),"historical_align_right":int(ra),"historical_align_neither":int(len(rows)-la-ra),"mean_strong_behavior_support_left":None if not ls else float(np.mean(ls)),"mean_strong_behavior_support_right":None if not rs else float(np.mean(rs)),"mean_outcome_when_historical_align_left":None if not lo else float(np.mean(lo)),"mean_outcome_when_historical_align_right":None if not ro else float(np.mean(ro)),"note":"outcome means are descriptive; event outcome repeats within draft and is not a causal contrast"}
    stability={k:{"leader_margin_mean":float(np.mean(leader_margins[k])),"leader_margin_median":float(np.median(leader_margins[k])),"strong_behavior_support_mean":float(np.mean(supports[k]))} for k in ALL_POLICIES}
    j_change=sum(leaders["J"][r["i"]] != _leader_margin(val["q_simple"][int(val["offsets"][r["i"]]):int(val["offsets"][r["i"]+1])],r["names"])[0] for r in primary_decisions)

    # OPE sensitivity under two already-computed evaluators.
    ope_idx=_primary_ope_indices(val)
    policy_leaders={k:{i:leaders[k][i] for i in ope_idx} for k in ALL_POLICIES}
    qa=val["q_simple"].astype(float); ba=val["behavior"].astype(float)
    # no-strong arrays already aligned above
    evaluators={"strong_offset_only":{"behavior":ba,"q":qa},"no_strong_entirely":{"behavior":vbn,"q":vqn}}
    ope={}
    for ename,e in evaluators.items():
        aobs=_obs(val,ope_idx,policy_leaders["A"],e["behavior"],e["q"]); ope[ename]={}
        for k in ALL_POLICIES:
            obs=_obs(val,ope_idx,policy_leaders[k],e["behavior"],e["q"]); ope[ename][k]=_ope_report(obs,aobs)

    # Parity guards against retained ablation report for H and N.
    abl=json.loads(args.ablation_report.read_text(encoding="utf-8"))
    expected_h=abl["ablations"]["strong_offset_only"]["G_argmax_minus_A_cap20"]
    expected_n=abl["ablations"]["no_strong_entirely"]["G_argmax_minus_A_cap20"]
    actual_h=ope["strong_offset_only"]["H"]["minus_A_cap20"]
    actual_n=ope["no_strong_entirely"]["N"]["minus_A_cap20"]
    parity_h=max(abs(float(actual_h[k])-float(expected_h[k])) for k in ("dr","direct","snips","ipw")); parity_n=max(abs(float(actual_n[k])-float(expected_n[k])) for k in ("dr","direct","snips","ipw"))
    if parity_h > 1e-6 or parity_n > 1e-6:
        raise SystemExit(f"H/N parity failure H={parity_h} N={parity_n}")

    report={"phase":"four_way_incremental_margin_comparison","scope":"core-development-exploratory","assessment_opened":False,"assessment_outcomes_used":False,"assessment_authorized":False,"models":{"candidates":list(MODELS),"benchmarks":list(BENCHMARKS),"shared_Q_baseline":"strong-offset-only simple Q with strong-player ranking fields removed","J_l2":J_L2,"value_l2":VALUE_L2,"calibration_l2":CAL_L2},"cohort":{"train_drafts":len(train_records),"validation_drafts":len(val_records),"validation_primary_decisions":len(primary_decisions)},"incremental_prediction":comparison,"J_card_specific_test":card_specific,"J_leader_change_vs_simple_Q":{"decisions":len(primary_decisions),"count":int(j_change),"fraction":float(j_change/len(primary_decisions))},"disagreements":disagreements,"stability":stability,"ope_sensitivity":ope,"parity":{"H_max_abs_error":parity_h,"N_max_abs_error":parity_n,"passed":True},"interpretation_boundary":"Incremental held-out prediction can establish that a ranking margin contains information beyond shared pre-pick/Q baselines; it does not identify the causal win effect of taking an unchosen alternative. Final H/N/J score layers are cross-fitted across the retained outer-fold score artifacts for training calibration, while those artifacts retain their original nuisance cross-fitting. OPE is retained as sensitivity evidence. Core validation is repeatedly examined and is exploratory only.","next_gate":{"fresh_confirmation_required":True,"assessment_authorized":False,"instruction":"Use this comparison to freeze a small finalist set, then confirm unchanged finalists on a genuinely fresh sufficiently large chronological environment before any assessment request."}}
    args.output.parent.mkdir(parents=True,exist_ok=True); args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n",encoding="utf-8")
    print(json.dumps({"parity":report["parity"],"validation":{k:v.get("validation_vs_B1") for k,v in comparison.items() if k in ALL_POLICIES},"J_card_specific":card_specific,"J_change":report["J_leader_change_vs_simple_Q"]},indent=2,sort_keys=True))


if __name__ == "__main__":
    main()