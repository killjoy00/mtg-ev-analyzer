#!/usr/bin/env python3
"""#756 null calibration for the frozen P1P1 regret estimator.

Hard safety boundary: this file never indexes, parses, or names the draft
event-match outcome column. Target outcomes are synthetic only.

The frozen #756 analyzer is imported at runtime. Its support, folds, first
stage, second stage, penalties, and regret definition are called unchanged.
Only the outcome dictionary passed to second_stage() is synthetic.
"""
from __future__ import annotations

import argparse, csv, gzip, hashlib, importlib.util, json, math
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.stats import norm

SIGMA = 2.18
REPS = 20
POWER_SALT = "a-regret-power-v1:"
SCENARIOS = (
    ("a_zero", 0.0, None),
    ("b_tau_010", 0.10, 0.0),
    ("b_tau_020", 0.20, 0.0),
    ("c_tau_010_s005", 0.10, 0.05),
    ("c_tau_010_s010", 0.10, 0.10),
    ("c_tau_010_s020", 0.10, 0.20),
)
MARGIN_SLICES = ("<=0.02", "(0.02,0.05]", "(0.05,0.10]", ">0.10")


def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument("--frozen-analyzer",type=Path,required=True)
    p.add_argument("--expansion",required=True)
    p.add_argument("--draft-archive",type=Path,required=True)
    p.add_argument("--game-archive",type=Path,required=True)
    p.add_argument("--spent-ledger",type=Path,required=True)
    p.add_argument("--reserve-json",type=Path,required=True)
    p.add_argument("--original-regret-rows",type=Path,required=True)
    p.add_argument("--output-dir",type=Path,required=True)
    return p.parse_args()


def load_module(path):
    spec=importlib.util.spec_from_file_location("frozen_a_regret_p1p1",path)
    mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


def safe_training_decisions(mod,path,keep_ids,expansion):
    """Reconstruct Decision objects without accessing the forbidden target field."""
    from contextual_value.dataset import Decision,_count,_games_lower_bound,_int,_number
    out={}
    keep=set(map(str,keep_ids))
    with gzip.open(path,"rt",encoding="utf-8",newline="") as f:
        reader=csv.reader(f); header=tuple(next(reader)); pos={n:i for i,n in enumerate(header)}
        required=("draft_id","event_type","pick","pack_number","pick_number",
                  "user_game_win_rate_bucket","user_n_games_bucket")
        missing=[n for n in required if n not in pos]
        if missing: raise SystemExit(f"safe loader missing columns {missing}")
        pack_cols=[(n[len("pack_card_"):],i) for i,n in enumerate(header) if n.startswith("pack_card_")]
        pool_cols=[(n[len("pool_"):],i) for i,n in enumerate(header) if n.startswith("pool_")]
        for values in reader:
            if len(values)!=len(header): continue
            did=values[pos["draft_id"]].strip()
            if did not in keep: continue
            event=values[pos["event_type"]].strip()
            if event!="PremierDraft": continue
            pack=_int(values[pos["pack_number"]]); pick=_int(values[pos["pick_number"]])
            selected=values[pos["pick"]].strip()
            rate=_number(values[pos["user_game_win_rate_bucket"]]); games=_games_lower_bound(values[pos["user_n_games_bucket"]])
            if pack is None or pick is None or not selected or rate is None or games is None or not 0<=rate<=1: continue
            candidates=tuple(card for card,i in pack_cols if _count(values[i])>0)
            if not candidates or selected not in candidates or len(candidates)!=len(set(candidates)): continue
            pool=tuple(sorted((card,n) for card,i in pool_cols if (n:=_count(values[i]))>0))
            d=Decision(
                draft_id=did,expansion=expansion,event_type=event,
                draft_time=values[pos["draft_time"]].strip() if "draft_time" in pos else "",
                rank=values[pos["rank"]].strip() if "rank" in pos else "",
                pack_number=pack,pick_number=pick,selected_card=selected,
                candidates=candidates,pool=pool,user_game_win_rate=float(rate),
                user_games_lower_bound=int(games),event_match_wins=0,event_match_losses=None,
            )
            prior=out.get(d.decision_id)
            if prior is not None and prior!=d: raise SystemExit(f"conflicting safe context {d.decision_id}")
            out[d.decision_id]=d
    seen={d.draft_id for d in out.values()}
    if seen!=keep:
        raise SystemExit(f"safe A training load mismatch missing={len(keep-seen)} extra={len(seen-keep)}")
    return sorted(out.values(),key=lambda d:(d.draft_id,d.pack_number,d.pick_number))


def build_a_without_target(mod,draft_archive,game_archive,expansion,train_ids,contexts):
    train=safe_training_decisions(mod,draft_archive,train_ids,expansion)
    games=mod.GameStore.from_archive(game_archive,train_ids)
    provider=mod.ArchiveSignalProvider(train,games)
    artifacts=provider.artifacts(train_ids,expansion)
    model=artifacts.strong_model
    if model is None: raise SystemExit("strong model unavailable")
    all_cards=sorted({c for r in contexts for c in r["candidates"]})
    raw={c:float(model.card_tendency(c,0,0,{})) for c in all_cards}
    for row in contexts:
        local=[(c,max(0.0,raw.get(c,0.0))) for c in row["candidates"]]
        total=sum(v for _,v in local)
        probs={c:(1.0/len(local) if total<=0 else v/total) for c,v in local}
        ranked=sorted(probs,key=lambda c:(-probs[c],c))
        row["a_card"]=ranked[0]
        row["a_probability"]=float(probs[ranked[0]])
        row["a_margin"]=float(probs[ranked[0]]-probs[ranked[1]]) if len(ranked)>1 else 1.0
    ordered=sorted(all_cards,key=lambda c:(-raw[c],c))
    n=len(ordered)
    normal_score={}
    for j,c in enumerate(ordered,1):
        q=(n+1-j)/(n+1)
        normal_score[c]=float(norm.ppf(q))
    return {
        "training_ids":len(train_ids),"strong_ids":len(artifacts.strong_ids),
        "cards_scored":len(all_cards),"raw":raw,"normal_score":normal_score,
    }


def margin_slice(x):
    if x<=0.02: return "<=0.02"
    if x<=0.05: return "(0.02,0.05]"
    if x<=0.10: return "(0.05,0.10]"
    return ">0.10"


def stable_seed(*parts):
    h=hashlib.sha256("|".join(map(str,parts)).encode()).digest()
    return int.from_bytes(h[:8],"big") & 0x7FFF_FFFF_FFFF_FFFF


def half_of(did):
    h=hashlib.sha256((POWER_SALT+did).encode()).digest()
    return int.from_bytes(h[:8],"big")%2


def make_values(cards,normal_score,name,tau,s,rep,expansion):
    if name=="a_zero":
        return {c:0.0 for c in cards}
    v={c:tau*normal_score[c] for c in cards}
    if s and s>0:
        rng=np.random.default_rng(stable_seed("card-noise",expansion,name,rep))
        eps=rng.normal(0.0,s,size=len(cards))
        for c,e in zip(cards,eps): v[c]+=float(e)
    return v


def original_a_verification(path,by_id):
    n=bad_card=bad_margin=0
    with gzip.open(path,"rt",encoding="utf-8") as f:
        for line in f:
            if not line.strip(): continue
            r=json.loads(line); did=str(r["draft_id"])
            x=by_id.get(did)
            if x is None: continue
            n+=1
            bad_card+=int(x["a_card"]!=r["a_card"])
            bad_margin+=int(abs(float(x["a_margin"])-float(r["a_margin"]))>1e-12)
    return {"compared":n,"a_card_mismatches":bad_card,"a_margin_mismatches":bad_margin}


def take_rate_comparison(mod,contexts,fs_by_fold,original_rows):
    by_id={r["draft_id"]:r for r in contexts}
    # training-complement rates are fold-specific and outcome-free
    rates={}
    for fold in range(mod.FOLDS):
        training=[r for r in contexts if r["fold"]!=fold]
        _,app,takes=mod.support_for(training)
        rates[fold]=(app,takes)
    n=0; best=[]; aa=[]; diff=[]; best_lower=0
    with gzip.open(original_rows,"rt",encoding="utf-8") as f:
        for line in f:
            if not line.strip(): continue
            r=json.loads(line)
            if not r.get("a_iv_disagree"): continue
            fold=int(r["fold"]); a=str(r["a_card"]); b=str(r["iv_best_card"])
            app,takes=rates[fold]
            if app[a]<=0 or app[b]<=0: continue
            ar=takes[a]/app[a]; br=takes[b]/app[b]
            n+=1; aa.append(ar); best.append(br); diff.append(br-ar); best_lower+=int(br<ar)
    return {
        "n":n,
        "mean_take_rate_iv_best":float(np.mean(best)),
        "mean_take_rate_a":float(np.mean(aa)),
        "mean_pair_difference":float(np.mean(diff)),
        "median_pair_difference":float(np.median(diff)),
        "iv_best_lower_take_rate_fraction":best_lower/n if n else None,
    }


def fit_half(mod,rows,outcomes):
    supported,_,_=mod.support_for(rows)
    fs=mod.first_stage(rows,supported)
    if not fs["diagnostics"]["gate"]:
        raise SystemExit("power half failed frozen identification gate")
    _,beta=mod.second_stage(rows,fs,outcomes)
    return fs,beta


def power_crossfit(mod,contexts,outcomes,v):
    halves=[[r for r in contexts if half_of(r["draft_id"])==h] for h in (0,1)]
    fits=[fit_half(mod,halves[h],outcomes) for h in (0,1)]
    est_sum=true_sum=n=0
    for select_h,eval_h in ((0,1),(1,0)):
        fs_s,beta_s=fits[select_h]; fs_e,beta_e=fits[eval_h]
        sup_s=set(fs_s["cards"]); sup_e=set(fs_e["cards"])
        for row in halves[eval_h]:
            a=row["a_card"]
            if a not in sup_s or a not in sup_e: continue
            offered=[c for c in row["candidates"] if c in sup_s]
            if not offered: continue
            b=min(offered,key=lambda c:(-beta_s[c],c))
            if b not in sup_e: continue
            est_sum+=beta_e[b]-beta_e[a]
            true_sum+=v[b]-v[a]
            n+=1
    return {"n":n,"estimate":est_sum/n,"true_gain":true_sum/n,"bias":(est_sum-true_sum)/n}


def main():
    args=parse_args(); args.output_dir.mkdir(parents=True,exist_ok=True)
    mod=load_module(args.frozen_analyzer); exp=args.expansion
    excluded,train_ids,ledger_rows,train_source=mod.load_prior(args.spent_ledger,args.reserve_json,exp)
    contexts,invalid=mod.read_contexts_no_outcomes(args.draft_archive,exp,excluded)
    if len(contexts)!=mod.EXPECTED_UNUSED[exp]:
        raise SystemExit(f"cohort mismatch {len(contexts)} vs {mod.EXPECTED_UNUSED[exp]}")
    ameta=build_a_without_target(mod,args.draft_archive,args.game_archive,exp,train_ids,contexts)
    by_id={r["draft_id"]:r for r in contexts}
    verify=original_a_verification(args.original_regret_rows,by_id)
    if verify["a_card_mismatches"] or verify["a_margin_mismatches"]:
        raise SystemExit(f"safe A did not reproduce original artifact: {verify}")

    fs_by_fold={}
    for fold in range(mod.FOLDS):
        training=[r for r in contexts if r["fold"]!=fold]
        supported,_,_=mod.support_for(training)
        fs=mod.first_stage(training,supported)
        if not fs["diagnostics"]["gate"]: raise SystemExit(f"{exp} fold {fold} gate failed")
        fs_by_fold[fold]=fs

    tr=take_rate_comparison(mod,contexts,fs_by_fold,args.original_regret_rows)
    cards=sorted(ameta["normal_score"])
    scenario_results={}
    rep0_regrets={}

    for name,tau,s in SCENARIOS:
        reps=[]
        for rep in range(REPS):
            v=make_values(cards,ameta["normal_score"],name,tau,s,rep,exp)
            rng=np.random.default_rng(stable_seed("draft-noise",exp,name,rep))
            # one P1P1 row per draft
            outcomes={}
            for row,e in zip(contexts,rng.normal(0.0,SIGMA,size=len(contexts))):
                outcomes[row["draft_id"]]=float(v[row["historical_pick"]]+e)

            est_sum=true_sum=0.0; n=dis=0
            slices={k:[0.0,0] for k in MARGIN_SLICES}
            rep_rows=[]
            for fold in range(mod.FOLDS):
                training=[r for r in contexts if r["fold"]!=fold]
                held=[r for r in contexts if r["fold"]==fold]
                fs=fs_by_fold[fold]
                _,beta=mod.second_stage(training,fs,outcomes)
                supported=set(fs["cards"])
                for row in held:
                    a=row["a_card"]
                    if a not in supported: continue
                    offered=[c for c in row["candidates"] if c in supported]
                    if not offered: continue
                    best=min(offered,key=lambda c:(-beta[c],c))
                    regret=max(0.0,beta[best]-beta[a])
                    true_best=min(offered,key=lambda c:(-v[c],c))
                    true_regret=max(0.0,v[true_best]-v[a])
                    est_sum+=regret; true_sum+=true_regret; n+=1; dis+=int(best!=a)
                    sl=margin_slice(row["a_margin"]); slices[sl][0]+=regret; slices[sl][1]+=1
                    if rep==0: rep_rows.append(regret)

            p=power_crossfit(mod,contexts,outcomes,v)
            reps.append({
                "rep":rep,"n":n,"est_mean":est_sum/n,"true_mean":true_sum/n,
                "disagreement_rate":dis/n,
                "margin_means":{k:(v0/c if c else None) for k,(v0,c) in slices.items()},
                "power_crossfit":p,
            })
            if rep==0: rep0_regrets[name]=np.asarray(rep_rows,dtype=np.float32)

        scenario_results[name]={"tau":tau,"card_noise_sd":s,"reps":reps}

    np.savez_compressed(args.output_dir/"rep0-regrets.npz",**rep0_regrets)
    report={
        "phase":"a_regret_p1p1_null_calibration_set",
        "issue":756,"expansion":exp,"synthetic_outcomes_only":True,
        "forbidden_target_field_accessed":False,
        "sigma":SIGMA,"replicates":REPS,
        "cohort":{"rows":len(contexts),"excluded_ids":len(excluded),"invalid":invalid},
        "safe_a_reproduction":verify,
        "a":{"training_ids":ameta["training_ids"],"strong_ids":ameta["strong_ids"],"cards_scored":ameta["cards_scored"],
             "normal_score_formula":"Phi^-1((N+1-r)/(N+1)); r=1 is highest frozen A raw card tendency; card-name tie break"},
        "take_rate_comparison_existing_artifact":tr,
        "scenarios":scenario_results,
    }
    (args.output_dir/"p1-null-set.json").write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps({
        "expansion":exp,"safe_a":verify,"take_rate":tr,
        "scenario_means":{k:float(np.mean([x["est_mean"] for x in v["reps"]])) for k,v in scenario_results.items()},
    },indent=2,sort_keys=True))


if __name__=="__main__": main()
