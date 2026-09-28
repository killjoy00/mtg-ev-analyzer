#!/usr/bin/env python3
"""Evaluate frozen A, Q, and Guard-10 on one 5k confirmation environment.

No confirmation outcome is used for fitting. The behavior nuisance and leakage-
safe aggregate signals are reconstructed only from the prior fresh train IDs.
"""
from __future__ import annotations

import argparse
import json
import math
import pickle
import sys
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "research"))

from contextual_value import PRIMARY_PACK, PRIMARY_PICK_START, PRIMARY_PICK_STOP
from contextual_value.archive import ArchiveSignalProvider, GameStore, load_decisions
from contextual_value.diagnostics import paired_dr_delta_ci
from contextual_value.dr import PolicyObservation, evaluate_policy
from contextual_value.features import model_feature_map, strong_choice_offsets
from contextual_value.nuisance import build_fold_training_rows
from contextual_value_phase_a_features import _fetch_rich_set
import contextual_value_four_way_fresh as fresh

EXPECTED_FINGERPRINT = "d1f3cb78d1674b1424805b33637c89d3f3977baa890db61ff534fa7700cb5f33"
CAPS = (10.0, 20.0, 50.0)
GUARD_THRESHOLD = 0.10
BOOT = 10000
SEED = 529
MIN_METADATA_COVERAGE = 0.98


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--expansion", required=True)
    p.add_argument("--draft-archive", type=Path, required=True)
    p.add_argument("--game-archive", type=Path, required=True)
    p.add_argument("--expected-draft-sha256", required=True)
    p.add_argument("--expected-game-sha256", required=True)
    p.add_argument("--cohort-manifest", type=Path, required=True)
    p.add_argument("--freeze-json", type=Path, required=True)
    p.add_argument("--freeze-q-pickle", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    return p.parse_args()


def _support_floor(candidate_count):
    return max(0.05, 0.01, 0.10 / max(1, int(candidate_count)))


def _metadata(expansion, decisions):
    wanted = set()
    for d in decisions:
        if int(d.pack_number) != PRIMARY_PACK or not (PRIMARY_PICK_START <= int(d.pick_number) < PRIMARY_PICK_STOP):
            continue
        wanted.update(d.candidates)
        wanted.update(name for name, _ in d.pool)
    resolved, unresolved = _fetch_rich_set(expansion, wanted)
    coverage = len(resolved) / max(1, len(wanted))
    if coverage < MIN_METADATA_COVERAGE:
        raise SystemExit(f"metadata coverage {coverage:.2%} below threshold")
    return resolved, unresolved, coverage


def _observation(item, leader, behavior):
    d = item["decision"]
    names = list(d.candidates)
    return PolicyObservation(
        action=d.selected_card,
        outcome=float(d.event_match_wins),
        behavior=behavior,
        target={a: 1.0 if i == leader else 0.0 for i, a in enumerate(names)},
        q_values={a: float(item["qsimple"][i]) for i, a in enumerate(names)},
        cluster=str(d.draft_id),
    )


def _dr_terms(observations, cap):
    vals = []
    for o in observations:
        direct = sum(float(o.target[a]) * float(o.q_values[a]) for a in o.target)
        ratio = float(o.target[o.action]) / float(o.behavior[o.action])
        weight = min(float(cap), ratio)
        vals.append(direct + weight * (float(o.outcome) - float(o.q_values[o.action])))
    return np.asarray(vals, dtype=np.float64)


def _sufficient(observations, cap):
    direct_sum = 0.0
    weighted_outcome_sum = 0.0
    dr_sum = 0.0
    weight_sum = 0.0
    weight_sq_sum = 0.0
    clipped = 0
    max_unclipped = 0.0
    for o in observations:
        direct = sum(float(o.target[a]) * float(o.q_values[a]) for a in o.target)
        ratio = float(o.target[o.action]) / float(o.behavior[o.action])
        max_unclipped = max(max_unclipped, ratio)
        weight = min(float(cap), ratio)
        clipped += int(ratio > float(cap))
        outcome = float(o.outcome)
        residual = outcome - float(o.q_values[o.action])
        direct_sum += direct
        weighted_outcome_sum += weight * outcome
        dr_sum += direct + weight * residual
        weight_sum += weight
        weight_sq_sum += weight * weight
    return {
        "n": len(observations),
        "direct_sum": direct_sum,
        "weighted_outcome_sum": weighted_outcome_sum,
        "dr_sum": dr_sum,
        "weight_sum": weight_sum,
        "weight_sq_sum": weight_sq_sum,
        "clipped_count": clipped,
        "max_unclipped_weight": max_unclipped,
    }


def _bootstrap(delta, alpha):
    delta = np.asarray(delta, dtype=np.float64)
    n = len(delta)
    rng = np.random.default_rng(SEED)
    vals = np.empty(BOOT, dtype=np.float64)
    for b in range(BOOT):
        idx = rng.integers(0, n, size=n)
        vals[b] = float(np.mean(delta[idx]))
    return [
        float(np.quantile(vals, alpha / 2.0)),
        float(np.quantile(vals, 1.0 - alpha / 2.0)),
    ]


def main():
    args = parse_args()

    draft_sha = fresh.sha256(args.draft_archive)
    game_sha = fresh.sha256(args.game_archive)
    if draft_sha != args.expected_draft_sha256:
        raise SystemExit(f"draft archive hash mismatch: {draft_sha} != {args.expected_draft_sha256}")
    if game_sha != args.expected_game_sha256:
        raise SystemExit(f"game archive hash mismatch: {game_sha} != {args.expected_game_sha256}")

    cohort = json.loads(args.cohort_manifest.read_text(encoding="utf-8"))
    if cohort.get("expansion") != args.expansion:
        raise SystemExit("cohort expansion mismatch")
    if cohort.get("draft_sha256") != draft_sha:
        raise SystemExit("cohort/archive identity mismatch")

    prior_ids = frozenset(str(x) for x in cohort["prior_8000_ids"])
    train_ids = frozenset(str(x) for x in cohort["prior_train_ids"])
    confirm_ids = frozenset(str(x) for x in cohort["confirmation_ids"])
    if len(prior_ids) != 8000 or len(confirm_ids) != 5000 or prior_ids & confirm_ids:
        raise SystemExit("invalid prior/confirmation cohort boundary")
    if not train_ids or not train_ids.issubset(prior_ids):
        raise SystemExit("invalid prior train IDs")

    freeze = json.loads(args.freeze_json.read_text(encoding="utf-8"))
    if freeze.get("assessment_opened") is not False or freeze.get("assessment_outcomes_used") is not False:
        raise SystemExit("invalid frozen bundle boundary")
    if freeze.get("fingerprint_sha256") != EXPECTED_FINGERPRINT:
        raise SystemExit("frozen bundle fingerprint mismatch")
    if freeze.get("parity", {}).get("passed") is not True:
        raise SystemExit("frozen bundle parity not passed")
    with args.freeze_q_pickle.open("rb") as handle:
        q_model = pickle.load(handle)

    keep_ids = train_ids | confirm_ids
    decisions = load_decisions(args.draft_archive, keep_ids=keep_ids)
    observed = {str(d.draft_id) for d in decisions}
    if observed != keep_ids:
        raise SystemExit(
            f"draft load mismatch missing={len(keep_ids-observed)} extra={len(observed-keep_ids)}"
        )
    train = [d for d in decisions if str(d.draft_id) in train_ids]
    confirm = [d for d in decisions if str(d.draft_id) in confirm_ids]
    if {str(d.draft_id) for d in confirm} != confirm_ids:
        raise SystemExit("confirmation load incomplete")

    games = GameStore.from_archives([args.game_archive], train_ids)
    provider = ArchiveSignalProvider(decisions, games)
    metadata, unresolved, coverage = _metadata(args.expansion, [*train, *confirm])

    # Only prior fresh training drafts enter the behavior nuisance.
    train_rows = build_fold_training_rows(
        train,
        train_ids,
        signal_provider=provider,
        inner_feature_folds=fresh.INNER_FEATURE_FOLDS,
    )
    strong_behavior, strong_fit = fresh._fit_propensity(train_rows, True)

    scored = []
    for d in confirm:
        if int(d.pack_number) != PRIMARY_PACK or not (PRIMARY_PICK_START <= int(d.pick_number) < PRIMARY_PICK_STOP):
            continue
        signals = provider(d, train_ids)
        features = model_feature_map(d, signals)
        state, scores, qsimple = fresh._score_decision(d, features, metadata, freeze, q_model)
        scored.append({
            "decision": d,
            "base_features": features,
            "offsets": strong_choice_offsets(signals, d.candidates),
            "state": state,
            "scores": scores,
            "qsimple": qsimple,
        })

    primary = fresh._primary_ope_details(scored)
    if len(primary) != 5000:
        raise SystemExit(f"expected 5000 primary confirmation drafts, got {len(primary)}")
    if {str(x["decision"].draft_id) for x in primary} != confirm_ids:
        raise SystemExit("primary confirmation IDs do not exactly match frozen cohort")

    obs = {"A": [], "Q": [], "guard_010": []}
    leader_propensity = defaultdict(list)
    override_count = 0
    q_disagreement_count = 0
    guard_q_count = 0

    for item in primary:
        d = item["decision"]
        names = list(d.candidates)
        features = fresh._drop_strong_map(item["base_features"])
        behavior = strong_behavior.probabilities(features, item["offsets"])

        alead = fresh._argmax(item["scores"]["A"], names)
        qlead = fresh._argmax(item["scores"]["Q"], names)
        q_disagreement_count += int(qlead != alead)

        qadv = float(item["scores"]["Q"][qlead] - item["scores"]["Q"][alead])
        floor = _support_floor(len(names))
        use_q = (
            qlead != alead
            and qadv >= GUARD_THRESHOLD
            and float(behavior[names[qlead]]) >= floor
        )
        glead = qlead if use_q else alead
        override_count += int(glead != alead)
        guard_q_count += int(glead == qlead and qlead != alead)

        leaders = {"A": alead, "Q": qlead, "guard_010": glead}
        for label, leader in leaders.items():
            obs[label].append(_observation(item, leader, behavior))
            leader_propensity[label].append(float(behavior[names[leader]]))

    estimates = {}
    for label in obs:
        estimates[label] = {}
        for cap in CAPS:
            estimates[label][str(int(cap))] = {
                "estimate": asdict(evaluate_policy(obs[label], cap)),
                "sufficient": _sufficient(obs[label], cap),
            }

    comparisons = {}
    raw_terms = {}
    for label in ("Q", "guard_010"):
        comparisons[label] = {}
        raw_terms[label] = {}
        for cap in CAPS:
            p = estimates[label][str(int(cap))]["estimate"]
            a = estimates["A"][str(int(cap))]["estimate"]
            delta = _dr_terms(obs[label], cap) - _dr_terms(obs["A"], cap)
            raw_terms[label][str(int(cap))] = [float(x) for x in delta]
            comparisons[label][str(int(cap))] = {
                "dr": float(p["dr"] - a["dr"]),
                "direct": float(p["direct"] - a["direct"]),
                "snips": float(p["snips"] - a["snips"]),
                "ipw": float(p["ipw"] - a["ipw"]),
                "dr_ci95": _bootstrap(delta, 0.05),
                "dr_ci97_5": _bootstrap(delta, 0.025),
            }

    gq_delta = _dr_terms(obs["guard_010"], 20.0) - _dr_terms(obs["Q"], 20.0)
    pairwise = {
        "guard_010_minus_Q_cap20": {
            "dr": float(np.mean(gq_delta)),
            "dr_ci95": _bootstrap(gq_delta, 0.05),
            "terms": [float(x) for x in gq_delta],
        }
    }

    report = {
        "phase": "q_guard10_20k_confirmation_environment",
        "scope": "frozen_unused_confirmation",
        "expansion": args.expansion,
        "confirmation_outcomes_used_for_fit": False,
        "confirmation_outcomes_used_for_scoring": True,
        "frozen_score_fingerprint": freeze["fingerprint_sha256"],
        "guard_010": {
            "threshold": GUARD_THRESHOLD,
            "support_floor": "max(0.05,0.01,0.10/candidate_count)",
        },
        "archive_snapshot": {
            "draft_sha256": draft_sha,
            "game_sha256": game_sha,
        },
        "cohort": {
            "prior_8000": len(prior_ids),
            "prior_train": len(train_ids),
            "confirmation": len(confirm_ids),
            "overlap": len(prior_ids & confirm_ids),
            "confirmation_ids": sorted(confirm_ids),
        },
        "metadata": {
            "coverage": coverage,
            "unresolved_count": len(unresolved),
            "unresolved": unresolved,
        },
        "behavior_nuisance": strong_fit,
        "policy_behavior": {
            "q_disagreement_rate_vs_A": q_disagreement_count / len(primary),
            "guard_override_rate_vs_A": override_count / len(primary),
            "guard_q_override_count": guard_q_count,
            "leader_propensity": {
                label: {
                    "mean": float(np.mean(vals)),
                    "min": float(np.min(vals)),
                    "p05": float(np.quantile(vals, 0.05)),
                    "below_0_05_fraction": float(np.mean(np.asarray(vals) < 0.05)),
                }
                for label, vals in leader_propensity.items()
            },
        },
        "estimates": estimates,
        "comparisons_vs_A": comparisons,
        "paired": pairwise,
        "raw_dr_delta_terms": raw_terms,
        "boundary": "Frozen Q/A/Guard-10 only. New confirmation outcomes are scored once and never used for fitting or tuning.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "expansion": args.expansion,
        "confirmation": len(confirm_ids),
        "q_cap20": comparisons["Q"]["20"]["dr"],
        "guard_cap20": comparisons["guard_010"]["20"]["dr"],
        "guard_override_rate": report["policy_behavior"]["guard_override_rate_vs_A"],
        "outcomes_used_for_fit": False,
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
