#!/usr/bin/env python3
"""One-shot locked assessment for frozen #529 H/J/N/Q score policies.

The target policies are loaded from the already-frozen core bundle. The exact
assessment draft IDs come from the original immutable cohort manifest. Only the
saved train+validation IDs are used for nuisance/calibration fitting. Assessment
outcomes are loaded exactly once for scoring after archive identity checks pass.
"""
from __future__ import annotations

import argparse
import json
import pickle
import random
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
from contextual_value.features import model_feature_map, strong_choice_offsets
from contextual_value.nuisance import build_fold_training_rows
from contextual_value.rich_features import rich_feature_bundle
from contextual_value_phase_a_features import _fetch_rich_set
from contextual_value_four_way_fresh import (
    ALL,
    MODELS,
    INNER_FEATURE_FOLDS,
    _bootstrap_delta,
    _build_records,
    _cal_cv,
    _cal_validation,
    _estimate_ope,
    _fit_propensity,
    _metrics,
    _ope_observations,
    _primary_ope_details,
    _score_decision,
    sha256,
)

BOOT = 10000
SEED = 529
WEIGHT_CAPS = (10.0, 20.0, 50.0)
EXPECTED_MODELS = ("H", "J", "N", "Q")
EXPECTED_EXPANSIONS = ("MSH", "SOS", "ECL", "TLA")
EXPECTED_BUNDLE_FINGERPRINT = "d1f3cb78d1674b1424805b33637c89d3f3977baa890db61ff534fa7700cb5f33"
EXPECTED_COHORT_SIZE = 8000
MIN_ESS_RATIO = 0.10
HARM_MARGIN = -0.05


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--draft-archive", action="append", type=Path, required=True)
    p.add_argument("--game-archive", action="append", type=Path, required=True)
    p.add_argument("--cohort-manifest", type=Path, required=True)
    p.add_argument("--archive-manifest", type=Path, required=True)
    p.add_argument("--freeze-json", type=Path, required=True)
    p.add_argument("--freeze-q-pickle", type=Path, required=True)
    p.add_argument("--fresh-report", action="append", type=Path, default=[])
    p.add_argument("--output", type=Path, required=True)
    return p.parse_args()


def _verify_archives(paths, original_manifest):
    expected = {Path(row["path"]).name: row for row in original_manifest["archives"]}
    supplied = {p.name: p for p in paths}
    if set(supplied) != set(expected):
        raise SystemExit(f"archive set mismatch expected={sorted(expected)} got={sorted(supplied)}")
    report = {}
    for name, path in supplied.items():
        actual = sha256(path)
        wanted = str(expected[name]["sha256"])
        if actual != wanted:
            raise SystemExit(f"archive SHA mismatch for {name}: {actual} != {wanted}")
        report[name] = {"sha256": actual, "size_bytes": path.stat().st_size}
    return report


def _load_exact(args):
    cohort = json.loads(args.cohort_manifest.read_text(encoding="utf-8"))
    rows = list(cohort["selected_drafts"])
    if len(rows) != EXPECTED_COHORT_SIZE:
        raise SystemExit(f"expected {EXPECTED_COHORT_SIZE} frozen drafts, got {len(rows)}")
    selected = {str(r["draft_id"]): r for r in rows}
    if len(selected) != len(rows):
        raise SystemExit("duplicate draft IDs in frozen cohort manifest")
    expansions = {str(r["expansion"]) for r in rows}
    if expansions != set(EXPECTED_EXPANSIONS):
        raise SystemExit(f"unexpected frozen expansions: {sorted(expansions)}")
    dev_ids = frozenset(d for d, r in selected.items() if r["split"] in {"train", "validation"})
    assess_ids = frozenset(d for d, r in selected.items() if r["split"] == "assessment")
    if dev_ids & assess_ids or len(dev_ids) + len(assess_ids) != len(selected):
        raise SystemExit("invalid frozen split partition")

    decisions = []
    for path in args.draft_archive:
        decisions.extend(load_decisions(path, keep_ids=frozenset(selected)))
    observed = {d.draft_id for d in decisions}
    if observed != set(selected):
        raise SystemExit(f"raw archives do not reproduce frozen cohort IDs missing={len(set(selected)-observed)} extra={len(observed-set(selected))}")
    for d in decisions:
        expected_exp = str(selected[d.draft_id]["expansion"])
        if d.expansion != expected_exp:
            raise SystemExit(f"expansion mismatch for frozen draft {d.draft_id}")

    games = GameStore.from_archives(args.game_archive, frozenset(selected))
    development = [d for d in decisions if d.draft_id in dev_ids]
    assessment = [d for d in decisions if d.draft_id in assess_ids]
    if not development or not assessment:
        raise SystemExit("frozen cohort missing development or assessment rows")
    return cohort, dev_ids, assess_ids, decisions, games, development, assessment


def _metadata_by_expansion(decisions):
    wanted = defaultdict(set)
    for d in decisions:
        if int(d.pack_number) != PRIMARY_PACK or not (PRIMARY_PICK_START <= int(d.pick_number) < PRIMARY_PICK_STOP):
            continue
        wanted[d.expansion].update(d.candidates)
        wanted[d.expansion].update(name for name, _count in d.pool)
    result, report = {}, {}
    for exp in EXPECTED_EXPANSIONS:
        resolved, unresolved = _fetch_rich_set(exp, wanted[exp])
        coverage = len(resolved) / max(1, len(wanted[exp]))
        if coverage < 0.98:
            raise SystemExit(f"{exp}: metadata coverage {coverage:.2%} below 98%")
        result[exp] = resolved
        report[exp] = {"wanted": len(wanted[exp]), "resolved": len(resolved), "coverage": coverage, "unresolved": unresolved}
    return result, report


def _dr_terms(observations, cap):
    vals = []
    for o in observations:
        direct = sum(float(o.target[a]) * float(o.q_values[a]) for a in o.target)
        ratio = float(o.target[o.action]) / float(o.behavior[o.action])
        weight = min(float(cap), ratio)
        vals.append(direct + weight * (float(o.outcome) - float(o.q_values[o.action])))
    return np.asarray(vals, dtype=np.float64)


def _joint_bootstrap(deltas):
    names = list(deltas)
    n = len(next(iter(deltas.values())))
    if any(len(v) != n for v in deltas.values()):
        raise SystemExit("joint bootstrap delta length mismatch")
    rng = np.random.default_rng(SEED)
    draws = {k: np.empty(BOOT, dtype=np.float64) for k in names}
    for b in range(BOOT):
        idx = rng.integers(0, n, size=n)
        for k in names:
            draws[k][b] = float(np.mean(deltas[k][idx]))
    out = {}
    for k in names:
        x = draws[k]
        out[k] = {
            "delta": float(np.mean(deltas[k])),
            "ci95": [float(np.quantile(x, 0.025)), float(np.quantile(x, 0.975))],
            "ci98_75_bonferroni": [float(np.quantile(x, 0.00625)), float(np.quantile(x, 0.99375))],
            "draws": BOOT,
            "seed": SEED,
        }
    return out


def _pairwise_bootstrap(model_terms):
    pairs = {}
    for i, left in enumerate(MODELS):
        for right in MODELS[i + 1:]:
            d = model_terms[left] - model_terms[right]
            rng = np.random.default_rng(SEED)
            vals = np.empty(BOOT, dtype=np.float64)
            n = len(d)
            for b in range(BOOT):
                idx = rng.integers(0, n, size=n)
                vals[b] = float(np.mean(d[idx]))
            pairs[f"{left}_minus_{right}"] = {
                "delta": float(np.mean(d)),
                "ci95": [float(np.quantile(vals, .025)), float(np.quantile(vals, .975))],
            }
    return pairs


def _fresh_harm_evidence(paths):
    rows = []
    for p in paths:
        r = json.loads(p.read_text(encoding="utf-8"))
        if r.get("assessment_opened") is not False:
            raise SystemExit("fresh report assessment boundary violation")
        rows.append(r)
    if paths and {r.get("expansion") for r in rows} != {"EOE", "FIN", "TDM", "DFT"}:
        raise SystemExit("fresh evidence must contain EOE/FIN/TDM/DFT exactly")
    by_model = {}
    for m in MODELS:
        envs = {}
        separated_harm = False
        for r in rows:
            ci = r["ope_sensitivity"]["strong_offset_only"][m]["minus_A_cap20"]["dr_ci95"]
            envs[r["expansion"]] = ci
            separated_harm = separated_harm or float(ci[1]) < HARM_MARGIN
        by_model[m] = {"environments": envs, "separated_material_harm": separated_harm}
    return by_model


def main():
    args = parse_args()
    freeze = json.loads(args.freeze_json.read_text(encoding="utf-8"))
    if freeze.get("assessment_opened") is not False or freeze.get("parity", {}).get("passed") is not True:
        raise SystemExit("invalid frozen score bundle")
    if freeze.get("fingerprint_sha256") != EXPECTED_BUNDLE_FINGERPRINT:
        raise SystemExit("frozen score bundle fingerprint mismatch")
    if tuple(freeze.get("models", [])) != EXPECTED_MODELS:
        raise SystemExit("frozen model list mismatch")
    with args.freeze_q_pickle.open("rb") as handle:
        q_model = pickle.load(handle)

    original_archives = json.loads(args.archive_manifest.read_text(encoding="utf-8"))
    archive_verification = _verify_archives([*args.draft_archive, *args.game_archive], original_archives)

    # Assessment outcomes are first loaded here, only after model/cohort/archive identity passes.
    cohort, dev_ids, assess_ids, all_decisions, games, development, assessment = _load_exact(args)
    provider = ArchiveSignalProvider(all_decisions, games)
    metadata, metadata_report = _metadata_by_expansion([*development, *assessment])

    # All nuisance/calibration fitting is development-only (original train + validation IDs).
    dev_rows = build_fold_training_rows(development, dev_ids, signal_provider=provider, inner_feature_folds=INNER_FEATURE_FOLDS)
    by_id = {d.decision_id: d for d in development}
    dev_scored = []
    for row in dev_rows:
        d = by_id[row.decision_id]
        if int(d.pack_number) != PRIMARY_PACK or not (PRIMARY_PICK_START <= int(d.pick_number) < PRIMARY_PICK_STOP):
            continue
        state, scores, qsimple = _score_decision(d, row.features, metadata[d.expansion], freeze, q_model)
        dev_scored.append({"decision": d, "base_features": row.features, "offsets": row.offsets, "state": state, "scores": scores, "qsimple": qsimple})

    strong_behavior, strong_fit = _fit_propensity(dev_rows, True)
    nostrong_behavior, nostrong_fit = _fit_propensity(dev_rows, False)

    assess_scored = []
    for d in assessment:
        if int(d.pack_number) != PRIMARY_PACK or not (PRIMARY_PICK_START <= int(d.pick_number) < PRIMARY_PICK_STOP):
            continue
        signals = provider(d, dev_ids)
        features = model_feature_map(d, signals)
        state, scores, qsimple = _score_decision(d, features, metadata[d.expansion], freeze, q_model)
        assess_scored.append({"decision": d, "base_features": features, "offsets": strong_choice_offsets(signals, d.candidates), "state": state, "scores": scores, "qsimple": qsimple})

    dev_records, _dev_details = _build_records(dev_scored, freeze, "development")
    assess_records, assess_details = _build_records(assess_scored, freeze, "assessment")
    dy = np.asarray([r["y"] for r in dev_records], dtype=float)
    ay = np.asarray([r["y"] for r in assess_records], dtype=float)

    b0_cv = _cal_cv(dev_records, [], "b0")
    b0_assess = _cal_validation(dev_records, assess_records, [], "b0")
    b1_cv = _cal_cv(dev_records, [], "b1")
    b1_assess = _cal_validation(dev_records, assess_records, [], "b1")
    incremental = {
        "B0_pre_pick_state": {"development_cv": _metrics(dy, b0_cv), "assessment": _metrics(ay, b0_assess)},
        "B1_shared_simple_Q": {"development_cv": _metrics(dy, b1_cv), "assessment": _metrics(ay, b1_assess), "assessment_vs_B0": _bootstrap_delta(ay, b0_assess, b1_assess)},
    }
    for k in ALL:
        cvp = _cal_cv(dev_records, [k], "b1")
        ap = _cal_validation(dev_records, assess_records, [k], "b1")
        incremental[k] = {
            "development_cv": _metrics(dy, cvp),
            "assessment": _metrics(ay, ap),
            "assessment_vs_B1": _bootstrap_delta(ay, b1_assess, ap),
            "historical_agreement": float(np.mean([r[k + "_hist_agree"] for r in assess_records])),
        }

    scv = _cal_cv(dev_records, ["state_resid"], "b1")
    sa = _cal_validation(dev_records, assess_records, ["state_resid"], "b1")
    sjcv = _cal_cv(dev_records, ["state_resid", "J"], "b1")
    sja = _cal_validation(dev_records, assess_records, ["state_resid", "J"], "b1")
    j_card_specific = {
        "state_only": {"development_cv": _metrics(dy, scv), "assessment": _metrics(ay, sa), "assessment_vs_B1": _bootstrap_delta(ay, b1_assess, sa)},
        "state_plus_J_margin": {"development_cv": _metrics(dy, sjcv), "assessment": _metrics(ay, sja), "assessment_vs_state_only": _bootstrap_delta(ay, sa, sja)},
    }

    disagreements = {}
    for i, left in enumerate(ALL):
        for right in ALL[i + 1:]:
            rows = [x for x in assess_details if x[left + "_leader"] != x[right + "_leader"]]
            disagreements[f"{left}_vs_{right}"] = {
                "decisions": len(rows),
                "fraction": len(rows) / max(1, len(assess_details)),
                "drafts": len({x["decision"].draft_id for x in rows}),
            }

    primary = _primary_ope_details(assess_details)
    ope = {}
    obs_cache = {}
    for ename, model, keep in (("strong_offset_only", strong_behavior, True), ("no_strong_entirely", nostrong_behavior, False)):
        aobs = _ope_observations(primary, "A", model, keep)
        ope[ename] = {}
        obs_cache[ename] = {"A": aobs}
        for k in ALL:
            obs = _ope_observations(primary, k, model, keep)
            obs_cache[ename][k] = obs
            ope[ename][k] = _estimate_ope(obs, aobs)

    # Pooled per-set assessment OPE slices, using the same development-fit nuisances.
    set_slices = {}
    for exp in EXPECTED_EXPANSIONS:
        sub = [x for x in primary if x["decision"].expansion == exp]
        set_slices[exp] = {"drafts": len(sub), "models": {}}
        if not sub:
            continue
        aobs = _ope_observations(sub, "A", strong_behavior, True)
        for k in MODELS:
            set_slices[exp]["models"][k] = _estimate_ope(_ope_observations(sub, k, strong_behavior, True), aobs)["minus_A_cap20"]

    primary_a = obs_cache["strong_offset_only"]["A"]
    a_terms = _dr_terms(primary_a, 20.0)
    model_terms = {m: _dr_terms(obs_cache["strong_offset_only"][m], 20.0) for m in MODELS}
    delta_terms = {m: model_terms[m] - a_terms for m in MODELS}
    multiplicity = _joint_bootstrap(delta_terms)
    pairwise = _pairwise_bootstrap(model_terms)

    fresh_harm = _fresh_harm_evidence(args.fresh_report)
    gates = {}
    for m in MODELS:
        est = ope["strong_offset_only"][m]["estimates"]
        aest = ope["strong_offset_only"]["A"]["estimates"]
        cap_deltas = {c: float(est[c]["dr"] - aest[c]["dr"]) for c in ("10", "20", "50")}
        cap20 = ope["strong_offset_only"][m]["minus_A_cap20"]
        original = {
            "dr_ci95_above_zero": multiplicity[m]["ci95"][0] > 0.0,
            "direct_positive": float(cap20["direct"]) > 0.0,
            "snips_positive": float(cap20["snips"]) > 0.0,
            "dr_positive_caps_10_20_50": all(v > 0.0 for v in cap_deltas.values()),
            "ess_ratio_at_least_0_10": float(est["20"]["ess_ratio"]) >= MIN_ESS_RATIO,
            "fresh_environment_no_separated_material_harm": not fresh_harm.get(m, {}).get("separated_material_harm", False),
        }
        familywise = multiplicity[m]["ci98_75_bonferroni"][0] > 0.0
        gates[m] = {
            "cap20_dr_delta": multiplicity[m]["delta"],
            "dr_deltas_by_cap": cap_deltas,
            "cap20_direct_delta": float(cap20["direct"]),
            "cap20_snips_delta": float(cap20["snips"]),
            "cap20_ess_ratio": float(est["20"]["ess_ratio"]),
            "original_assessment_checks": original,
            "original_checks_pass": all(original.values()),
            "familywise_ci98_75_above_zero": familywise,
            "familywise_confirmed": all(original.values()) and familywise,
        }

    passers = [m for m in MODELS if gates[m]["familywise_confirmed"]]
    unique_leader = None
    if len(passers) == 1:
        unique_leader = passers[0]
    elif len(passers) > 1:
        for cand in passers:
            okay = True
            for other in passers:
                if cand == other:
                    continue
                key = f"{cand}_minus_{other}"
                if key in pairwise:
                    ci = pairwise[key]["ci95"]
                else:
                    ci0 = pairwise[f"{other}_minus_{cand}"]["ci95"]
                    ci = [-float(ci0[1]), -float(ci0[0])]
                if float(ci[0]) <= 0.0:
                    okay = False
                    break
            if okay:
                unique_leader = cand
                break

    report = {
        "phase": "four_way_locked_assessment",
        "scope": "locked_assessment_once",
        "assessment_opened": True,
        "assessment_outcomes_loaded": True,
        "assessment_outcomes_used_for_fit": False,
        "assessment_outcomes_used_for_scoring": True,
        "model_tuning_authorized": False,
        "frozen_score_fingerprint": freeze["fingerprint_sha256"],
        "cohort": {
            "selected_drafts": len(cohort["selected_drafts"]),
            "development_drafts": len(dev_ids),
            "assessment_drafts": len(assess_ids),
            "development_primary_drafts": len(dev_records),
            "assessment_primary_drafts": len(assess_records),
            "assessment_primary_decisions": len(assess_details),
        },
        "archive_verification": archive_verification,
        "metadata": metadata_report,
        "behavior_nuisance": {"strong_offset_only": strong_fit, "no_strong_entirely": nostrong_fit},
        "incremental_prediction": incremental,
        "J_card_specific_test": j_card_specific,
        "disagreements": disagreements,
        "ope": ope,
        "assessment_set_slices": set_slices,
        "multiplicity": {
            "method": "Bonferroni simultaneous family-wise rule: per-model two-sided 98.75% paired draft-bootstrap DR interval at cap20",
            "family_alpha": 0.05,
            "comparisons": 4,
            "bootstrap": multiplicity,
            "pairwise_model_dr_cap20": pairwise,
        },
        "fresh_environment_harm_evidence": fresh_harm,
        "gates": gates,
        "familywise_confirmed_models": passers,
        "unique_assessment_leader": unique_leader,
        "decision": (
            "unique_familywise_confirmed_challenger" if unique_leader else
            "multiple_familywise_confirmed_cofinalists" if passers else
            "no_familywise_confirmed_challenger"
        ),
        "next_step": (
            "Shadow-score the serving corpus with the unique confirmed challenger versus A; do not tune the model." if unique_leader else
            "Shadow-score all confirmed co-finalists versus A without tuning; do not choose by point estimate." if passers else
            "Retain A as incumbent; no post-assessment tuning is authorized under this protocol."
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "assessment_opened": True,
        "cohort": report["cohort"],
        "gates": gates,
        "familywise_confirmed_models": passers,
        "unique_assessment_leader": unique_leader,
        "decision": report["decision"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()