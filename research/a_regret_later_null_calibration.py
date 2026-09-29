#!/usr/bin/env python3
"""Per-environment P1P2-P1P8 pure-noise null calibration for #756."""
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import numpy as np

from a_regret_null_common import (
    build_research_a_model_no_outcomes,
    load_module,
    slice_name,
    stable_rng_seed,
)

REPS=12
SIGMA=2.18
SLICES=("<=0.02","(0.02,0.05]","(0.05,0.10]",">0.10")


def args():
    p=argparse.ArgumentParser()
    p.add_argument("--expansion",required=True)
    p.add_argument("--draft-archive",type=Path,required=True)
    p.add_argument("--game-archive",type=Path,required=True)
    p.add_argument("--spent-ledger",type=Path,required=True)
    p.add_argument("--reserve-json",type=Path,required=True)
    p.add_argument("--frozen-analyzer",type=Path,required=True)
    p.add_argument("--retained-result-dir",type=Path,required=True)
    p.add_argument("--output-dir",type=Path,required=True)
    return p.parse_args()


def validate_a(by_pick, retained_dir):
    lookup={}
    for pick,rows in by_pick.items():
        for row in rows:
            lookup[(row["draft_id"],int(pick))]=row
    checked=0; maxp=maxm=0.0
    with gzip.open(retained_dir/"later-regret-rows.jsonl.gz","rt",encoding="utf-8") as f:
        for line in f:
            if not line.strip(): continue
            old=json.loads(line)
            key=(str(old["draft_id"]),int(old["pick_number"]))
            row=lookup.get(key)
            if row is None:
                raise SystemExit(f"retained later row missing {key}")
            if row["a_card"]!=old["a_card"]:
                raise SystemExit(f"later A card mismatch {key}: {row['a_card']} != {old['a_card']}")
            dp=abs(float(row["a_probability"])-float(old["a_probability"]))
            dm=abs(float(row["a_margin"])-float(old["a_margin"]))
            maxp=max(maxp,dp); maxm=max(maxm,dm)
            if dp>1e-12 or dm>1e-12:
                raise SystemExit(f"later A numeric mismatch {key}: prob={dp} margin={dm}")
            checked+=1
    return {"checked_rows":checked,"max_abs_probability_diff":maxp,"max_abs_margin_diff":maxm}


def empty_metric():
    return {"n":0,"sum_est":0.0,"disagree":0,"slices":{k:{"n":0,"sum_est":0.0} for k in SLICES}}


def main():
    a=args(); exp=a.expansion; a.output_dir.mkdir(parents=True,exist_ok=True)
    mod=load_module(a.frozen_analyzer,f"frozen_later_{exp}")
    excluded,train_ids,_ledger,_source=mod.load_prior(a.spent_ledger,a.reserve_json,exp)

    model,a_meta=build_research_a_model_no_outcomes(
        a.draft_archive,a.game_archive,train_ids,exp,need_colour_fit=True
    )
    by_pick,invalid=mod.scan_contexts(a.draft_archive,exp,excluded,model)

    a_check=validate_a(by_pick,a.retained_result_dir)

    fit_by_cell={}
    all_ids=set()
    gate_summary={}
    for pick in mod.PICKS:
        rows=by_pick[pick]
        all_ids.update(r["draft_id"] for r in rows)
        gate_summary[str(pick)]=[]
        for fold in range(mod.FOLDS):
            training=[r for r in rows if r["fold"]!=fold]
            held=[r for r in rows if r["fold"]==fold]
            supported,pool_features=mod.support_and_pool_features(training)
            fit=mod.build_outcome_free_stats(training,supported,pool_features)
            held_diag=mod.heldout_recenter_diagnostics(held,fit)
            gate=mod.gate_fit(fit,held_diag)
            if not gate:
                raise SystemExit(f"{exp} P1P{pick+1} fold {fold}: frozen recentering gate failed")
            fit_by_cell[(pick,fold)]=fit
            gate_summary[str(pick)].append({
                "fold":fold,
                "supported_cards":fit["diagnostics"]["supported_cards"],
                "rank_fraction":fit["diagnostics"]["rank_fraction"],
                "own_first_stage_median":fit["diagnostics"]["own_first_stage_median"],
                "own_first_stage_p10":fit["diagnostics"]["own_first_stage_p10"],
                **held_diag,
            })

    rep_results=[]
    ids_sorted=sorted(all_ids)
    for rep in range(REPS):
        rng=np.random.default_rng(stable_rng_seed("756-null-v1",exp,"later_null",rep,"draft"))
        outcomes={did:float(rng.normal(0.0,SIGMA)) for did in ids_sorted}
        metric=empty_metric()
        by_pick_metric={}
        for pick in mod.PICKS:
            rows=by_pick[pick]
            pm=empty_metric()
            for fold in range(mod.FOLDS):
                training=[r for r in rows if r["fold"]!=fold]
                held=[r for r in rows if r["fold"]==fold]
                fit=fit_by_cell[(pick,fold)]
                beta,gamma=mod.second_stage(training,fit,outcomes)
                scored,_unsupported=mod.score_held(held,fit,beta,gamma,exp,pick)
                for row in scored:
                    est=float(row["regret"])
                    for target in (metric,pm):
                        target["n"]+=1
                        target["sum_est"]+=est
                        target["disagree"]+=int(bool(row["a_iv_disagree"]))
                        sl=slice_name(float(row["a_margin"]))
                        target["slices"][sl]["n"]+=1
                        target["slices"][sl]["sum_est"]+=est
            by_pick_metric[str(pick)]=pm
        metric["by_pick"]=by_pick_metric
        rep_results.append(metric)

    out={
        "issue":756,
        "phase":"later_pick_null_calibration_environment",
        "expansion":exp,
        "replicates":REPS,
        "sigma":SIGMA,
        "outcome_columns_read":[],
        "a_reconstruction":a_meta,
        "a_validation":a_check,
        "unique_draft_ids":len(all_ids),
        "invalid_context_rows":invalid,
        "gate_summary":gate_summary,
        "replicate_results":rep_results,
    }
    (a.output_dir/"later-null-environment.json").write_text(json.dumps(out,indent=2,sort_keys=True)+"\n")
    print(json.dumps({
        "expansion":exp,
        "a_validation":a_check,
        "unique_draft_ids":len(all_ids),
        "mean_null_statistic":float(np.mean([r["sum_est"]/r["n"] for r in rep_results])),
        "eligible_decisions":rep_results[0]["n"],
    },indent=2,sort_keys=True))


if __name__=="__main__":
    main()
