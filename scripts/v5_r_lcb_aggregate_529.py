#!/usr/bin/env python3
"""Aggregate the exact v5-vs-frozen-R retrospective #529 diagnostic."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ENVS = ("FIN", "TDM", "DFT")
CAPS = (10.0, 20.0, 50.0)
BOOT = 10000
SEED = 529
HIST_R_V4 = {
    "point": 0.008600,
    "ci95": [-0.005029, 0.021874],
    "alternative_point": 0.010492,
    "alternative_ci95": [-0.003385, 0.023748],
}


def load_hist(root: Path):
    sys.path.insert(0, str(root))
    from contextual_value_draft_weighted_ope import evaluate_draft_weighted, paired_delta
    return evaluate_draft_weighted, paired_delta


def estimate(data, behavior, left, right, y, eval_dw, paired_delta):
    idx = np.arange(len(data["draft_ids"]), dtype=np.int64)
    rows, terms = {}, {}
    for cap in CAPS:
        le, lt = eval_dw(
            offsets=data["offsets"], selected_ord=data["selected_ord"], target_ord=left,
            outcome=y, behavior=behavior, q_values=data["q_values"],
            draft_ids=data["draft_ids"], decision_indices=idx, cap=cap,
        )
        re, rt = eval_dw(
            offsets=data["offsets"], selected_ord=data["selected_ord"], target_ord=right,
            outcome=y, behavior=behavior, q_values=data["q_values"],
            draft_ids=data["draft_ids"], decision_indices=idx, cap=cap,
        )
        d = paired_delta(lt, rt)
        rows[str(int(cap))] = {
            "r": le.__dict__, "v5": re.__dict__,
            "r_minus_v5": {
                "dr": float(le.dr - re.dr),
                "direct": float(le.direct - re.direct),
                "residual_correction": float((le.dr - re.dr) - (le.direct - re.direct)),
                "snips": float(le.snips - re.snips),
                "ipw": float(le.ipw - re.ipw),
            },
        }
        terms[str(int(cap))] = d
    return rows, terms


def bootstrap(series):
    envs = sorted(ENVS)
    n = 15000
    stacks = {e: np.asarray(series[e], float) for e in envs}
    vals = np.empty(BOOT)
    rng = np.random.default_rng(SEED)
    chunk = 20
    for start in range(0, BOOT, chunk):
        take = min(chunk, BOOT - start)
        inds = rng.integers(0, n, size=(take, len(envs), n))
        means = np.zeros(take)
        for j, e in enumerate(envs):
            means += np.mean(stacks[e][inds[:, j, :]], axis=1)
        vals[start:start + take] = means / len(envs)
    return [float(np.quantile(vals, .025)), float(np.quantile(vals, .975))]


def classify(point, ci):
    lo, hi = ci
    if hi < 0:
        return "meaningful_harm"
    if lo > 0:
        if lo > .03:
            return "statistically_supported_positive_and_interval_above_0.03"
        if hi < .03:
            return "statistically_supported_small_positive_but_interval_excludes_0.03"
        return "statistically_supported_positive_practical_value_uncertain"
    if hi < .03:
        return "interval_excludes_+0.03_benefit"
    if point > 0:
        return "small_positive_effect_practical_value_uncertain_and_not_statistically_supported"
    return "inconclusive"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--hist-root", type=Path, required=True)
    p.add_argument("--freeze-root", type=Path, required=True)
    p.add_argument("--action-root", type=Path, required=True)
    p.add_argument("--historical-r-report", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    eval_dw, paired_delta = load_hist(a.hist_root)
    historical = json.loads(a.historical_r_report.read_text())

    per = {}
    primary_terms = {}
    alt_terms = {}
    for env in ENVS:
        freeze_dir = next(a.freeze_root.glob(f"*{env}*"))
        z0 = np.load(freeze_dir / "frozen-evaluation-context.npz", allow_pickle=False)
        data = {k: z0[k] for k in z0.files}
        action_dir = next(a.action_root.glob(f"*{env}*"))
        az = np.load(action_dir / "actions.npz", allow_pickle=False)
        v5 = np.asarray(az["v5_ord"], np.int64)
        y = np.asarray(az["outcome"], float)
        r = np.asarray(data["r_lcb_ord"], np.int64)
        if len(v5) != len(r) or len(y) != len(r):
            raise SystemExit(f"{env}: action/outcome length mismatch")
        primary_rows, pt = estimate(
            data, np.asarray(data["primary_behavior"], float),
            r, v5, y, eval_dw, paired_delta
        )
        alt_rows, at = estimate(
            data, np.asarray(data["alternative_behavior"], float),
            r, v5, y, eval_dw, paired_delta
        )
        meta = json.loads((action_dir / "meta.json").read_text())
        per[env] = {"meta": meta, "primary": primary_rows, "alternative": alt_rows}
        primary_terms[env] = pt["20"]
        alt_terms[env] = at["20"]

    point = float(np.mean([per[e]["primary"]["20"]["r_minus_v5"]["dr"] for e in ENVS]))
    alt_point = float(np.mean([per[e]["alternative"]["20"]["r_minus_v5"]["dr"] for e in ENVS]))
    ci = bootstrap(primary_terms)
    alt_ci = bootstrap(alt_terms)

    if historical.get("primary", {}).get("cap20_dr") is None:
        raise SystemExit("historical R report missing cap20 result")

    result = {
        "schema": 1,
        "phase": "issue_529_retrospective_r_lcb_vs_v5",
        "scope": "spent frozen 45k FIN/TDM/DFT; 15k drafts each; all available P1P1-P1P8; equal draft and environment weight",
        "v5_model": "strong-player-colour-stage-v5; uncapped all-qualified; 5-fold source-held-out",
        "r_policy": "exact frozen R-LCB c=2.49 actions from independent confirmation",
        "estimator": "paired draft-weighted cap20 DR; 10,000-draw environment-stratified paired draft bootstrap; seed 529",
        "primary": {
            "r_minus_v5_cap20_dr": point,
            "ci95": ci,
            "classification": classify(point, ci),
            "ci_above_zero": bool(ci[0] > 0),
            "practical_0_03": "supports" if ci[0] > .03 else ("excludes" if ci[1] < .03 else "compatible"),
        },
        "alternative_same_actions": {
            "r_minus_v5_cap20_dr": alt_point,
            "ci95": alt_ci,
            "classification": classify(alt_point, alt_ci),
        },
        "historical_r_minus_deployed_v4": HIST_R_V4,
        "historical_r_minus_research_a": {
            "point": float(historical["primary"]["cap20_dr"]),
            "ci95": [float(x) for x in historical["primary"]["ci95"]],
        },
        "per_environment": {
            e: {
                "r_minus_v5_cap20_dr": per[e]["primary"]["20"]["r_minus_v5"]["dr"],
                "alternative_cap20_dr": per[e]["alternative"]["20"]["r_minus_v5"]["dr"],
                "r_v5_action_agreement": per[e]["meta"]["r_v5_action_agreement"],
                "r_v5_disagreement_count": per[e]["meta"]["r_v5_disagreement_count"],
                "v5_training_drafts": per[e]["meta"]["training_drafts"],
                "shipped_v5_reproduction": per[e]["meta"]["shipped_v5_reproduction"],
            }
            for e in ENVS
        },
        "caps_primary": {
            str(int(cap)): {
                k: float(np.mean([per[e]["primary"][str(int(cap))]["r_minus_v5"][k] for e in ENVS]))
                for k in ("dr", "direct", "residual_correction", "snips", "ipw")
            }
            for cap in CAPS
        },
        "caps_alternative": {
            str(int(cap)): {
                k: float(np.mean([per[e]["alternative"][str(int(cap))]["r_minus_v5"][k] for e in ENVS]))
                for k in ("dr", "direct", "residual_correction", "snips", "ipw")
            }
            for cap in CAPS
        },
        "retrospective_spent_cohort_diagnostic": True,
        "production_change_authorized": False,
    }
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "report.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    lines = [
        "# #529 retrospective — frozen R-LCB vs shipped v5",
        "",
        "This is a retrospective diagnostic on the already-spent 45,000-draft FIN/TDM/DFT confirmation cohort. R is not refit or retuned.",
        "",
        "## Primary result",
        "",
        f"- R-LCB minus v5 cap-20 DR: **{point:+.6f} wins**",
        f"- 95% stratified draft-bootstrap CI: **[{ci[0]:+.6f}, {ci[1]:+.6f}]**",
        f"- Alternative evaluator, same frozen actions: **{alt_point:+.6f}** [{alt_ci[0]:+.6f}, {alt_ci[1]:+.6f}]",
        f"- Historical R-LCB minus deployed v4 on this spent cohort: **{HIST_R_V4['point']:+.6f}** [{HIST_R_V4['ci95'][0]:+.6f}, {HIST_R_V4['ci95'][1]:+.6f}]",
        "",
        "## Per environment",
        "",
        "| Set | R-v5 DR | R/v5 action agreement | v5 training drafts | shipped-v5 reproduction |",
        "| --- | ---: | ---: | ---: | --- |",
    ]
    for e in ENVS:
        row = result["per_environment"][e]
        rep = row["shipped_v5_reproduction"]
        lines.append(
            f"| {e} | {row['r_minus_v5_cap20_dr']:+.6f} | {row['r_v5_action_agreement']:.3%} | "
            f"{row['v5_training_drafts']:,} | PASS ({rep['decisions_checked']:,} decisions, max abs {rep['max_abs_probability_error']:.2e}) |"
        )
    lines += [
        "",
        "## Interpretation boundary",
        "",
        "The comparison holds the frozen R policy, 45k cohort, observed outcomes, nuisance predictions, behavior evaluators, estimator, caps and bootstrap seed fixed, and replaces only the incumbent action with an exact reconstruction of shipped uncapped v5. Because the cohort was already used for prior analysis, this is descriptive/retrospective evidence rather than a new independent confirmation.",
    ]
    (a.out / "report.md").write_text("\n".join(lines) + "\n")
    print(json.dumps(result["primary"], indent=2))


if __name__ == "__main__":
    main()
