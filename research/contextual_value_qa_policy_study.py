#!/usr/bin/env python3
"""Bounded Q+A policy study on fresh validation environments for #529.

This is exploratory post-assessment policy design. The spent locked assessment
is never loaded. Frozen Q and A are combined only through the predeclared policy
family in CONTEXTUAL-VALUE-V1-QA-POLICY-STUDY.md.
"""
from __future__ import annotations

import argparse
import json
import math
import pickle
import sys
from dataclasses import asdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "research"))

from contextual_value import PRIMARY_PACK, PRIMARY_PICK_START, PRIMARY_PICK_STOP
from contextual_value.archive import ArchiveSignalProvider
from contextual_value.diagnostics import paired_dr_delta_ci
from contextual_value.dr import PolicyObservation, evaluate_policy
from contextual_value.features import model_feature_map, strong_choice_offsets
from contextual_value.nuisance import build_fold_training_rows
import contextual_value_four_way_fresh as fresh

EXPECTED_FINGERPRINT = "d1f3cb78d1674b1424805b33637c89d3f3977baa890db61ff534fa7700cb5f33"
GUARD_THRESHOLDS = (0.05, 0.10, 0.20)
BLEND_LAMBDAS = (0.25, 0.50, 0.75)
CAPS = (10.0, 20.0, 50.0)


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


def _z(values):
    x = np.asarray(values, dtype=float)
    sd = float(np.std(x))
    if not math.isfinite(sd) or sd <= 1e-12:
        return np.zeros_like(x)
    return (x - float(np.mean(x))) / sd


def _support_floor(candidate_count):
    return max(0.05, 0.01, 0.10 / max(1, int(candidate_count)))


def _observation(item, leader, behavior):
    d = item["decision"]
    names = list(d.candidates)
    return PolicyObservation(
        action=d.selected_card,
        outcome=float(d.event_match_wins),
        behavior=behavior,
        target={a: 1.0 if i == leader else 0.0 for i, a in enumerate(names)},
        q_values={a: float(item["qsimple"][i]) for i, a in enumerate(names)},
        cluster=d.draft_id,
    )


def _dr_terms(obs, cap):
    vals = []
    for o in obs:
        direct = sum(float(o.target[a]) * float(o.q_values[a]) for a in o.target)
        ratio = float(o.target[o.action]) / float(o.behavior[o.action])
        vals.append(direct + min(float(cap), ratio) * (float(o.outcome) - float(o.q_values[o.action])))
    return np.asarray(vals, dtype=float)


def _weight_sums(obs, cap):
    weights = []
    weighted_outcomes = []
    for o in obs:
        ratio = float(o.target[o.action]) / float(o.behavior[o.action])
        w = min(float(cap), ratio)
        weights.append(w)
        weighted_outcomes.append(w * float(o.outcome))
    return {
        "weight_sum": float(np.sum(weights)),
        "weight_sq_sum": float(np.sum(np.square(weights))),
        "weighted_outcome_sum": float(np.sum(weighted_outcomes)),
    }


def _summarize(obs, aobs, leader_props, intervention_rate):
    out = {
        "n": len(obs),
        "intervention_rate_vs_A": float(intervention_rate),
        "leader_propensity": {
            "mean": float(np.mean(leader_props)),
            "min": float(np.min(leader_props)),
            "p05": float(np.quantile(leader_props, 0.05)),
            "below_0_05_fraction": float(np.mean(np.asarray(leader_props) < 0.05)),
        },
        "caps": {},
    }
    for cap in CAPS:
        est = evaluate_policy(obs, cap)
        aest = evaluate_policy(aobs, cap)
        d = _dr_terms(obs, cap) - _dr_terms(aobs, cap)
        out["caps"][str(int(cap))] = {
            "estimate": asdict(est),
            "A_estimate": asdict(aest),
            "minus_A": {
                "dr": float(est.dr - aest.dr),
                "direct": float(est.direct - aest.direct),
                "snips": float(est.snips - aest.snips),
                "ipw": float(est.ipw - aest.ipw),
                "dr_ci95": [float(x) for x in paired_dr_delta_ci(obs, aobs, weight_cap=cap)],
            },
            "sufficient": {
                "policy": _weight_sums(obs, cap),
                "A": _weight_sums(aobs, cap),
                "dr_delta_sum": float(np.sum(d)),
            },
        }
    return out


def main():
    args = parse_args()
    freeze = json.loads(args.freeze_json.read_text(encoding="utf-8"))
    if freeze.get("assessment_opened") is not False:
        raise SystemExit("frozen bundle assessment boundary mismatch")
    if freeze.get("fingerprint_sha256") != EXPECTED_FINGERPRINT:
        raise SystemExit("frozen bundle fingerprint mismatch")
    with args.freeze_q_pickle.open("rb") as handle:
        q_model = pickle.load(handle)

    selected, assess_ids, decisions, games, train, validation = fresh._load_fresh(args)
    provider = ArchiveSignalProvider(decisions, games)
    train_ids = frozenset(d.draft_id for d in train)
    metadata, unresolved, coverage = fresh._metadata(args.expansion, train, validation)

    train_rows = build_fold_training_rows(
        train,
        train_ids,
        signal_provider=provider,
        inner_feature_folds=fresh.INNER_FEATURE_FOLDS,
    )
    strong_behavior, strong_fit = fresh._fit_propensity(train_rows, True)

    val_scored = []
    for d in validation:
        if int(d.pack_number) != PRIMARY_PACK or not (PRIMARY_PICK_START <= int(d.pick_number) < PRIMARY_PICK_STOP):
            continue
        signals = provider(d, train_ids)
        features = model_feature_map(d, signals)
        state, scores, qsimple = fresh._score_decision(d, features, metadata, freeze, q_model)
        names = list(d.candidates)
        qlead = fresh._argmax(scores["Q"], names)
        alead = fresh._argmax(scores["A"], names)
        val_scored.append({
            "decision": d,
            "base_features": features,
            "offsets": strong_choice_offsets(signals, d.candidates),
            "state": state,
            "scores": scores,
            "qsimple": qsimple,
            "Q_leader": qlead,
            "A_leader": alead,
        })

    primary = fresh._primary_ope_details(val_scored)
    if not primary:
        raise SystemExit("no primary validation decisions")

    policies = {"Q": [], "A": []}
    leader_props = {"Q": [], "A": []}
    interventions = {"Q": 0, "A": 0}
    for t in GUARD_THRESHOLDS:
        policies[f"guard_{int(round(t*100)):03d}"] = []
        leader_props[f"guard_{int(round(t*100)):03d}"] = []
        interventions[f"guard_{int(round(t*100)):03d}"] = 0
    for lam in BLEND_LAMBDAS:
        policies[f"blend_{int(round(lam*100)):03d}"] = []
        leader_props[f"blend_{int(round(lam*100)):03d}"] = []
        interventions[f"blend_{int(round(lam*100)):03d}"] = 0

    decision_diagnostics = {
        "q_a_disagreements": 0,
        "guard_override_counts": {},
        "blend_override_counts": {},
    }

    for item in primary:
        d = item["decision"]
        names = list(d.candidates)
        features = fresh._drop_strong_map(item["base_features"])
        behavior = strong_behavior.probabilities(features, item["offsets"])
        qlead = int(item["Q_leader"])
        alead = int(item["A_leader"])
        qname, aname = names[qlead], names[alead]
        floor = _support_floor(len(names))
        qadv = float(item["scores"]["Q"][qlead] - item["scores"]["Q"][alead])

        if qlead != alead:
            decision_diagnostics["q_a_disagreements"] += 1

        base_leaders = {"Q": qlead, "A": alead}
        for label, lead in base_leaders.items():
            policies[label].append(_observation(item, lead, behavior))
            leader_props[label].append(float(behavior[names[lead]]))
            interventions[label] += int(lead != alead)

        for t in GUARD_THRESHOLDS:
            label = f"guard_{int(round(t*100)):03d}"
            use_q = qlead != alead and qadv >= t and float(behavior[qname]) >= floor
            lead = qlead if use_q else alead
            policies[label].append(_observation(item, lead, behavior))
            leader_props[label].append(float(behavior[names[lead]]))
            interventions[label] += int(lead != alead)

        az = _z(np.log(np.maximum(np.asarray(item["scores"]["A"], dtype=float), 1e-9)))
        qz = _z(item["scores"]["Q"])
        for lam in BLEND_LAMBDAS:
            label = f"blend_{int(round(lam*100)):03d}"
            scores = lam * qz + (1.0 - lam) * az
            lead = fresh._argmax(scores, names)
            if lead != alead and float(behavior[names[lead]]) < floor:
                lead = alead
            policies[label].append(_observation(item, lead, behavior))
            leader_props[label].append(float(behavior[names[lead]]))
            interventions[label] += int(lead != alead)

    n = len(primary)
    results = {}
    aobs = policies["A"]
    for label, obs in policies.items():
        results[label] = _summarize(
            obs,
            aobs,
            leader_props[label],
            interventions[label] / max(1, n),
        )

    report = {
        "phase": "qa_bounded_policy_study_environment",
        "scope": "fresh_validation_only",
        "expansion": args.expansion,
        "assessment_opened": False,
        "assessment_outcomes_loaded": False,
        "frozen_score_fingerprint": freeze["fingerprint_sha256"],
        "policy_family": {
            "guard_thresholds": list(GUARD_THRESHOLDS),
            "blend_lambdas": list(BLEND_LAMBDAS),
            "support_floor": "max(0.05,0.01,0.10/candidate_count)",
        },
        "archive_snapshot": {
            "draft_sha256": fresh.sha256(args.draft_archive),
            "game_sha256": fresh.sha256(args.game_archive),
            "max_drafts": args.max_drafts,
        },
        "cohort": {
            "selected_drafts": len(selected),
            "train_drafts": len({d.draft_id for d in train}),
            "validation_drafts": len({d.draft_id for d in validation}),
            "assessment_drafts_withheld": len(assess_ids),
            "primary_validation_drafts": n,
        },
        "metadata": {
            "coverage": coverage,
            "unresolved_count": len(unresolved),
        },
        "behavior_nuisance": strong_fit,
        "decision_diagnostics": decision_diagnostics,
        "policies": results,
        "boundary": "Exploratory Q+A design only. Fresh assessment is unopened and the spent locked MSH/SOS/ECL/TLA assessment is not loaded.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "expansion": args.expansion,
        "n": n,
        "cap20_dr": {k: v["caps"]["20"]["minus_A"]["dr"] for k, v in results.items()},
        "assessment_opened": False,
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
