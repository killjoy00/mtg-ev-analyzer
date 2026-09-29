#!/usr/bin/env python3
"""#756 synthetic-only null calibration for frozen P1P2-P1P8 estimator."""
from __future__ import annotations
import argparse, importlib.util, json
from pathlib import Path
import numpy as np

from a_regret_p1p1_null_calibration_756 import (
    SIGMA, safe_training_decisions, stable_seed, margin_slice, MARGIN_SLICES
)

REPS=10


def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument("--frozen-analyzer",type=Path,required=True)
    p.add_argument("--expansion",required=True)
    p.add_argument("--draft-archive",type=Path,required=True)
    p.add_argument("--game-archive",type=Path,required=True)
    p.add_argument("--spent-ledger",type=Path,required=True)
    p.add_argument("--reserve-json",type=Path,required=True)
    p.add_argument("--output-dir",type=Path,required=True)
    return p.parse_args()


def load_module(path):
    spec=importlib.util.spec_from_file_location("frozen_a_regret_later",path)
    mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


def build_model_without_target(mod,draft_archive,game_archive,expansion,train_ids):
    train=safe_training_decisions(mod,draft_archive,train_ids,expansion)
    games=mod.GameStore.from_archive(game_archive,train_ids)
    provider=mod.ArchiveSignalProvider(train,games)
    artifacts=provider.artifacts(train_ids,expansion)
    if artifacts.strong_model is None: raise SystemExit("later strong model unavailable")
    return artifacts.strong_model, {
        "training_ids":len(train_ids),"strong_ids":len(artifacts.strong_ids)
    }


def main():
    args=parse_args(); args.output_dir.mkdir(parents=True,exist_ok=True)
    mod=load_module(args.frozen_analyzer); exp=args.expansion
    excluded,train_ids,ledger_rows,train_source=mod.load_prior(args.spent_ledger,args.reserve_json,exp)
    model,a_meta=build_model_without_target(mod,args.draft_archive,args.game_archive,exp,train_ids)
    by_pick,invalid=mod.scan_contexts(args.draft_archive,exp,excluded,model)

    fit_by_cell={}; identified=set(); preflight={}
    all_ids=set()
    for pick in mod.PICKS:
        rows=by_pick[pick]; all_ids.update(r["draft_id"] for r in rows)
        ok=True; folds=[]
        for fold in range(mod.FOLDS):
            training=[r for r in rows if r["fold"]!=fold]
            held=[r for r in rows if r["fold"]==fold]
            supported,pool_features=mod.support_and_pool_features(training)
            fit=mod.build_outcome_free_stats(training,supported,pool_features)
            diag=mod.heldout_recenter_diagnostics(held,fit)
            gate=mod.gate_fit(fit,diag)
            fit_by_cell[(pick,fold)]=fit
            ok=ok and gate
            folds.append({"fold":fold,"gate":gate,**fit["diagnostics"],**diag})
        preflight[str(pick)]={"rows":len(rows),"all_fold_gates_pass":ok,"folds":folds}
        if ok: identified.add(pick)
    if identified!=set(mod.PICKS):
        raise SystemExit(f"{exp}: null calibration preflight did not identify all picks: {sorted(identified)}")

    reps=[]
    for rep in range(REPS):
        rng=np.random.default_rng(stable_seed("later-pure-noise",exp,rep))
        ids=sorted(all_ids); noise=rng.normal(0.0,SIGMA,size=len(ids))
        outcomes={did:float(y) for did,y in zip(ids,noise)}
        total=0.0; n=dis=0
        slices={k:[0.0,0] for k in MARGIN_SLICES}
        by_pick_summary={}
        for pick in mod.PICKS:
            pick_sum=pick_n=pick_dis=0
            rows=by_pick[pick]
            for fold in range(mod.FOLDS):
                training=[r for r in rows if r["fold"]!=fold]
                held=[r for r in rows if r["fold"]==fold]
                fit=fit_by_cell[(pick,fold)]
                beta,gamma=mod.second_stage(training,fit,outcomes)
                scored,_=mod.score_held(held,fit,beta,gamma,exp,pick)
                for r in scored:
                    regret=float(r["regret"]); total+=regret; n+=1; dis+=int(r["a_iv_disagree"])
                    pick_sum+=regret; pick_n+=1; pick_dis+=int(r["a_iv_disagree"])
                    sl=margin_slice(float(r["a_margin"])); slices[sl][0]+=regret; slices[sl][1]+=1
            by_pick_summary[str(pick)]={
                "n":pick_n,"mean":pick_sum/pick_n if pick_n else None,
                "disagreement_rate":pick_dis/pick_n if pick_n else None,
            }
        reps.append({
            "rep":rep,"n":n,"est_mean":total/n,"true_mean":0.0,
            "disagreement_rate":dis/n,
            "margin_means":{k:(s/c if c else None) for k,(s,c) in slices.items()},
            "by_pick":by_pick_summary,
        })

    report={
        "phase":"a_regret_later_null_calibration_set","issue":756,
        "expansion":exp,"synthetic_outcomes_only":True,"forbidden_target_field_accessed":False,
        "sigma":SIGMA,"replicates":REPS,"a":a_meta,
        "invalid_context_rows":invalid,"preflight":preflight,
        "reps":reps,
    }
    (args.output_dir/"later-null-set.json").write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps({
        "expansion":exp,"mean_null_statistic":float(np.mean([r["est_mean"] for r in reps])),
        "sd_null_statistic":float(np.std([r["est_mean"] for r in reps],ddof=1)),
        "all_picks_identified":True,
    },indent=2,sort_keys=True))


if __name__=="__main__": main()
