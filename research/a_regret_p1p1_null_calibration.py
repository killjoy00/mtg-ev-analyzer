#!/usr/bin/env python3
"""Per-environment P1P1 null calibration for issue #756."""
from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path

import numpy as np

from a_regret_null_common import (
    assign_p1_a_scores,
    build_research_a_model_no_outcomes,
    frozen_half,
    load_module,
    normal_score_values,
    slice_name,
    stable_rng_seed,
)

REPS = 30
SIGMA = 2.18
SCENARIOS = (
    ("null", 0.0, 0.0),
    ("a_opt_tau_0.10", 0.10, 0.0),
    ("a_opt_tau_0.20", 0.20, 0.0),
    ("perturbed_s_0.05", 0.10, 0.05),
    ("perturbed_s_0.10", 0.10, 0.10),
    ("perturbed_s_0.20", 0.10, 0.20),
)
SLICES = ("<=0.02", "(0.02,0.05]", "(0.05,0.10]", ">0.10")


def args():
    p=argparse.ArgumentParser()
    p.add_argument("--expansion",required=True)
    p.add_argument("--draft-archive",type=Path,required=True)
    p.add_argument("--spent-ledger",type=Path,required=True)
    p.add_argument("--reserve-json",type=Path,required=True)
    p.add_argument("--frozen-analyzer",type=Path,required=True)
    p.add_argument("--retained-result-dir",type=Path,required=True)
    p.add_argument("--output-dir",type=Path,required=True)
    return p.parse_args()


def load_retained_rows(path: Path):
    rows=[]
    with gzip.open(path/"regret-rows.jsonl.gz","rt",encoding="utf-8") as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def validate_a(contexts, retained):
    by_id={r["draft_id"]:r for r in contexts}
    checked=0
    max_prob=max_margin=0.0
    for old in retained:
        row=by_id.get(str(old["draft_id"]))
        if row is None:
            raise SystemExit(f"retained row missing from context {old['draft_id']}")
        if row["a_card"] != old["a_card"]:
            raise SystemExit(f"A card mismatch {old['draft_id']}: {row['a_card']} != {old['a_card']}")
        dp=abs(float(row["a_probability"])-float(old["a_probability"]))
        dm=abs(float(row["a_margin"])-float(old["a_margin"]))
        max_prob=max(max_prob,dp); max_margin=max(max_margin,dm)
        if dp>1e-12 or dm>1e-12:
            raise SystemExit(f"A numeric mismatch {old['draft_id']} prob={dp} margin={dm}")
        checked+=1
    return {"checked_rows":checked,"max_abs_probability_diff":max_prob,"max_abs_margin_diff":max_margin}


def make_values(exp, scenario, rep, raw_scores):
    name,tau,s=scenario
    base={c:0.0 for c in raw_scores} if tau==0 else normal_score_values(raw_scores,tau)
    if s:
        rng=np.random.default_rng(stable_rng_seed("756-null-v1",exp,name,rep,"card"))
        for card in sorted(base):
            base[card]+=float(rng.normal(0.0,s))
    return base


def make_outcomes(exp, scenario_name, rep, contexts, values):
    rng=np.random.default_rng(stable_rng_seed("756-null-v1",exp,scenario_name,rep,"draft"))
    out={}
    for row in contexts:
        did=row["draft_id"]
        out[did]=float(values[row["historical_pick"]]+rng.normal(0.0,SIGMA))
    return out


def empty_metric():
    return {
        "n":0,"sum_est":0.0,"sum_true":0.0,"disagree":0,
        "slices":{k:{"n":0,"sum_est":0.0} for k in SLICES},
    }


def add_row(metric,row,est,true,best):
    metric["n"]+=1
    metric["sum_est"]+=float(est)
    metric["sum_true"]+=float(true)
    metric["disagree"]+=int(best!=row["a_card"])
    sl=slice_name(float(row["a_margin"]))
    metric["slices"][sl]["n"]+=1
    metric["slices"][sl]["sum_est"]+=float(est)


def main():
    a=args(); exp=a.expansion; a.output_dir.mkdir(parents=True,exist_ok=True)
    mod=load_module(a.frozen_analyzer,f"frozen_p1_{exp}")
    excluded,train_ids,_ledger,_source=mod.load_prior(a.spent_ledger,a.reserve_json,exp)
    contexts,invalid=mod.read_contexts_no_outcomes(a.draft_archive,exp,excluded)
    if len(contexts)!=mod.EXPECTED_UNUSED[exp]:
        raise SystemExit(f"{exp}: context count mismatch {len(contexts)} != {mod.EXPECTED_UNUSED[exp]} invalid={invalid}")

    model,a_meta=build_research_a_model_no_outcomes(
        a.draft_archive,None,train_ids,exp,need_colour_fit=False
    )
    raw_scores=assign_p1_a_scores(contexts,model)

    retained=load_retained_rows(a.retained_result_dir)
    a_check=validate_a(contexts,retained)

    fs_by_fold={}
    support_stats={}
    rows_by_fold={}
    for fold in range(mod.FOLDS):
        training=[r for r in contexts if r["fold"]!=fold]
        held=[r for r in contexts if r["fold"]==fold]
        supported,appearances,takes=mod.support_for(training)
        fs=mod.first_stage(training,supported)
        if not fs["diagnostics"]["gate"]:
            raise SystemExit(f"{exp} fold {fold}: frozen P1 identification gate failed")
        fs_by_fold[fold]=fs
        support_stats[fold]=(appearances,takes)
        rows_by_fold[fold]=(training,held)

    # Existing-artifact take-rate audit. No real outcome is opened.
    take_pairs=[]
    for old in retained:
        if not bool(old["a_iv_disagree"]):
            continue
        fold=int(old["fold"])
        appearances,takes=support_stats[fold]
        ac=old["a_card"]; bc=old["iv_best_card"]
        ar=float(takes[ac]/appearances[ac])
        br=float(takes[bc]/appearances[bc])
        take_pairs.append({"a_rate":ar,"iv_rate":br,"diff":br-ar})

    # Fixed half fits for the independent-selection design.
    half_rows={h:[r for r in contexts if frozen_half(r["draft_id"])==h] for h in (0,1)}
    half_fs={}
    for h in (0,1):
        supported,_ap,_tk=mod.support_for(half_rows[h])
        half_fs[h]=mod.first_stage(half_rows[h],supported)

    rep_results={}
    rep0_null_rows=[]
    for scenario in SCENARIOS:
        name=scenario[0]
        rep_results[name]=[]
        for rep in range(REPS):
            values=make_values(exp,scenario,rep,raw_scores)
            outcomes=make_outcomes(exp,name,rep,contexts,values)
            metric=empty_metric()
            if name=="null" and rep==0:
                local_rep0=[]
            for fold in range(mod.FOLDS):
                training,held=rows_by_fold[fold]
                fs=fs_by_fold[fold]
                _intercept,beta=mod.second_stage(training,fs,outcomes)
                supported=set(fs["cards"])
                for row in held:
                    ac=row["a_card"]
                    if ac not in supported:
                        continue
                    offered=[c for c in row["candidates"] if c in supported]
                    if not offered:
                        continue
                    best=min(offered,key=lambda c:(-beta[c],c))
                    est=max(0.0,float(beta[best]-beta[ac]))
                    true_best=max(float(values[c]) for c in offered)
                    true=max(0.0,true_best-float(values[ac]))
                    add_row(metric,row,est,true,best)
                    if name=="null" and rep==0:
                        local_rep0.append({"draft_id":row["draft_id"],"regret":est})
            # Independent selection/evaluation halves.
            half_beta={}
            for h in (0,1):
                _i,half_beta[h]=mod.second_stage(half_rows[h],half_fs[h],outcomes)
            pg_n=0; pg_est=0.0; pg_true=0.0
            common=set(half_fs[0]["cards"]) & set(half_fs[1]["cards"])
            for eval_half in (0,1):
                select_half=1-eval_half
                bsel=half_beta[select_half]; beval=half_beta[eval_half]
                for row in half_rows[eval_half]:
                    ac=row["a_card"]
                    if ac not in common:
                        continue
                    offered=[c for c in row["candidates"] if c in common]
                    if not offered:
                        continue
                    bc=min(offered,key=lambda c:(-bsel[c],c))
                    pg_n+=1
                    pg_est+=float(beval[bc]-beval[ac])
                    pg_true+=float(values[bc]-values[ac])
            metric["power_design"]={"n":pg_n,"sum_est_gain":pg_est,"sum_true_gain":pg_true}
            rep_results[name].append(metric)
            if name=="null" and rep==0:
                rep0_null_rows=local_rep0

    # Take-rate pairs are retained as a compact gzip for exact pooled medians.
    with gzip.open(a.output_dir/"take-rate-pairs.jsonl.gz","wt",encoding="utf-8") as f:
        for row in take_pairs:
            f.write(json.dumps(row,separators=(",",":"))+"\n")
    with gzip.open(a.output_dir/"null-rep0-rows.jsonl.gz","wt",encoding="utf-8") as f:
        for row in rep0_null_rows:
            f.write(json.dumps(row,separators=(",",":"))+"\n")

    out={
        "issue":756,
        "phase":"p1p1_null_calibration_environment",
        "expansion":exp,
        "replicates":REPS,
        "sigma":SIGMA,
        "outcome_columns_read":[],
        "a_reconstruction":a_meta,
        "a_validation":a_check,
        "contexts":len(contexts),
        "retained_scored_rows":len(retained),
        "take_rate_disagreement_rows":len(take_pairs),
        "scenarios":rep_results,
    }
    (a.output_dir/"p1-null-environment.json").write_text(json.dumps(out,indent=2,sort_keys=True)+"\n")
    print(json.dumps({
        "expansion":exp,
        "a_validation":a_check,
        "contexts":len(contexts),
        "take_pairs":len(take_pairs),
        "scenario_means":{k:float(np.mean([r["sum_est"]/r["n"] for r in v])) for k,v in rep_results.items()},
    },indent=2,sort_keys=True))


if __name__=="__main__":
    main()
