#!/usr/bin/env python3
"""Post-assessment Q-vs-A influence/support audit for #529.

This is a diagnostic-only recomputation of the already-open locked assessment.
It MUST reproduce the retained locked Q-vs-A aggregate before emitting any
influence result. No model, feature, threshold, nuisance specification, or
assessment membership is selected or tuned here.
"""
from __future__ import annotations

import argparse
import json
import math
import pickle
import sys
from pathlib import Path
from statistics import NormalDist

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "research"))

import contextual_value_four_way_assessment as locked
import contextual_value_four_way_fresh as fresh
from contextual_value import PRIMARY_PACK, PRIMARY_PICK_START, PRIMARY_PICK_STOP
from contextual_value.archive import ArchiveSignalProvider
from contextual_value.dr import evaluate_policy
from contextual_value.features import model_feature_map, strong_choice_offsets
from contextual_value.nuisance import build_fold_training_rows

EXPECTED_ASSESSMENT_RUN = 36344151426
EXPECTED_ASSESSMENT_DIGEST = "sha256:9451d7a6dcb7134313410260eaf8d4a215fff0770d108f0e29f29e0ce721c832"
EXPECTED_REPORT_SHA256 = "cab250488d85e485a17b4cac4a03898740cebb4314a22f49bb3e1ad81d45ebd5"
CAPS = (10.0, 20.0, 50.0)
SEED = 529
BOOT = 10000
PARITY_TOL = 1e-12


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--draft-archive", action="append", type=Path, required=True)
    p.add_argument("--game-archive", action="append", type=Path, required=True)
    p.add_argument("--cohort-manifest", type=Path, required=True)
    p.add_argument("--archive-manifest", type=Path, required=True)
    p.add_argument("--freeze-json", type=Path, required=True)
    p.add_argument("--freeze-q-pickle", type=Path, required=True)
    p.add_argument("--locked-report", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    return p.parse_args()


def _bootstrap_ci(values, draws=BOOT):
    values = np.asarray(values, dtype=np.float64)
    rng = np.random.default_rng(SEED)
    out = np.empty(draws, dtype=np.float64)
    for b in range(draws):
        out[b] = float(np.mean(values[rng.integers(0, len(values), size=len(values))]))
    return [float(np.quantile(out, .025)), float(np.quantile(out, .975))]


def _dr_terms(observations, cap):
    vals = []
    unclipped = []
    for o in observations:
        direct = sum(float(o.target[a]) * float(o.q_values[a]) for a in o.target)
        ratio = float(o.target[o.action]) / float(o.behavior[o.action])
        unclipped.append(ratio)
        weight = min(float(cap), ratio)
        vals.append(direct + weight * (float(o.outcome) - float(o.q_values[o.action])))
    return np.asarray(vals, dtype=np.float64), np.asarray(unclipped, dtype=np.float64)


def _influence_summary(delta, labels, cap):
    delta = np.asarray(delta, dtype=np.float64)
    n = len(delta)
    mean = float(np.mean(delta))
    total = float(np.sum(delta))
    loo = (total - delta) / (n - 1)
    loo_change = loo - mean
    order = np.argsort(-np.abs(loo_change))

    def group(frac):
        k = max(1, int(math.ceil(frac * n)))
        idx = order[:k]
        keep = np.ones(n, dtype=bool)
        keep[idx] = False
        without = float(np.mean(delta[keep]))
        removed = mean - without
        return {
            "drafts": k,
            "fraction": frac,
            "effect_without_group": without,
            "effect_removed": removed,
            "fraction_of_original_effect_removed": None if abs(mean) < 1e-15 else float(removed / mean),
            "signed_delta_sum": float(np.sum(delta[idx])),
            "absolute_delta_sum": float(np.sum(np.abs(delta[idx]))),
            "share_of_total_absolute_delta": float(np.sum(np.abs(delta[idx])) / np.sum(np.abs(delta))),
            "draft_ids": [labels[int(i)]["draft_id"] for i in idx],
        }

    strongest = order[:10]
    return {
        "cap": int(cap),
        "n": n,
        "mean_delta": mean,
        "ci95": _bootstrap_ci(delta),
        "top_1pct_by_leave_one_out_influence": group(.01),
        "top_5pct_by_leave_one_out_influence": group(.05),
        "leave_one_out": {
            "min_delta": float(np.min(loo)),
            "max_delta": float(np.max(loo)),
            "max_abs_change": float(np.max(np.abs(loo_change))),
            "sign_flips_from_pooled_positive": int(np.sum(loo <= 0.0)) if mean > 0 else None,
            "top_10": [
                {
                    **labels[int(i)],
                    "draft_delta_term": float(delta[int(i)]),
                    "leave_one_out_delta": float(loo[int(i)]),
                    "change_from_pooled": float(loo_change[int(i)]),
                }
                for i in strongest
            ],
        },
    }


def _fixed_calibration_rows(probs, outcomes):
    edges = [0.0, .02, .05, .10, .20, .40, 1.0000001]
    rows = []
    probs = np.asarray(probs, dtype=float)
    outcomes = np.asarray(outcomes, dtype=float)
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (probs >= lo) & (probs < hi)
        if not np.any(mask):
            continue
        rows.append({
            "lo": lo,
            "hi": min(1.0, hi),
            "n": int(np.sum(mask)),
            "mean_predicted": float(np.mean(probs[mask])),
            "observed_selection_rate": float(np.mean(outcomes[mask])),
        })
    return rows


def _support_audit(primary, behavior_model):
    q_probs, a_probs, q_obs, a_obs, gates = [], [], [], [], []
    weight_rows = []
    by_set = {}
    for item in primary:
        d = item["decision"]
        if int(item["Q_leader"]) == int(item["A_leader"]):
            continue
        names = list(d.candidates)
        features = fresh._drop_strong_map(item["base_features"])
        behavior = behavior_model.probabilities(features, item.get("offsets"))
        q_action = names[int(item["Q_leader"])]
        a_action = names[int(item["A_leader"])]
        q_p, a_p = float(behavior[q_action]), float(behavior[a_action])
        gate = max(.01, .10 / len(names))
        q_hit = float(d.selected_card == q_action)
        a_hit = float(d.selected_card == a_action)
        q_probs.append(q_p); a_probs.append(a_p); q_obs.append(q_hit); a_obs.append(a_hit); gates.append(gate)
        weight_rows.append({
            "draft_id": str(d.draft_id),
            "expansion": str(d.expansion),
            "q_propensity": q_p,
            "a_propensity": a_p,
            "support_gate": gate,
            "q_selected": bool(q_hit),
            "a_selected": bool(a_hit),
            "q_inverse_if_selected": (1.0 / q_p) if q_hit else 0.0,
            "a_inverse_if_selected": (1.0 / a_p) if a_hit else 0.0,
        })
        s = by_set.setdefault(str(d.expansion), {"n": 0, "q_below": 0, "a_below": 0, "q_probs": [], "a_probs": []})
        s["n"] += 1; s["q_below"] += int(q_p < gate); s["a_below"] += int(a_p < gate); s["q_probs"].append(q_p); s["a_probs"].append(a_p)

    q_probs = np.asarray(q_probs); a_probs = np.asarray(a_probs); q_obs = np.asarray(q_obs); a_obs = np.asarray(a_obs); gates = np.asarray(gates)
    def stats(probs, obs):
        return {
            "mean_propensity": float(np.mean(probs)),
            "median_propensity": float(np.median(probs)),
            "p10_propensity": float(np.quantile(probs, .10)),
            "p05_propensity": float(np.quantile(probs, .05)),
            "below_support_gate_fraction": float(np.mean(probs < gates)),
            "observed_selection_rate": float(np.mean(obs)),
            "mean_predicted_selection_rate": float(np.mean(probs)),
            "calibration_gap_observed_minus_predicted": float(np.mean(obs) - np.mean(probs)),
            "brier": float(np.mean((obs - probs) ** 2)),
            "calibration_bins": _fixed_calibration_rows(probs, obs),
        }
    set_summary = {}
    for exp, s in sorted(by_set.items()):
        set_summary[exp] = {
            "n": s["n"],
            "q_below_support_fraction": s["q_below"] / s["n"],
            "a_below_support_fraction": s["a_below"] / s["n"],
            "q_mean_propensity": float(np.mean(s["q_probs"])),
            "a_mean_propensity": float(np.mean(s["a_probs"])),
        }
    return {
        "disagreement_drafts": len(weight_rows),
        "Q": stats(q_probs, q_obs),
        "A": stats(a_probs, a_obs),
        "by_set": set_summary,
        "largest_Q_inverse_weights_when_observed": sorted(weight_rows, key=lambda r: -r["q_inverse_if_selected"])[:20],
    }


def _set_and_leaveout(primary, qobs, aobs):
    labels = [{"draft_id": str(item["decision"].draft_id), "expansion": str(item["decision"].expansion)} for item in primary]
    q20, _ = _dr_terms(qobs, 20.0)
    a20, _ = _dr_terms(aobs, 20.0)
    delta = q20 - a20
    exps = sorted({x["expansion"] for x in labels})
    out = {"by_set": {}, "leave_one_set_out": {}}
    for exp in exps:
        mask = np.asarray([x["expansion"] == exp for x in labels], dtype=bool)
        vals = delta[mask]
        out["by_set"][exp] = {"n": int(np.sum(mask)), "dr_delta_cap20": float(np.mean(vals)), "ci95": _bootstrap_ci(vals)}
        vals2 = delta[~mask]
        out["leave_one_set_out"][exp] = {"n": int(np.sum(~mask)), "dr_delta_cap20": float(np.mean(vals2)), "ci95": _bootstrap_ci(vals2)}
    return out


def _power_plan(delta):
    delta = np.asarray(delta, dtype=float)
    sd = float(np.std(delta, ddof=1))
    z_alpha = NormalDist().inv_cdf(0.975)
    z_power = NormalDist().inv_cdf(0.80)
    def n_for(effect):
        return int(math.ceil(((z_alpha + z_power) * sd / effect) ** 2))
    return {
        "draft_level_delta_sd": sd,
        "observed_standard_error": float(sd / math.sqrt(len(delta))),
        "assumptions": "Independent primary draft units; two-sided alpha 0.05; 80% power; normal approximation; variance comparable to locked assessment.",
        "planned_n_for_true_delta_0_18": n_for(.18),
        "planned_n_for_true_delta_0_10": n_for(.10),
        "planned_n_for_true_delta_0_15": n_for(.15),
    }


def main():
    args = parse_args()
    locked_bytes = args.locked_report.read_bytes()
    import hashlib
    locked_sha = hashlib.sha256(locked_bytes).hexdigest()
    if locked_sha != EXPECTED_REPORT_SHA256:
        raise SystemExit(f"locked report SHA mismatch {locked_sha}")
    locked_report = json.loads(locked_bytes.decode("utf-8"))
    if locked_report.get("phase") != "four_way_locked_assessment" or locked_report.get("assessment_opened") is not True:
        raise SystemExit("invalid retained locked assessment report")
    freeze = json.loads(args.freeze_json.read_text(encoding="utf-8"))
    if freeze.get("fingerprint_sha256") != locked.EXPECTED_BUNDLE_FINGERPRINT:
        raise SystemExit("frozen Q bundle fingerprint mismatch")
    with args.freeze_q_pickle.open("rb") as handle:
        q_model = pickle.load(handle)

    original_archives = json.loads(args.archive_manifest.read_text(encoding="utf-8"))
    archive_verification = locked._verify_archives([*args.draft_archive, *args.game_archive], original_archives)
    cohort, dev_ids, assess_ids, all_decisions, games, development, assessment = locked._load_exact(args)
    provider = ArchiveSignalProvider(all_decisions, games)
    metadata, metadata_report = locked._metadata_by_expansion([*development, *assessment])

    # Same development-only behavior nuisance as the locked assessment.
    dev_rows = build_fold_training_rows(development, dev_ids, signal_provider=provider, inner_feature_folds=fresh.INNER_FEATURE_FOLDS)
    strong_behavior, strong_fit = fresh._fit_propensity(dev_rows, True)

    assess_scored = []
    for d in assessment:
        if int(d.pack_number) != PRIMARY_PACK or not (PRIMARY_PICK_START <= int(d.pick_number) < PRIMARY_PICK_STOP):
            continue
        signals = provider(d, dev_ids)
        features = model_feature_map(d, signals)
        state, scores, qsimple = fresh._score_decision(d, features, metadata[d.expansion], freeze, q_model)
        assess_scored.append({"decision": d, "base_features": features, "offsets": strong_choice_offsets(signals, d.candidates), "state": state, "scores": scores, "qsimple": qsimple})

    _records, details = fresh._build_records(assess_scored, freeze, "assessment-diagnostic-rerun")
    primary = fresh._primary_ope_details(details)
    qobs = fresh._ope_observations(primary, "Q", strong_behavior, True)
    aobs = fresh._ope_observations(primary, "A", strong_behavior, True)

    # Exact aggregate parity is mandatory before diagnostics are accepted.
    parity = {}
    for cap in CAPS:
        qe = evaluate_policy(qobs, cap)
        ae = evaluate_policy(aobs, cap)
        delta = float(qe.dr - ae.dr)
        expected = float(locked_report["gates"]["Q"]["dr_deltas_by_cap"][str(int(cap))])
        err = abs(delta - expected)
        parity[str(int(cap))] = {"recomputed": delta, "locked": expected, "abs_error": err}
        if err > PARITY_TOL:
            raise SystemExit(f"Q-A aggregate parity failure cap={cap} error={err}")
    expected_n = int(locked_report["cohort"]["assessment_primary_drafts"])
    if len(primary) != expected_n:
        raise SystemExit(f"primary assessment draft count mismatch {len(primary)} != {expected_n}")

    labels = [{"draft_id": str(item["decision"].draft_id), "expansion": str(item["decision"].expansion)} for item in primary]
    influence = {}
    cap_deltas = {}
    weight_diag = {}
    for cap in CAPS:
        qt, qw = _dr_terms(qobs, cap)
        at, aw = _dr_terms(aobs, cap)
        d = qt - at
        cap_deltas[str(int(cap))] = d
        influence[str(int(cap))] = _influence_summary(d, labels, cap)
        weight_diag[str(int(cap))] = {
            "Q_fraction_unclipped_weight_above_cap": float(np.mean(qw > cap)),
            "A_fraction_unclipped_weight_above_cap": float(np.mean(aw > cap)),
            "Q_max_unclipped_weight": float(np.max(qw)),
            "A_max_unclipped_weight": float(np.max(aw)),
        }

    support = _support_audit(primary, strong_behavior)
    sets = _set_and_leaveout(primary, qobs, aobs)
    power = _power_plan(cap_deltas["20"])

    report = {
        "phase": "q_vs_a_post_assessment_influence_audit",
        "scope": "diagnostic_only_no_tuning",
        "source_assessment_run": EXPECTED_ASSESSMENT_RUN,
        "source_assessment_digest": EXPECTED_ASSESSMENT_DIGEST,
        "assessment_opened_previously": True,
        "assessment_recomputed_for_diagnostics": True,
        "assessment_outcomes_used_for_fit": False,
        "model_tuning_authorized": False,
        "model_selection_authorized": False,
        "primary_comparison": "Q_vs_A_only",
        "frozen_score_fingerprint": freeze["fingerprint_sha256"],
        "cohort": {"selected_drafts": len(cohort["selected_drafts"]), "assessment_drafts": len(assess_ids), "primary_drafts": len(primary)},
        "archive_verification": archive_verification,
        "metadata": metadata_report,
        "behavior_nuisance": strong_fit,
        "locked_aggregate_parity": parity,
        "influence_by_cap": influence,
        "weight_diagnostics_by_cap": weight_diag,
        "q_a_disagreement_support_and_calibration": support,
        "set_robustness": sets,
        "power_planning_from_locked_cap20_draft_variance": power,
        "interpretation_boundary": "Diagnostics may determine whether a new frozen Q-vs-A confirmation is scientifically worthwhile and how large it should be. They may not change Q, A, the nuisance specification, weight caps, support gate, or reinterpret the locked assessment as a pass.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "parity": parity,
        "cap20": influence["20"],
        "support": {"disagreement_drafts": support["disagreement_drafts"], "Q": support["Q"], "A": support["A"]},
        "set_robustness": sets,
        "power": power,
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()