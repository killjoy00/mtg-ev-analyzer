#!/usr/bin/env python3
"""Post-result descriptive supplement: P1P1 replicate-0 regret rows for every frozen scenario.

Synthetic only. Does not alter #756's preregistered calibration decision rule.
"""
from __future__ import annotations
import argparse, json
from pathlib import Path
import numpy as np

from a_regret_null_common import (
    assign_p1_a_scores, build_research_a_model_no_outcomes, load_module,
)
from a_regret_p1p1_null_calibration import (
    SCENARIOS, make_values, make_outcomes,
)

def args():
    p=argparse.ArgumentParser()
    p.add_argument("--expansion",required=True)
    p.add_argument("--draft-archive",type=Path,required=True)
    p.add_argument("--spent-ledger",type=Path,required=True)
    p.add_argument("--reserve-json",type=Path,required=True)
    p.add_argument("--frozen-analyzer",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    return p.parse_args()

def main():
    a=args(); exp=a.expansion
    mod=load_module(a.frozen_analyzer,f"frozen_p1_boot_{exp}")
    excluded,train_ids,_ledger,_source=mod.load_prior(a.spent_ledger,a.reserve_json,exp)
    contexts,invalid=mod.read_contexts_no_outcomes(a.draft_archive,exp,excluded)
    if len(contexts)!=mod.EXPECTED_UNUSED[exp]:
        raise SystemExit(f"{exp}: cohort mismatch {len(contexts)} invalid={invalid}")
    model,meta=build_research_a_model_no_outcomes(a.draft_archive,None,train_ids,exp,need_colour_fit=False)
    raw_scores=assign_p1_a_scores(contexts,model)
    folds={}
    for fold in range(mod.FOLDS):
        tr=[r for r in contexts if r["fold"]!=fold]
        held=[r for r in contexts if r["fold"]==fold]
        supported,_ap,_tk=mod.support_for(tr)
        fs=mod.first_stage(tr,supported)
        if not fs["diagnostics"]["gate"]:
            raise SystemExit(f"{exp} fold {fold}: gate fail")
        folds[fold]=(tr,held,fs)
    arrays={}
    counts={}
    for scenario in SCENARIOS:
        name=scenario[0]
        values=make_values(exp,scenario,0,raw_scores)
        outcomes=make_outcomes(exp,name,0,contexts,values)
        vals=[]
        for fold in range(mod.FOLDS):
            tr,held,fs=folds[fold]
            _i,beta=mod.second_stage(tr,fs,outcomes)
            supported=set(fs["cards"])
            for row in held:
                ac=row["a_card"]
                if ac not in supported: continue
                offered=[c for c in row["candidates"] if c in supported]
                if not offered: continue
                bc=min(offered,key=lambda c:(-beta[c],c))
                vals.append(max(0.0,float(beta[bc]-beta[ac])))
        arrays[name]=np.asarray(vals,dtype=np.float32)
        counts[name]=len(vals)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    np.savez_compressed(a.output,**arrays)
    print(json.dumps({"expansion":exp,"outcome_columns_read":[],"a_reconstruction":meta,"counts":counts},indent=2,sort_keys=True))

if __name__=="__main__":
    main()
