#!/usr/bin/env python3
"""Synthetic-only null calibration for the frozen #756 P1P1 regret estimator.

Never calls the frozen real-outcome reader. All estimator primitives are imported
from the recovered frozen #756 source.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.stats import norm

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

SCENARIOS = (
    ("null", 0.0, None),
    ("a_opt_tau_0_10", 0.10, None),
    ("a_opt_tau_0_20", 0.20, None),
    ("a_opt_tau_0_10_card_noise_0_05", 0.10, 0.05),
    ("a_opt_tau_0_10_card_noise_0_10", 0.10, 0.10),
    ("a_opt_tau_0_10_card_noise_0_20", 0.10, 0.20),
)
REPLICATES = 20
NOISE_SD = 2.18
POWER_SPLIT_SALT = "a-regret-null-power-v1:"


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--expansion", required=True)
    p.add_argument("--draft-archive", type=Path, required=True)
    p.add_argument("--game-archive", type=Path, required=True)
    p.add_argument("--spent-ledger", type=Path, required=True)
    p.add_argument("--reserve-json", type=Path, required=True)
    p.add_argument("--original-regret-rows", type=Path, required=True)
    p.add_argument("--output-dir", type=Path, required=True)
    return p.parse_args()


def load_frozen():
    path = ROOT / "research" / "null_calibration_756" / "frozen_a_regret_p1p1.py"
    spec = importlib.util.spec_from_file_location("frozen_a_regret_p1p1_756", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)

    def forbidden(*_args, **_kwargs):
        raise RuntimeError("REAL OUTCOME READER FORBIDDEN IN #756 NULL CALIBRATION")

    mod.read_new_outcomes = forbidden
    return mod


def seed_for(expansion: str, scenario: str, rep: int, component: str) -> int:
    msg = f"756-null-calibration-v1:{expansion}:{scenario}:{rep}:{component}".encode()
    return int.from_bytes(hashlib.sha256(msg).digest()[:8], "big", signed=False)


def half_of(draft_id: str) -> int:
    d = hashlib.sha256(f"{POWER_SPLIT_SALT}{draft_id}".encode()).digest()
    return d[0] & 1


def margin_slice(x: float) -> str:
    if x <= 0.02:
        return "le_0_02"
    if x <= 0.05:
        return "0_02_0_05"
    if x <= 0.10:
        return "0_05_0_10"
    return "gt_0_10"


def build_rank_values(mod, draft_archive, game_archive, expansion, train_ids, contexts):
    # Recreate the exact frozen-A object solely to obtain the global P1P1 card
    # ordering used to define the synthetic truth. The estimator's A fields were
    # already populated by frozen build_a_scores().
    train = mod.load_decisions(draft_archive, keep_ids=train_ids)
    games = mod.GameStore.from_archive(game_archive, train_ids)
    provider = mod.ArchiveSignalProvider(train, games)
    artifacts = provider.artifacts(train_ids, expansion)
    model = artifacts.strong_model
    if model is None:
        raise SystemExit(f"{expansion}: no frozen strong model for synthetic truth")
    cards = sorted({c for r in contexts for c in r["candidates"]})
    raw = {c: float(model.card_tendency(c, 0, 0, {})) for c in cards}
    # Best-to-worst exactly follows A's deterministic P1P1 ranking:
    # descending tendency, card name ascending.
    best_to_worst = sorted(cards, key=lambda c: (-max(0.0, raw[c]), c))
    n = len(best_to_worst)
    z = {}
    for best_pos, card in enumerate(best_to_worst):
        r_worst_to_best = n - best_pos
        p = (r_worst_to_best - 0.375) / (n + 0.25)
        z[card] = float(norm.ppf(p))
    # Assert synthetic ranking agrees with A on every real pack.
    mismatches = 0
    for row in contexts:
        best = min(row["candidates"], key=lambda c: (-z[c], c))
        if best != row["a_card"]:
            mismatches += 1
    if mismatches:
        raise SystemExit(f"{expansion}: normal-score truth does not preserve A ranking n={mismatches}")
    return z


def make_values(expansion: str, scenario: str, rep: int, tau: float, card_sd, z):
    if scenario == "null":
        return {c: 0.0 for c in z}
    v = {c: tau * zc for c, zc in z.items()}
    if card_sd is not None:
        rng = np.random.default_rng(seed_for(expansion, scenario, rep, "card_noise"))
        cards = sorted(v)
        eta = rng.normal(0.0, card_sd, size=len(cards))
        for c, e in zip(cards, eta):
            v[c] += float(e)
    return v


def make_outcomes(expansion, scenario, rep, contexts, values):
    rng = np.random.default_rng(seed_for(expansion, scenario, rep, "draft_noise"))
    eps = rng.normal(0.0, NOISE_SD, size=len(contexts))
    return {
        row["draft_id"]: float(values[row["historical_pick"]] + e)
        for row, e in zip(contexts, eps)
    }


def precompute_folds(mod, contexts):
    by_fold = {}
    fs_by_fold = {}
    rates_by_fold = {}
    gates = {}
    for fold in range(mod.FOLDS):
        training = [r for r in contexts if r["fold"] != fold]
        held = [r for r in contexts if r["fold"] == fold]
        supported, appearances, takes = mod.support_for(training)
        fs = mod.first_stage(training, supported)
        by_fold[fold] = (training, held)
        fs_by_fold[fold] = fs
        rates_by_fold[fold] = (appearances, takes)
        gates[fold] = fs["diagnostics"]
        if not fs["diagnostics"]["gate"]:
            raise SystemExit(f"frozen P1P1 identification gate failed fold={fold}")
    return by_fold, fs_by_fold, rates_by_fold, gates


def score_replicate(mod, expansion, scenario, rep, contexts, values, outcomes, by_fold, fs_by_fold, save_rows=False):
    total_regret = 0.0
    total_true = 0.0
    n = 0
    disagree = 0
    slice_sum = defaultdict(float)
    slice_n = defaultdict(int)
    saved = []

    for fold in range(mod.FOLDS):
        training, held = by_fold[fold]
        fs = fs_by_fold[fold]
        _intercept, beta = mod.second_stage(training, fs, outcomes)
        supported = set(fs["cards"])
        for row in held:
            a = row["a_card"]
            if a not in supported:
                continue
            offered = [c for c in row["candidates"] if c in supported]
            if not offered:
                continue
            best = min(offered, key=lambda c: (-beta[c], c))
            regret = max(0.0, float(beta[best] - beta[a]))
            true_best = min(offered, key=lambda c: (-values[c], c))
            true_regret = max(0.0, float(values[true_best] - values[a]))
            total_regret += regret
            total_true += true_regret
            n += 1
            disagree += int(best != a)
            sl = margin_slice(float(row["a_margin"]))
            slice_sum[sl] += regret
            slice_n[sl] += 1
            if save_rows:
                saved.append(regret)

    return {
        "scenario": scenario,
        "replicate": rep,
        "sum_regret": total_regret,
        "sum_true_regret": total_true,
        "eligible_n": n,
        "disagree_n": disagree,
        "slice_sum": dict(slice_sum),
        "slice_n": dict(slice_n),
    }, np.asarray(saved, dtype=np.float32)


def precompute_power_halves(mod, contexts):
    halves = {
        0: [r for r in contexts if half_of(r["draft_id"]) == 0],
        1: [r for r in contexts if half_of(r["draft_id"]) == 1],
    }
    fs = {}
    diag = {}
    for h in (0, 1):
        supported, _appear, _takes = mod.support_for(halves[h])
        fs[h] = mod.first_stage(halves[h], supported)
        diag[h] = fs[h]["diagnostics"]
    return halves, fs, diag


def power_replicate(mod, values, outcomes, halves, half_fs):
    betas = {}
    for h in (0, 1):
        _intercept, betas[h] = mod.second_stage(halves[h], half_fs[h], outcomes)

    est_sum = 0.0
    true_sum = 0.0
    n = 0
    for select_h, eval_h in ((0, 1), (1, 0)):
        sel_beta = betas[select_h]
        eval_beta = betas[eval_h]
        common = set(sel_beta).intersection(eval_beta)
        for row in halves[eval_h]:
            a = row["a_card"]
            if a not in common:
                continue
            offered = [c for c in row["candidates"] if c in common]
            if not offered:
                continue
            b = min(offered, key=lambda c: (-sel_beta[c], c))
            est_sum += float(eval_beta[b] - eval_beta[a])
            true_sum += float(values[b] - values[a])
            n += 1
    return {"estimate_sum": est_sum, "true_gain_sum": true_sum, "eligible_n": n}


def take_rate_diagnostic(original_rows_path: Path, rates_by_fold):
    n = 0
    sum_best = 0.0
    sum_a = 0.0
    sum_diff = 0.0
    best_lower = 0
    missing = 0
    with gzip.open(original_rows_path, "rt", encoding="utf-8") as f:
        for line in f:
            row = json.loads(line)
            if not row.get("a_iv_disagree"):
                continue
            fold = int(row["fold"])
            appearances, takes = rates_by_fold[fold]
            a = row["a_card"]
            b = row["iv_best_card"]
            if appearances[a] <= 0 or appearances[b] <= 0:
                missing += 1
                continue
            ra = takes[a] / appearances[a]
            rb = takes[b] / appearances[b]
            n += 1
            sum_best += rb
            sum_a += ra
            sum_diff += rb - ra
            best_lower += int(rb < ra)
    return {
        "n": n,
        "missing": missing,
        "sum_iv_best_take_rate": sum_best,
        "sum_a_take_rate": sum_a,
        "sum_paired_difference": sum_diff,
        "iv_best_lower_n": best_lower,
    }


def main():
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    mod = load_frozen()
    exp = args.expansion

    if mod.sha256(args.draft_archive) != mod.EXPECTED_DRAFT[exp]:
        raise SystemExit(f"{exp}: draft hash mismatch")
    if mod.sha256(args.game_archive) != mod.EXPECTED_GAME[exp]:
        raise SystemExit(f"{exp}: game hash mismatch")

    excluded, train_ids, _ledger_rows, _train_source = mod.load_prior(
        args.spent_ledger, args.reserve_json, exp
    )
    contexts, invalid = mod.read_contexts_no_outcomes(args.draft_archive, exp, excluded)
    if len(contexts) != mod.EXPECTED_UNUSED[exp]:
        raise SystemExit(f"{exp}: frozen cohort mismatch {len(contexts)} != {mod.EXPECTED_UNUSED[exp]}; invalid={invalid}")

    a_meta = mod.build_a_scores(args.draft_archive, args.game_archive, exp, train_ids, contexts)
    z = build_rank_values(mod, args.draft_archive, args.game_archive, exp, train_ids, contexts)
    by_fold, fs_by_fold, rates_by_fold, fold_gates = precompute_folds(mod, contexts)
    halves, half_fs, half_diag = precompute_power_halves(mod, contexts)

    take_rate = take_rate_diagnostic(args.original_regret_rows, rates_by_fold)

    replicate_rows = []
    power_rows = []
    replicate0_arrays = {}

    for scenario, tau, card_sd in SCENARIOS:
        for rep in range(REPLICATES):
            values = make_values(exp, scenario, rep, tau, card_sd, z)
            outcomes = make_outcomes(exp, scenario, rep, contexts, values)
            summary, saved = score_replicate(
                mod, exp, scenario, rep, contexts, values, outcomes,
                by_fold, fs_by_fold, save_rows=(rep == 0)
            )
            replicate_rows.append(summary)
            if rep == 0:
                replicate0_arrays[scenario] = saved
            pr = power_replicate(mod, values, outcomes, halves, half_fs)
            pr.update({"scenario": scenario, "replicate": rep})
            power_rows.append(pr)

            if scenario in {"null", "a_opt_tau_0_10", "a_opt_tau_0_20"}:
                if abs(summary["sum_true_regret"]) > 1e-9:
                    raise SystemExit(
                        f"{exp} {scenario} rep={rep}: A should be exactly optimal but true regret sum={summary['sum_true_regret']}"
                    )

    out = {
        "phase": "a_regret_p1p1_null_calibration_set",
        "issue": 756,
        "expansion": exp,
        "synthetic_only": True,
        "real_outcome_reader_called": False,
        "replicates_per_scenario": REPLICATES,
        "noise_sd": NOISE_SD,
        "cohort_n": len(contexts),
        "a": a_meta,
        "fold_gates": fold_gates,
        "power_half_diagnostics": half_diag,
        "take_rate_diagnostic": take_rate,
        "replicates": replicate_rows,
        "power_replicates": power_rows,
    }
    (args.output_dir / "p1-null-set.json").write_text(json.dumps(out, indent=2, sort_keys=True) + "\n")
    np.savez_compressed(args.output_dir / "replicate0-regrets.npz", **replicate0_arrays)
    print(json.dumps({
        "expansion": exp,
        "cohort_n": len(contexts),
        "replicate_rows": len(replicate_rows),
        "power_rows": len(power_rows),
        "take_rate_n": take_rate["n"],
        "real_outcome_reader_called": False,
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
