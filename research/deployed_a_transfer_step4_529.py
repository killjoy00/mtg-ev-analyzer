#!/usr/bin/env python3
"""Issue #529 Step 4: deployed-A vs research-A value diagnostic on spent 45k.

This file has two deliberately separate modes:

* freeze-actions: outcome-free. Reconstruct exact deployed v8 actions on the
  already-frozen FIN/TDM/DFT 45k decision contexts and bind them to the
  successful Step 1-3 audit artifacts.
* evaluate: after the frozen Step-0 agreement gate has failed, join only the
  already-spent 45k event_match_wins outcomes and run the historical all-eligible
  draft-weighted DR machinery.

No production mutation is implemented here.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "historical"))

from audit_a_transfer_529 import (  # noqa: E402
    example_lookup,
    load_examples,
    probs,
    ranking,
    scan_skills,
)
from build_replays import (  # noqa: E402
    CountStore,
    OutOfFoldModel,
    build_colour_tables_by_fold,
    build_fold_training,
    select_strong_drafts,
    stable_fold,
)
from contextual_value_draft_weighted_ope import evaluate_draft_weighted, paired_delta  # noqa: E402
from contextual_value_multiaction_sensitivity import paired_policy_bounds  # noqa: E402

SETS = ("FIN", "TDM", "DFT")
CAPS = (10.0, 20.0, 50.0)
BOOT = 10000
SEED = 529
GAMMA = (1.0, 1.1, 1.22352, 1.25, 1.5, 2.0, 3.0, 5.0)

EXPECTED_DRAFT = {
    "FIN": "9d5b2a3e908bb8daf0ea6e951097714b651546370a5c852893dc90a1f2f6ab8b",
    "TDM": "831ba8bc4be5eabe140fac00a8e6eaded3f3f931685be8f91403ad9cfde5cbf5",
    "DFT": "7812d16e0de78ff7a69faf9981f7ff03be4dfc618a86f14369424ec2204580cd",
}
EXPECTED_GAME = {
    "FIN": "f6452e622976f66dd5420c55741da5b246c7e8d25d63c080e728635e1741a6a6",
    "TDM": "e2e679168818d67d812972343ba541d626d0f57140bc22955e09dd07bc2086e4",
    "DFT": "734325afbe5c023245e7769fab66c88dcf241407666becb06b956d7fee13a28b",
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def parse_pair(raw: str) -> tuple[str, Path]:
    key, value = raw.split("=", 1)
    return key.upper(), Path(value)


def load_outcomes(path: Path, ids: set[str]) -> dict[str, float]:
    """Step-4-only outcome join. No outcome is touched in freeze-actions mode."""
    out: dict[str, float] = {}
    import gzip

    with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as fh:
        reader = csv.reader(fh)
        header = tuple(next(reader))
        pos = {name: i for i, name in enumerate(header)}
        if "draft_id" not in pos or "event_match_wins" not in pos:
            raise SystemExit("required Step-4 outcome columns missing")
        for values in reader:
            if len(values) != len(header):
                continue
            did = values[pos["draft_id"]].strip()
            if did not in ids:
                continue
            raw = values[pos["event_match_wins"]].strip()
            if raw == "":
                continue
            value = float(raw)
            if did in out and out[did] != value:
                raise SystemExit(f"{did}: event_match_wins changed across rows")
            out[did] = value
    missing = ids - set(out)
    if missing:
        raise SystemExit(f"outcome join incomplete: missing {len(missing)} drafts")
    return out


def build_production_models(draft_path: Path, game_path: Path, set_id: str):
    skills, _, header = scan_skills(draft_path)
    training, cutoff, experienced = select_strong_drafts(skills, 100, 0.15, 5000)
    training = set(training)
    return skills, header, training, cutoff, experienced


def freeze_actions(args: argparse.Namespace) -> None:
    env = args.expansion.upper()
    sid = env.lower()
    if env not in SETS:
        raise SystemExit(f"unsupported Step-4 environment: {env}")
    if sha256(args.draft) != EXPECTED_DRAFT[env]:
        raise SystemExit(f"{env}: draft archive hash mismatch")
    if sha256(args.game) != EXPECTED_GAME[env]:
        raise SystemExit(f"{env}: game archive hash mismatch")

    audit = json.loads(args.audit_report.read_text())
    if audit.get("set") != sid:
        raise SystemExit("audit set mismatch")
    if audit.get("reproduction", {}).get("pass") is not True:
        raise SystemExit(f"{env}: deployed-A reproduction did not pass")
    if audit.get("reproduction", {}).get("identity_match") is not True:
        raise SystemExit(f"{env}: exact snapshot identity did not pass")
    if audit.get("research_A", {}).get("frozen_action_identity_ok") is not True:
        raise SystemExit(f"{env}: frozen research-A action parity did not pass")

    freeze_report = json.loads(args.freeze_report.read_text())
    expected_context_hash = freeze_report["context"]["npz_sha256"]
    if sha256(args.frozen_context) != expected_context_hash:
        raise SystemExit(f"{env}: frozen context hash mismatch")
    if freeze_report["archive"]["draft_sha256"] != EXPECTED_DRAFT[env]:
        raise SystemExit(f"{env}: frozen report draft identity mismatch")
    if freeze_report["archive"]["game_sha256"] != EXPECTED_GAME[env]:
        raise SystemExit(f"{env}: frozen report game identity mismatch")
    if freeze_report["confirmation_outcomes_parsed"] is not False:
        raise SystemExit(f"{env}: context was not frozen outcome-free")

    z = np.load(args.frozen_context, allow_pickle=False)
    data = {name: z[name] for name in z.files}
    draft_ids = [str(x) for x in data["draft_ids"]]
    unique_eval = set(draft_ids)
    if len(unique_eval) != 15000:
        raise SystemExit(f"{env}: expected 15000 frozen drafts, got {len(unique_eval)}")

    skills, header, training, cutoff, experienced = build_production_models(
        args.draft, args.game, sid
    )
    wanted = training | unique_eval
    examples = load_examples(args.draft, wanted, header, training)
    lookup = example_lookup(examples)

    prod_pairs = [(did, ex) for did in training for ex in examples.get(did, ())]
    folds = build_fold_training(prod_pairs, training, 5)
    fits = build_colour_tables_by_fold(args.game, prod_pairs, folds, sid)
    fold_models = {
        fold.fold: OutOfFoldModel(fold.counts, CountStore.empty(), fits[fold.fold])
        for fold in folds
    }

    offsets = np.asarray(data["offsets"], dtype=np.int64)
    names = data["candidate_names"]
    deployed = np.empty(len(draft_ids), dtype=np.int16)
    research = np.asarray(data["incumbent_ord"], dtype=np.int16)
    missing: list[str] = []
    candidate_mismatch = 0
    for i, did in enumerate(draft_ids):
        pack = int(data["pack_number"][i])
        pick = int(data["pick_number"][i])
        if pack != 0 or not 0 <= pick <= 7:
            raise SystemExit(f"{env}: frozen decision outside P1P1-P1P8")
        ex = lookup.get((did, pack + 1, pick + 1))
        if ex is None:
            missing.append(f"{did}:{pack}:{pick}")
            continue
        lo, hi = int(offsets[i]), int(offsets[i + 1])
        frozen_names = [str(x) for x in names[lo:hi]]
        if set(frozen_names) != set(ex.candidates):
            candidate_mismatch += 1
            continue
        p = probs(fold_models[stable_fold(did, 5)], ex)
        top = ranking(p)[0]
        deployed[i] = frozen_names.index(top)
        if not 0 <= int(research[i]) < len(frozen_names):
            raise SystemExit(f"{env}: invalid frozen research ordinal")
    if missing or candidate_mismatch:
        raise SystemExit(
            f"{env}: incomplete deployed action freeze missing={len(missing)} "
            f"candidate_mismatch={candidate_mismatch}"
        )

    agreement = float(np.mean(deployed == research))
    frozen_scope = audit["agreement"]["spent_45k"]
    if int(frozen_scope["n"]) != len(deployed):
        raise SystemExit(
            f"{env}: audit/freeze decision count mismatch "
            f"{frozen_scope['n']} != {len(deployed)}"
        )
    if abs(float(frozen_scope["top1_agreement"]) - agreement) > 1e-12:
        raise SystemExit(
            f"{env}: audit/freeze agreement mismatch "
            f"{frozen_scope['top1_agreement']} != {agreement}"
        )

    args.output_npz.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        args.output_npz,
        decision_ids=np.asarray(data["decision_ids"]),
        deployed_ord=deployed,
        research_ord=research,
    )
    report = {
        "schema": 1,
        "phase": "deployed_A_vs_research_A_step4_action_freeze",
        "expansion": env,
        "outcomes_parsed": False,
        "outcomes_used": False,
        "audit_report_sha256": sha256(args.audit_report),
        "frozen_context_sha256": expected_context_hash,
        "action_npz_sha256": sha256(args.output_npz),
        "drafts": len(unique_eval),
        "decisions": len(deployed),
        "deployed_vs_research_top1_agreement": agreement,
        "deployed_vs_research_disagreements": int(np.sum(deployed != research)),
        "production_training": {
            "training_drafts": len(training),
            "experienced_drafts": experienced,
            "win_rate_cutoff": cutoff,
        },
        "audit_reproduction_pass": True,
        "research_frozen_action_identity_ok": True,
        "production_change_authorized": False,
    }
    args.output_report.parent.mkdir(parents=True, exist_ok=True)
    args.output_report.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps(report, indent=2, sort_keys=True))


def estimate_pair(data, behavior, deployed, research, outcome):
    idx = np.arange(len(data["draft_ids"]), dtype=np.int64)
    rows = {}
    terms = {}
    for cap in CAPS:
        de, dt = evaluate_draft_weighted(
            offsets=data["offsets"],
            selected_ord=data["selected_ord"],
            target_ord=deployed,
            outcome=outcome,
            behavior=behavior,
            q_values=data["q_values"],
            draft_ids=data["draft_ids"],
            decision_indices=idx,
            cap=cap,
        )
        re, rt = evaluate_draft_weighted(
            offsets=data["offsets"],
            selected_ord=data["selected_ord"],
            target_ord=research,
            outcome=outcome,
            behavior=behavior,
            q_values=data["q_values"],
            draft_ids=data["draft_ids"],
            decision_indices=idx,
            cap=cap,
        )
        delta = paired_delta(dt, rt)
        rows[str(int(cap))] = {
            "deployed_A": de.__dict__,
            "research_A": re.__dict__,
            "deployed_minus_research": {
                "dr": float(de.dr - re.dr),
                "direct": float(de.direct - re.direct),
                "residual_correction": float(
                    (de.dr - re.dr) - (de.direct - re.direct)
                ),
                "snips": float(de.snips - re.snips),
                "ipw": float(de.ipw - re.ipw),
            },
        }
        terms[str(int(cap))] = (dt, rt, delta)
    return rows, terms


def target_calibration(data, behavior, target):
    idx = np.arange(len(data["draft_ids"]), dtype=np.int64)
    offsets = np.asarray(data["offsets"], dtype=np.int64)
    selected = np.asarray(data["selected_ord"], dtype=np.int64)
    drafts = np.asarray(data["draft_ids"]).astype(str)
    ids = drafts[idx]
    unique, inverse, counts = np.unique(ids, return_inverse=True, return_counts=True)
    within = 1.0 / counts[inverse]
    n_drafts = len(unique)
    p = behavior[offsets[idx] + target[idx]]
    y = (selected[idx] == target[idx]).astype(float)

    def wm(values):
        return float(np.sum(within * np.asarray(values, float)) / n_drafts)

    raw = np.where(y > 0, 1.0 / np.clip(p, 1e-15, None), 0.0)
    bins = []
    for lo, hi in zip(
        (0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7),
        (0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 1.000001),
    ):
        mask = (p >= lo) & (p < hi)
        if np.any(mask):
            w = within[mask]
            den = float(np.sum(w))
            pred = float(np.sum(w * p[mask]) / den)
            obs = float(np.sum(w * y[mask]) / den)
            bins.append(
                {
                    "lo": lo,
                    "hi": hi,
                    "n": int(np.sum(mask)),
                    "predicted": pred,
                    "observed": obs,
                    "observed_minus_predicted": obs - pred,
                }
            )
    return {
        "mean_predicted": wm(p),
        "observed_match_rate": wm(y),
        "observed_minus_predicted": wm(y - p),
        "brier": wm((y - p) ** 2),
        "cap20_weight_normalization": wm(np.minimum(20, raw)),
        "uncapped_weight_normalization": wm(raw),
        "below_0_05_fraction": wm(p < 0.05),
        "bins": bins,
    }


def disagreement_support(data, behavior, deployed, research):
    idx = np.flatnonzero(deployed != research)
    offsets = np.asarray(data["offsets"], dtype=np.int64)
    selected = np.asarray(data["selected_ord"], dtype=np.int64)
    dp = behavior[offsets[idx] + deployed[idx]]
    rp = behavior[offsets[idx] + research[idx]]
    return {
        "decisions": int(len(idx)),
        "fraction": float(len(idx) / len(deployed)),
        "both_ge_0_05_fraction": (
            float(np.mean((dp >= 0.05) & (rp >= 0.05))) if len(idx) else 1.0
        ),
        "deployed_matched_actions": int(np.sum(selected[idx] == deployed[idx])),
        "research_matched_actions": int(np.sum(selected[idx] == research[idx])),
        "deployed_propensity_quantiles": (
            {str(q): float(np.quantile(dp, q)) for q in (0, 0.01, 0.05, 0.5, 0.95, 0.99, 1)}
            if len(idx)
            else {}
        ),
        "research_propensity_quantiles": (
            {str(q): float(np.quantile(rp, q)) for q in (0, 0.01, 0.05, 0.5, 0.95, 0.99, 1)}
            if len(idx)
            else {}
        ),
    }


def stratified_bootstrap(delta_by_env):
    rng = np.random.default_rng(SEED)
    draws = np.empty(BOOT, dtype=np.float64)
    envs = sorted(delta_by_env)
    for b in range(BOOT):
        means = []
        for env in envs:
            values = np.asarray(delta_by_env[env], dtype=np.float64)
            means.append(
                float(np.mean(values[rng.integers(0, len(values), size=len(values))]))
            )
        draws[b] = float(np.mean(means))
    return [
        float(np.quantile(draws, 0.025)),
        float(np.quantile(draws, 0.975)),
    ]


def equal_env_point(delta_by_env):
    return float(
        np.mean([np.mean(np.asarray(values, float)) for values in delta_by_env.values()])
    )


def evaluate(args: argparse.Namespace) -> None:
    contexts = dict(map(parse_pair, args.frozen_context))
    actions = dict(map(parse_pair, args.frozen_actions))
    archives = dict(map(parse_pair, args.draft_archive))
    if set(contexts) != set(SETS) or set(actions) != set(SETS) or set(archives) != set(SETS):
        raise SystemExit("evaluate requires exact FIN/TDM/DFT inputs")

    per = {}
    primary_delta = {}
    alternative_delta = {}
    sensitivity = {}
    decisions_total = 0
    drafts_total = 0
    for env in SETS:
        if sha256(archives[env]) != EXPECTED_DRAFT[env]:
            raise SystemExit(f"{env}: outcome archive hash mismatch")
        z = np.load(contexts[env], allow_pickle=False)
        data = {name: z[name] for name in z.files}
        a = np.load(actions[env], allow_pickle=False)
        if not np.array_equal(a["decision_ids"], data["decision_ids"]):
            raise SystemExit(f"{env}: action/context decision identity mismatch")
        deployed = np.asarray(a["deployed_ord"], dtype=np.int64)
        research = np.asarray(a["research_ord"], dtype=np.int64)
        if not np.array_equal(research, np.asarray(data["incumbent_ord"], dtype=np.int64)):
            raise SystemExit(f"{env}: frozen research action mismatch")
        if len(deployed) != len(data["draft_ids"]):
            raise SystemExit(f"{env}: action length mismatch")

        draft_ids = set(map(str, data["draft_ids"]))
        if len(draft_ids) != 15000:
            raise SystemExit(f"{env}: expected 15000 spent drafts")
        outcome_map = load_outcomes(archives[env], draft_ids)
        outcome = np.asarray(
            [outcome_map[str(did)] for did in data["draft_ids"]],
            dtype=np.float64,
        )
        primary_behavior = np.asarray(data["primary_behavior"], dtype=np.float64)
        alternative_behavior = np.asarray(data["alternative_behavior"], dtype=np.float64)

        primary, pterms = estimate_pair(
            data, primary_behavior, deployed, research, outcome
        )
        alternative, aterms = estimate_pair(
            data, alternative_behavior, deployed, research, outcome
        )
        primary_delta[env] = pterms["20"][2]
        alternative_delta[env] = aterms["20"][2]

        idx = np.arange(len(data["draft_ids"]), dtype=np.int64)
        curves = []
        for gamma in GAMMA:
            bound = paired_policy_bounds(
                offsets=data["offsets"],
                selected_ord=data["selected_ord"],
                challenger_ord=deployed,
                incumbent_ord=research,
                outcome=outcome,
                behavior=primary_behavior,
                q_values=data["q_values"],
                draft_ids=data["draft_ids"],
                decision_indices=idx,
                gamma=gamma,
                cap=20.0,
                estimator="dr",
            )
            curves.append(
                {"gamma": gamma, "lower": bound.lower, "upper": bound.upper}
            )
        sensitivity[env] = curves

        delta = np.asarray(pterms["20"][2], dtype=np.float64)
        draft_order = np.asarray(pterms["20"][0].draft_ids).astype(str)
        top = np.argsort(np.abs(delta))[-20:][::-1]
        per[env] = {
            "drafts": 15000,
            "decisions": int(len(deployed)),
            "top1_agreement": float(np.mean(deployed == research)),
            "primary": primary,
            "alternative_same_actions": alternative,
            "primary_calibration": {
                "deployed_A": target_calibration(data, primary_behavior, deployed),
                "research_A": target_calibration(data, primary_behavior, research),
                "disagreements": disagreement_support(
                    data, primary_behavior, deployed, research
                ),
            },
            "alternative_calibration": {
                "deployed_A": target_calibration(data, alternative_behavior, deployed),
                "research_A": target_calibration(data, alternative_behavior, research),
                "disagreements": disagreement_support(
                    data, alternative_behavior, deployed, research
                ),
            },
            "primary_cap20_influence": {
                "quantiles": {
                    str(q): float(np.quantile(delta, q))
                    for q in (0, 0.001, 0.01, 0.05, 0.5, 0.95, 0.99, 0.999, 1)
                },
                "top_abs": [
                    {"draft_id": str(draft_order[i]), "delta": float(delta[i])}
                    for i in top
                ],
            },
            "sensitivity_DR_outer_bound": curves,
        }
        decisions_total += len(deployed)
        drafts_total += len(draft_ids)

    primary_ci = stratified_bootstrap(primary_delta)
    alternative_ci = stratified_bootstrap(alternative_delta)
    primary_point = equal_env_point(primary_delta)
    alternative_point = equal_env_point(alternative_delta)

    aggregate_caps = {}
    aggregate_alt_caps = {}
    for cap in ("10", "20", "50"):
        aggregate_caps[cap] = {
            metric: float(
                np.mean(
                    [
                        per[env]["primary"][cap]["deployed_minus_research"][metric]
                        for env in SETS
                    ]
                )
            )
            for metric in ("dr", "direct", "residual_correction", "snips", "ipw")
        }
        aggregate_alt_caps[cap] = {
            metric: float(
                np.mean(
                    [
                        per[env]["alternative_same_actions"][cap][
                            "deployed_minus_research"
                        ][metric]
                        for env in SETS
                    ]
                )
            )
            for metric in ("dr", "direct", "residual_correction", "snips", "ipw")
        }

    loeo = {}
    for omitted in SETS:
        keep = [env for env in SETS if env != omitted]
        loeo[omitted] = {
            "primary_cap20_dr": float(
                np.mean(
                    [
                        per[env]["primary"]["20"]["deployed_minus_research"]["dr"]
                        for env in keep
                    ]
                )
            ),
            "alternative_cap20_dr": float(
                np.mean(
                    [
                        per[env]["alternative_same_actions"]["20"][
                            "deployed_minus_research"
                        ]["dr"]
                        for env in keep
                    ]
                )
            ),
        }

    aggregate_sensitivity = []
    for i, gamma in enumerate(GAMMA):
        aggregate_sensitivity.append(
            {
                "gamma": gamma,
                "lower": float(
                    np.mean([sensitivity[env][i]["lower"] for env in SETS])
                ),
                "upper": float(
                    np.mean([sensitivity[env][i]["upper"] for env in SETS])
                ),
            }
        )

    report = {
        "schema": 1,
        "phase": "deployed_A_vs_research_A_step4_45k_diagnostic",
        "authorization": {
            "step0_transfer_gate_failed_outcome_blind": True,
            "first_observed_failure": "SOS top-1 agreement below frozen 95% threshold",
            "this_is_the_single_prespecified_step4_followup": True,
        },
        "scope": (
            "Already-spent FIN/TDM/DFT 45k only; exact frozen decisions, behavior "
            "nuisances, Q nuisance, and natural downstream event_match_wins."
        ),
        "environments": list(SETS),
        "environment_weight": "exactly one-third each",
        "drafts_total": drafts_total,
        "decisions_total": decisions_total,
        "primary_estimand": (
            "Deployed-A minus research-A average one-step recommendation effect over "
            "all available P1P1-P1P8 decisions within each spent draft, followed by "
            "natural downstream drafting/play; equal total weight per draft and one-third "
            "per environment."
        ),
        "primary_estimator": (
            "paired cap20 DR with two-sided 95% environment-stratified paired "
            "draft bootstrap (10,000 draws, seed 529)"
        ),
        "primary": {
            "deployed_minus_research_cap20_dr": primary_point,
            "ci95": primary_ci,
            "caps": aggregate_caps,
        },
        "alternative_same_actions": {
            "deployed_minus_research_cap20_dr": alternative_point,
            "ci95": alternative_ci,
            "caps": aggregate_alt_caps,
        },
        "per_environment": per,
        "leave_one_environment_out": loeo,
        "hidden_confounding": {
            "grid": list(GAMMA),
            "aggregate_equal_environment_DR_outer_bounds": aggregate_sensitivity,
            "note": (
                "Sensitivity bounds are not sampling confidence intervals. Gamma=1.22352 "
                "is the same recorded-skill scale reference used by the frozen 45k analysis."
            ),
        },
        "interpretation_boundary": (
            "This diagnostic cannot retroactively make the frozen >=95% action-transfer "
            "gate pass. It measures whether the two A definitions have detectably different "
            "observational one-step value on the already-spent 45k under the exact historical "
            "evaluator and sensitivity design."
        ),
        "production_change_authorized": False,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(
        json.dumps(
            {
                "primary_deployed_minus_research_cap20_dr": primary_point,
                "primary_ci95": primary_ci,
                "alternative_deployed_minus_research_cap20_dr": alternative_point,
                "alternative_ci95": alternative_ci,
                "per_environment": {
                    env: per[env]["primary"]["20"]["deployed_minus_research"]["dr"]
                    for env in SETS
                },
            },
            indent=2,
            sort_keys=True,
        )
    )


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="mode", required=True)

    f = sub.add_parser("freeze-actions")
    f.add_argument("--expansion", required=True)
    f.add_argument("--draft", type=Path, required=True)
    f.add_argument("--game", type=Path, required=True)
    f.add_argument("--audit-report", type=Path, required=True)
    f.add_argument("--frozen-context", type=Path, required=True)
    f.add_argument("--freeze-report", type=Path, required=True)
    f.add_argument("--output-npz", type=Path, required=True)
    f.add_argument("--output-report", type=Path, required=True)

    e = sub.add_parser("evaluate")
    e.add_argument("--frozen-context", action="append", required=True)
    e.add_argument("--frozen-actions", action="append", required=True)
    e.add_argument("--draft-archive", action="append", required=True)
    e.add_argument("--output", type=Path, required=True)
    return p


def main() -> None:
    args = parser().parse_args()
    if args.mode == "freeze-actions":
        freeze_actions(args)
    else:
        evaluate(args)


if __name__ == "__main__":
    main()
