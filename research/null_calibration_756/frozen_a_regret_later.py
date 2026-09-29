#!/usr/bin/env python3
"""Issue #756 secondary P1P2-P1P8 recentered-instrument A-regret analysis.

The same draft-level outcomes were opened by the completed P1P1 stage, so this
is secondary.  Nevertheless all recentering/support/first-stage gates are
computed without accessing Y inside this program, and later-pick value estimates
are only formed after the complete outcome-free preflight for all seven picks.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "research"))

from contextual_value.archive import ArchiveSignalProvider, GameStore, load_decisions

ISSUE = 756
PICKS = tuple(range(1, 8))
FOLDS = 5
POOL_MIN = 200
MIN_APPEAR = 200
MIN_TAKES = 40
MIN_TAKE_RATE = 0.03
MIN_SUPPORTED = 20
MIN_RANK_FRACTION = 0.90
MIN_MEDIAN_OWN_FS = 0.03
MIN_P10_OWN_FS = 0.005
MAX_HELD_MEAN = 0.05
MAX_HELD_CORR = 0.10
LAMBDA_H = 100.0
LAMBDA_IV = 10.0
CLIP = 1e-6
PRACTICAL = 0.02

EXPECTED_DRAFT = {
    "FIN": "9d5b2a3e908bb8daf0ea6e951097714b651546370a5c852893dc90a1f2f6ab8b",
    "TDM": "831ba8bc4be5eabe140fac00a8e6eaded3f3f931685be8f91403ad9cfde5cbf5",
    "DFT": "7812d16e0de78ff7a69faf9981f7ff03be4dfc618a86f14369424ec2204580cd",
    "MSH": "64100d71db77e0f0ef8ba893b259a1024eb6d15816db337c7758e7d96bc29cf7",
    "SOS": "df6220d8941e99b7264a54a7a7427096246ee6510057a83d4c9424b472761853",
}
EXPECTED_GAME = {
    "FIN": "f6452e622976f66dd5420c55741da5b246c7e8d25d63c080e728635e1741a6a6",
    "TDM": "e2e679168818d67d812972343ba541d626d0f57140bc22955e09dd07bc2086e4",
    "DFT": "734325afbe5c023245e7769fab66c88dcf241407666becb06b956d7fee13a28b",
    "MSH": "8a6bd93a5d50554a3d87703e93624d09e638dc6dd03eda12be9c3f2925484edf",
    "SOS": "1be513933918ca243c137af0314aae099c721c408786c9cb56f08027d9b113fb",
}
EXPECTED_UNUSED_DRAFT_IDS = {
    "FIN": 112237,
    "TDM": 73323,
    "DFT": 115504,
    "MSH": 66004,
    "SOS": 105200,
}


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--expansion", choices=tuple(EXPECTED_DRAFT), required=True)
    p.add_argument("--draft-archive", type=Path, required=True)
    p.add_argument("--game-archive", type=Path, required=True)
    p.add_argument("--spent-ledger", type=Path, required=True)
    p.add_argument("--reserve-json", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    return p.parse_args()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def fold_of(draft_id: str) -> int:
    digest = hashlib.sha256(f"a-regret-v1:{draft_id}".encode()).digest()
    return int.from_bytes(digest[:8], "big") % FOLDS


def as_int(value):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def count_of(value):
    try:
        v = float(value or 0)
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(v) or v <= 0:
        return 0
    return max(1, int(round(v)))


def logit(p: float) -> float:
    p = min(1.0 - CLIP, max(CLIP, float(p)))
    return math.log(p / (1.0 - p))


def load_prior(spent_ledger: Path, reserve_json: Path, expansion: str):
    with gzip.open(spent_ledger, "rt", encoding="utf-8") as f:
        ledger = json.load(f)
    rows = [r for r in ledger["rows"] if str(r["expansion"]) == expansion]
    excluded = {str(r["draft_id"]) for r in rows}
    reserve = json.loads(reserve_json.read_text())
    env = reserve.get("environments", {}).get(expansion)
    if env is not None:
        reserve_ids = set(map(str, env["reserve_ids"]))
        if len(reserve_ids) != 15000:
            raise SystemExit(f"{expansion}: retained R reserve is not 15,000")
        excluded |= reserve_ids
        train_ids = frozenset(map(str, env["prior_train_ids"]))
        train_source = "reserve.prior_train_ids"
    else:
        train_ids = frozenset(
            str(r["draft_id"]) for r in rows if "R_training" in set(r.get("usage", []))
        )
        train_source = "spent-ledger R_training"
    if not train_ids:
        raise SystemExit(f"{expansion}: no frozen A training IDs")
    return excluded, train_ids, rows, train_source


def build_strong_model(draft_archive: Path, game_archive: Path, expansion: str, train_ids: frozenset[str]):
    train = load_decisions(draft_archive, keep_ids=train_ids)
    seen = {str(d.draft_id) for d in train}
    if seen != set(train_ids):
        raise SystemExit(f"{expansion}: A training load mismatch missing={len(set(train_ids)-seen)}")
    games = GameStore.from_archive(game_archive, train_ids)
    provider = ArchiveSignalProvider(train, games)
    artifacts = provider.artifacts(train_ids, expansion)
    if artifacts.strong_model is None:
        raise SystemExit(f"{expansion}: strong model unavailable")
    return artifacts.strong_model, {
        "training_ids": len(train_ids),
        "strong_ids": len(artifacts.strong_ids),
    }


def scan_contexts(path: Path, expansion: str, excluded: set[str], model):
    by_pick = {p: [] for p in PICKS}
    invalid = Counter()
    seen = {p: set() for p in PICKS}
    with gzip.open(path, "rt", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        pos = {name: i for i, name in enumerate(header)}
        required = ("draft_id", "event_type", "pack_number", "pick_number", "pick")
        missing = [x for x in required if x not in pos]
        if missing:
            raise SystemExit(f"{expansion}: missing columns {missing}")
        pack_cols = [(sys.intern(name[len("pack_card_"):]), i) for i, name in enumerate(header) if name.startswith("pack_card_")]
        pool_cols = [(sys.intern(name[len("pool_"):]), i) for i, name in enumerate(header) if name.startswith("pool_")]
        for values in reader:
            if len(values) != len(header):
                continue
            if values[pos["event_type"]].strip() != "PremierDraft":
                continue
            if as_int(values[pos["pack_number"]]) != 0:
                continue
            pick = as_int(values[pos["pick_number"]])
            if pick not in by_pick:
                continue
            did = values[pos["draft_id"]].strip()
            if not did or did in excluded:
                continue
            if did in seen[pick]:
                raise SystemExit(f"{expansion}: duplicate row draft={did} pick={pick}")
            seen[pick].add(did)
            chosen = sys.intern(values[pos["pick"]].strip())
            candidates = tuple(card for card, i in pack_cols if count_of(values[i]) > 0)
            if not candidates or not chosen or chosen not in candidates:
                invalid[(pick, "bad_action")] += 1
                continue
            if len(candidates) != len(set(candidates)):
                invalid[(pick, "duplicate_card_name_action")] += 1
                candidates = tuple(dict.fromkeys(candidates))
            pool = tuple((card, n) for card, i in pool_cols if (n := count_of(values[i])) > 0)
            pool_dict = dict(pool)
            raw = tuple(float(model.card_tendency(card, 0, pick, pool_dict)) for card in candidates)
            ss = tuple(logit(x) for x in raw)
            total = sum(max(0.0, x) for x in raw)
            probs = tuple((max(0.0, x) / total if total > 0 else 1.0 / len(raw)) for x in raw)
            order = sorted(range(len(candidates)), key=lambda j: (-probs[j], candidates[j]))
            a_idx = order[0]
            margin = probs[order[0]] - probs[order[1]] if len(order) > 1 else 1.0
            by_pick[pick].append({
                "draft_id": did,
                "fold": fold_of(did),
                "candidates": candidates,
                "pool": pool,
                "historical_pick": chosen,
                "s": ss,
                "a_card": candidates[a_idx],
                "a_margin": float(margin),
                "a_probability": float(probs[a_idx]),
            })
    return by_pick, {f"p{k[0]}:{k[1]}": v for k, v in invalid.items()}


def support_and_pool_features(rows):
    appearances = Counter()
    takes = Counter()
    pool_presence = Counter()
    for r in rows:
        for c in r["candidates"]:
            appearances[c] += 1
        takes[r["historical_pick"]] += 1
        for c, _ in r["pool"]:
            pool_presence[c] += 1
    supported = sorted(
        c for c, n in appearances.items()
        if n >= MIN_APPEAR and takes[c] >= MIN_TAKES and takes[c] / n >= MIN_TAKE_RATE
    )
    pool_features = sorted(c for c, n in pool_presence.items() if n >= POOL_MIN)
    return supported, pool_features


def vectors(row, card_index, pool_index):
    m = len(card_index)
    q = len(pool_index) + 1
    h_idx = [0]
    h_val = [1.0]
    for c, n in row["pool"]:
        j = pool_index.get(c)
        if j is not None:
            h_idx.append(1 + j)
            h_val.append(float(n))
    offered = []
    offered_s = []
    for c, s in zip(row["candidates"], row["s"]):
        j = card_index.get(c)
        if j is not None:
            offered.append(j)
            offered_s.append(float(s))
    z_idx = offered
    if offered_s:
        z_extra = (max(offered_s), float(np.mean(offered_s)))
    else:
        z_extra = (0.0, 0.0)
    chosen_j = card_index.get(row["historical_pick"])
    try:
        chosen_pos = row["candidates"].index(row["historical_pick"])
        selected_s = float(row["s"][chosen_pos])
    except ValueError:
        selected_s = 0.0
    return h_idx, h_val, z_idx, z_extra, chosen_j, selected_s


def build_outcome_free_stats(rows, supported, pool_features):
    card_index = {c: j for j, c in enumerate(supported)}
    pool_index = {c: j for j, c in enumerate(pool_features)}
    m = len(supported)
    q = len(pool_features) + 1
    zdim = m + 2
    edim = m + 1
    HTH = np.zeros((q, q), dtype=np.float64)
    HTZ = np.zeros((q, zdim), dtype=np.float64)
    HTE = np.zeros((q, edim), dtype=np.float64)
    ZTZ = np.zeros((zdim, zdim), dtype=np.float64)
    ZTE = np.zeros((zdim, edim), dtype=np.float64)
    for row in rows:
        hi, hv, zi, zextra, cj, sel_s = vectors(row, card_index, pool_index)
        hi = np.asarray(hi, dtype=np.int64)
        hv = np.asarray(hv, dtype=np.float64)
        HTH[np.ix_(hi, hi)] += np.outer(hv, hv)
        zidx = list(zi) + [m, m + 1]
        zval = [1.0] * len(zi) + [float(zextra[0]), float(zextra[1])]
        z_pairs = [(j, v) for j, v in zip(zidx, zval) if v != 0.0]
        e_pairs = []
        if cj is not None:
            e_pairs.append((cj, 1.0))
        if sel_s != 0.0:
            e_pairs.append((m, float(sel_s)))
        if z_pairs:
            zj = np.asarray([x[0] for x in z_pairs], dtype=np.int64)
            zv = np.asarray([x[1] for x in z_pairs], dtype=np.float64)
            HTZ[np.ix_(hi, zj)] += hv[:, None] * zv[None, :]
            ZTZ[np.ix_(zj, zj)] += np.outer(zv, zv)
        if e_pairs:
            ej = np.asarray([x[0] for x in e_pairs], dtype=np.int64)
            ev = np.asarray([x[1] for x in e_pairs], dtype=np.float64)
            HTE[np.ix_(hi, ej)] += hv[:, None] * ev[None, :]
            if z_pairs:
                ZTE[np.ix_(zj, ej)] += zv[:, None] * ev[None, :]
    regH = HTH.copy()
    if q > 1:
        regH[1:, 1:] += np.eye(q - 1) * LAMBDA_H
    WZ = np.linalg.solve(regH, HTZ)
    WE = np.linalg.solve(regH, HTE)
    ZrTZr = ZTZ - HTZ.T @ WZ - WZ.T @ HTZ + WZ.T @ HTH @ WZ
    ZrTEr = ZTE - HTZ.T @ WE - WZ.T @ HTE + WZ.T @ HTH @ WE
    regZ = ZrTZr.copy()
    regZ += np.eye(zdim) * LAMBDA_IV
    B = np.linalg.solve(regZ, ZrTEr)
    own = np.asarray([B[j, j] for j in range(m)], dtype=np.float64) if m else np.asarray([])
    card_rank = int(np.linalg.matrix_rank(ZrTZr[:m, :m])) if m else 0
    rank_fraction = card_rank / m if m else 0.0
    return {
        "supported": supported,
        "pool_features": pool_features,
        "card_index": card_index,
        "pool_index": pool_index,
        "HTH": HTH,
        "HTZ": HTZ,
        "ZTZ": ZTZ,
        "WZ": WZ,
        "B": B,
        "ZrTZr": ZrTZr,
        "diagnostics": {
            "supported_cards": m,
            "pool_features": len(pool_features),
            "card_instrument_rank": card_rank,
            "rank_fraction": float(rank_fraction),
            "own_first_stage_median": float(np.median(own)) if len(own) else None,
            "own_first_stage_p10": float(np.quantile(own, 0.10)) if len(own) else None,
        },
    }


def heldout_recenter_diagnostics(rows, fit):
    m = len(fit["supported"])
    q = len(fit["pool_features"]) + 1
    WZ = fit["WZ"]
    card_index = fit["card_index"]
    pool_index = fit["pool_index"]
    n = 0
    sum_z = np.zeros(m, dtype=np.float64)
    sum_z2 = np.zeros(m, dtype=np.float64)
    sum_h = np.zeros(q, dtype=np.float64)
    sum_h2 = np.zeros(q, dtype=np.float64)
    cross = np.zeros((q, m), dtype=np.float64)
    for row in rows:
        hi, hv, zi, zextra, _cj, _s = vectors(row, card_index, pool_index)
        hi = np.asarray(hi, dtype=np.int64)
        hv = np.asarray(hv, dtype=np.float64)
        pred = (hv[:, None] * WZ[hi]).sum(axis=0)
        zr = -pred
        if zi:
            zr[np.asarray(zi, dtype=np.int64)] += 1.0
        zr[m] += zextra[0]
        zr[m + 1] += zextra[1]
        zc = zr[:m]
        n += 1
        sum_z += zc
        sum_z2 += zc * zc
        sum_h[hi] += hv
        sum_h2[hi] += hv * hv
        cross[hi] += hv[:, None] * zc[None, :]
    if not n or not m:
        return {"heldout_n": n, "max_abs_recentered_offer_mean": None, "max_abs_recentered_offer_pool_corr": None}
    mean_z = sum_z / n
    mean_h = sum_h / n
    var_z = np.maximum(0.0, sum_z2 / n - mean_z * mean_z)
    var_h = np.maximum(0.0, sum_h2 / n - mean_h * mean_h)
    cov = cross / n - mean_h[:, None] * mean_z[None, :]
    denom = np.sqrt(var_h[:, None] * var_z[None, :])
    valid = denom > 1e-12
    corr = np.zeros_like(cov)
    corr[valid] = cov[valid] / denom[valid]
    # intercept has zero variance and is ignored automatically
    return {
        "heldout_n": n,
        "max_abs_recentered_offer_mean": float(np.max(np.abs(mean_z))),
        "max_abs_recentered_offer_pool_corr": float(np.max(np.abs(corr[valid]))) if np.any(valid) else 0.0,
    }


def gate_fit(fit, held_diag):
    d = fit["diagnostics"]
    gate = bool(
        d["supported_cards"] >= MIN_SUPPORTED
        and d["rank_fraction"] >= MIN_RANK_FRACTION
        and d["own_first_stage_median"] is not None
        and d["own_first_stage_median"] >= MIN_MEDIAN_OWN_FS
        and d["own_first_stage_p10"] is not None
        and d["own_first_stage_p10"] >= MIN_P10_OWN_FS
        and held_diag["max_abs_recentered_offer_mean"] is not None
        and held_diag["max_abs_recentered_offer_mean"] <= MAX_HELD_MEAN
        and held_diag["max_abs_recentered_offer_pool_corr"] is not None
        and held_diag["max_abs_recentered_offer_pool_corr"] <= MAX_HELD_CORR
    )
    return gate


def read_outcomes(path: Path, wanted: set[str]):
    out = {}
    with gzip.open(path, "rt", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        header = next(reader)
        pos = {name: i for i, name in enumerate(header)}
        if "event_match_wins" not in pos:
            raise SystemExit("event_match_wins missing")
        for values in reader:
            if len(values) != len(header):
                continue
            did = values[pos["draft_id"]].strip()
            if did not in wanted or did in out:
                continue
            raw = values[pos["event_match_wins"]].strip()
            out[did] = None if raw == "" else float(raw)
    return out


def second_stage(rows, fit, outcomes):
    card_index = fit["card_index"]
    pool_index = fit["pool_index"]
    m = len(fit["supported"])
    q = len(fit["pool_features"]) + 1
    zdim = m + 2
    HTY = np.zeros(q, dtype=np.float64)
    ZTY = np.zeros(zdim, dtype=np.float64)
    for row in rows:
        y = outcomes[row["draft_id"]]
        hi, hv, zi, zextra, _cj, _s = vectors(row, card_index, pool_index)
        hi = np.asarray(hi, dtype=np.int64)
        hv = np.asarray(hv, dtype=np.float64)
        HTY[hi] += hv * y
        if zi:
            ZTY[np.asarray(zi, dtype=np.int64)] += y
        ZTY[m] += zextra[0] * y
        ZTY[m + 1] += zextra[1] * y
    regH = fit["HTH"].copy()
    if q > 1:
        regH[1:, 1:] += np.eye(q - 1) * LAMBDA_H
    WY = np.linalg.solve(regH, HTY)
    ZrTYr = ZTY - fit["HTZ"].T @ WY - fit["WZ"].T @ HTY + fit["WZ"].T @ fit["HTH"] @ WY
    B = fit["B"]
    XtX = B.T @ fit["ZrTZr"] @ B
    XtY = B.T @ ZrTYr
    XtX += np.eye(XtX.shape[0]) * LAMBDA_IV
    theta = np.linalg.solve(XtX, XtY)
    beta = {c: float(theta[j]) for j, c in enumerate(fit["supported"])}
    gamma = float(theta[m])
    return beta, gamma


def score_held(rows, fit, beta, gamma, expansion, pick):
    supported = set(fit["supported"])
    out = []
    unsupported_a = 0
    for row in rows:
        a = row["a_card"]
        if a not in supported:
            unsupported_a += 1
            continue
        vals = {}
        for c, s in zip(row["candidates"], row["s"]):
            if c in supported:
                vals[c] = beta[c] + gamma * float(s)
        if not vals:
            continue
        best = min(vals, key=lambda c: (-vals[c], c))
        regret = max(0.0, vals[best] - vals[a])
        out.append({
            "expansion": expansion,
            "draft_id": row["draft_id"],
            "pick_number": pick,
            "fold": row["fold"],
            "regret": float(regret),
            "a_card": a,
            "iv_best_card": best,
            "a_iv_disagree": bool(a != best),
            "historical_pick": row["historical_pick"],
            "a_historical_disagree": bool(a != row["historical_pick"]),
            "a_margin": float(row["a_margin"]),
            "a_probability": float(row["a_probability"]),
            "a_value": float(vals[a]),
            "iv_best_value": float(vals[best]),
            "gamma_a_context": gamma,
        })
    return out, unsupported_a


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")


def main():
    args = parse_args()
    exp = args.expansion
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if sha256(args.draft_archive) != EXPECTED_DRAFT[exp]:
        raise SystemExit(f"{exp}: draft hash mismatch")
    if sha256(args.game_archive) != EXPECTED_GAME[exp]:
        raise SystemExit(f"{exp}: game hash mismatch")

    excluded, train_ids, ledger_rows, train_source = load_prior(args.spent_ledger, args.reserve_json, exp)
    model, a_meta = build_strong_model(args.draft_archive, args.game_archive, exp, train_ids)
    by_pick, invalid = scan_contexts(args.draft_archive, exp, excluded, model)
    # Later-pick row coverage can exceed P1P1 coverage when the archive is
    # missing an opening-pack row for an otherwise logged draft (MSH: 1,
    # SOS: 3).  Bound by the exact unused *draft ID* supply instead.
    for pick in PICKS:
        if len(by_pick[pick]) > EXPECTED_UNUSED_DRAFT_IDS[exp]:
            raise SystemExit(f"{exp} P1P{pick+1}: more rows than frozen unused draft IDs")

    fit_by_cell = {}
    preflight_picks = {}
    all_ids = set()
    for pick in PICKS:
        rows = by_pick[pick]
        all_ids.update(r["draft_id"] for r in rows)
        fold_reports = []
        pick_ok = True
        for fold in range(FOLDS):
            training = [r for r in rows if r["fold"] != fold]
            held = [r for r in rows if r["fold"] == fold]
            supported, pool_features = support_and_pool_features(training)
            fit = build_outcome_free_stats(training, supported, pool_features)
            held_diag = heldout_recenter_diagnostics(held, fit)
            gate = gate_fit(fit, held_diag)
            fit_by_cell[(pick, fold)] = fit
            d = dict(fit["diagnostics"])
            d.update(held_diag)
            d.update({
                "fold": fold,
                "training_rows": len(training),
                "heldout_rows": len(held),
                "gate": gate,
            })
            fold_reports.append(d)
            pick_ok = pick_ok and gate
        preflight_picks[str(pick)] = {
            "raw_pick_number": pick,
            "display_pick": pick + 1,
            "rows": len(rows),
            "coverage_vs_frozen_unused_draft_ids": len(rows) / EXPECTED_UNUSED_DRAFT_IDS[exp],
            "all_fold_gates_pass": pick_ok,
            "folds": fold_reports,
        }

    if len(all_ids) > EXPECTED_UNUSED_DRAFT_IDS[exp]:
        raise SystemExit(
            f"{exp}: {len(all_ids)} later-pick draft IDs exceed frozen unused draft-ID supply "
            f"{EXPECTED_UNUSED_DRAFT_IDS[exp]}"
        )

    preflight = {
        "phase": "a_regret_p1p2_p1p8_recentered_outcome_free_preflight",
        "issue": ISSUE,
        "secondary_after_p1p1_outcome_open": True,
        "later_pick_value_estimates_computed": False,
        "expansion": exp,
        "protocol": "research/A-REGRET-RECENTERED-P1P2-P1P8-PROTOCOL-2026-09-29.md",
        "draft_sha256": EXPECTED_DRAFT[exp],
        "expected_unused_draft_ids": EXPECTED_UNUSED_DRAFT_IDS[exp],
        "later_pick_unique_draft_ids_seen": len(all_ids),
        "game_sha256": EXPECTED_GAME[exp],
        "prior_use": {
            "spent_ledger_rows_for_environment": len(ledger_rows),
            "excluded_ids_total": len(excluded),
            "a_training_ids": len(train_ids),
            "a_training_source": train_source,
        },
        "a": a_meta,
        "invalid_context_rows": invalid,
        "picks": preflight_picks,
        "identified_pick_numbers": [p for p in PICKS if preflight_picks[str(p)]["all_fold_gates_pass"]],
        "failed_pick_numbers": [p for p in PICKS if not preflight_picks[str(p)]["all_fold_gates_pass"]],
    }
    write_json(args.output_dir / "preflight-later.json", preflight)

    identified = set(preflight["identified_pick_numbers"])
    if not identified:
        report = {
            "phase": "a_regret_p1p2_p1p8_recentered_result",
            "issue": ISSUE,
            "expansion": exp,
            "status": "insufficient_recentered_identification",
            "secondary_after_p1p1_outcome_open": True,
            "preflight": preflight,
        }
        write_json(args.output_dir / "later-report.json", report)
        print(json.dumps({"expansion": exp, "status": report["status"]}, indent=2))
        return

    # Value-estimation boundary for this secondary extension.
    outcomes = read_outcomes(args.draft_archive, all_ids)
    missing = [did for did in all_ids if did not in outcomes or outcomes[did] is None]
    if missing:
        raise SystemExit(f"{exp}: missing later-pick draft outcomes n={len(missing)}")

    scored = []
    pick_results = {}
    for pick in PICKS:
        rows = by_pick[pick]
        if pick not in identified:
            pick_results[str(pick)] = {"status": "insufficient_recentered_identification", "rows": len(rows)}
            continue
        pick_scored = []
        fold_results = []
        for fold in range(FOLDS):
            training = [r for r in rows if r["fold"] != fold]
            held = [r for r in rows if r["fold"] == fold]
            fit = fit_by_cell[(pick, fold)]
            beta, gamma = second_stage(training, fit, outcomes)
            srows, unsupported_a = score_held(held, fit, beta, gamma, exp, pick)
            pick_scored.extend(srows)
            fold_results.append({
                "fold": fold,
                "heldout_rows": len(held),
                "eligible_scored": len(srows),
                "unsupported_a": unsupported_a,
                "supported_cards": len(fit["supported"]),
                "pool_features": len(fit["pool_features"]),
                "gamma_a_context": gamma,
            })
        scored.extend(pick_scored)
        rr = np.asarray([r["regret"] for r in pick_scored], dtype=np.float64)
        pick_results[str(pick)] = {
            "status": "analyzed",
            "display_pick": pick + 1,
            "raw_rows": len(rows),
            "eligible_scored": len(pick_scored),
            "coverage": len(pick_scored) / len(rows) if rows else None,
            "mean_regret": float(np.mean(rr)) if len(rr) else None,
            "median_regret": float(np.median(rr)) if len(rr) else None,
            "p90_regret": float(np.quantile(rr, 0.9)) if len(rr) else None,
            "share_regret_gt_0_02": float(np.mean(rr > PRACTICAL)) if len(rr) else None,
            "folds": fold_results,
        }

    allr = np.asarray([r["regret"] for r in scored], dtype=np.float64)
    report = {
        "phase": "a_regret_p1p2_p1p8_recentered_result",
        "issue": ISSUE,
        "expansion": exp,
        "status": "analyzed_secondary_recentered",
        "secondary_after_p1p1_outcome_open": True,
        "preflight": preflight,
        "identified_pick_numbers": sorted(identified),
        "failed_pick_numbers": sorted(set(PICKS) - identified),
        "eligible_decisions": len(scored),
        "overall_mean_regret": float(np.mean(allr)) if len(allr) else None,
        "overall_median_regret": float(np.median(allr)) if len(allr) else None,
        "overall_p90_regret": float(np.quantile(allr, 0.9)) if len(allr) else None,
        "overall_share_regret_gt_0_02": float(np.mean(allr > PRACTICAL)) if len(allr) else None,
        "picks": pick_results,
        "interpretation_boundary": [
            "Secondary extension: the same draft-level outcomes were previously opened for P1P1.",
            "Passed-pack instruments are recentered on the focal player's pre-pick pool via cross-fitted ridge projections.",
            "Candidate value includes a card fixed effect plus one frozen-A raw context-score slope; it is not an unrestricted optimal policy.",
            "No later-pick result can reverse the failed primary P1P1 optimal-enough gate.",
        ],
    }
    write_json(args.output_dir / "later-report.json", report)
    with gzip.open(args.output_dir / "later-regret-rows.jsonl.gz", "wt", encoding="utf-8") as f:
        for row in scored:
            f.write(json.dumps(row, sort_keys=True, separators=(",", ":")) + "\n")
    print(json.dumps({
        "expansion": exp,
        "status": report["status"],
        "identified_picks": report["identified_pick_numbers"],
        "failed_picks": report["failed_pick_numbers"],
        "eligible_decisions": report["eligible_decisions"],
        "mean_regret": report["overall_mean_regret"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
