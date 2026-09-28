#!/usr/bin/env python3
"""Spent-20k diagnostic: single hashed vs all-eligible draft-weighted variance.

This does not alter the registered Q/Guard-10 confirmation result.
"""
from __future__ import annotations

import argparse
import json
import pickle
import sys
from pathlib import Path

import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
sys.path.insert(0,str(ROOT/"research"))

from contextual_value import PRIMARY_PACK, PRIMARY_PICK_START, PRIMARY_PICK_STOP
from contextual_value.archive import ArchiveSignalProvider, GameStore, load_decisions
from contextual_value.features import model_feature_map, strong_choice_offsets
from contextual_value.nuisance import build_fold_training_rows
from contextual_value_draft_weighted_ope import (
    evaluate_draft_weighted, paired_delta, stable_hashed_indices,
)
from contextual_value_phase_a_features import _fetch_rich_set
import contextual_value_four_way_fresh as fresh
import contextual_value_q_guard10_20k_confirmation as confirm

EXPECTED_FINGERPRINT="d1f3cb78d1674b1424805b33637c89d3f3977baa890db61ff534fa7700cb5f33"


def parse_args():
    p=argparse.ArgumentParser()
    p.add_argument("--expansion",required=True)
    p.add_argument("--draft-archive",type=Path,required=True)
    p.add_argument("--game-archive",type=Path,required=True)
    p.add_argument("--expected-draft-sha256",required=True)
    p.add_argument("--expected-game-sha256",required=True)
    p.add_argument("--cohort-manifest",type=Path,required=True)
    p.add_argument("--freeze-json",type=Path,required=True)
    p.add_argument("--freeze-q-pickle",type=Path,required=True)
    p.add_argument("--retained-confirmation",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    return p.parse_args()


def metadata(expansion,decisions):
    wanted=set()
    for d in decisions:
        if int(d.pack_number)!=PRIMARY_PACK or not (PRIMARY_PICK_START<=int(d.pick_number)<PRIMARY_PICK_STOP):
            continue
        wanted.update(d.candidates)
        wanted.update(name for name,_ in d.pool)
    resolved,unresolved=_fetch_rich_set(expansion,wanted)
    coverage=len(resolved)/max(1,len(wanted))
    if coverage<0.98:
        raise SystemExit(f"metadata coverage {coverage:.2%} below threshold")
    return resolved,unresolved,coverage


def main():
    args=parse_args()
    if fresh.sha256(args.draft_archive)!=args.expected_draft_sha256:
        raise SystemExit("draft hash mismatch")
    if fresh.sha256(args.game_archive)!=args.expected_game_sha256:
        raise SystemExit("game hash mismatch")
    cohort=json.loads(args.cohort_manifest.read_text())
    retained=json.loads(args.retained_confirmation.read_text())
    freeze=json.loads(args.freeze_json.read_text())
    if freeze.get("fingerprint_sha256")!=EXPECTED_FINGERPRINT:
        raise SystemExit("freeze fingerprint mismatch")
    if retained.get("phase")!="q_guard10_20k_confirmation_environment":
        raise SystemExit("retained confirmation mismatch")
    train_ids=frozenset(str(x) for x in cohort["prior_train_ids"])
    confirm_ids=frozenset(str(x) for x in cohort["confirmation_ids"])
    if len(confirm_ids)!=5000 or train_ids & confirm_ids:
        raise SystemExit("cohort boundary mismatch")

    with args.freeze_q_pickle.open("rb") as fh:
        q_model=pickle.load(fh)
    decisions=load_decisions(args.draft_archive,keep_ids=train_ids|confirm_ids)
    train=[d for d in decisions if str(d.draft_id) in train_ids]
    conf=[d for d in decisions if str(d.draft_id) in confirm_ids]
    games=GameStore.from_archives([args.game_archive],train_ids)
    provider=ArchiveSignalProvider(decisions,games)
    meta,unresolved,coverage=metadata(args.expansion,[*train,*conf])
    train_rows=build_fold_training_rows(train,train_ids,signal_provider=provider,inner_feature_folds=fresh.INNER_FEATURE_FOLDS)
    behavior_model,_=fresh._fit_propensity(train_rows,True)

    rows=[]
    for d in conf:
        if int(d.pack_number)!=PRIMARY_PACK or not (PRIMARY_PICK_START<=int(d.pick_number)<PRIMARY_PICK_STOP):
            continue
        signals=provider(d,train_ids)
        features=model_feature_map(d,signals)
        state,scores,qsimple=fresh._score_decision(d,features,meta,freeze,q_model)
        names=list(d.candidates)
        behavior=behavior_model.probabilities(fresh._drop_strong_map(features),strong_choice_offsets(signals,d.candidates))
        alead=fresh._argmax(scores["A"],names)
        qlead=fresh._argmax(scores["Q"],names)
        qadv=float(scores["Q"][qlead]-scores["Q"][alead])
        use_q=(qlead!=alead and qadv>=confirm.GUARD_THRESHOLD and float(behavior[names[qlead]])>=confirm._support_floor(len(names)))
        glead=qlead if use_q else alead
        rows.append({
            "draft_id":str(d.draft_id),
            "decision_id":f"{d.draft_id}:{int(d.pack_number)}:{int(d.pick_number)}",
            "pack":int(d.pack_number),
            "pick":int(d.pick_number),
            "selected":names.index(d.selected_card),
            "outcome":float(d.event_match_wins),
            "behavior":np.asarray([float(behavior[name]) for name in names],dtype=np.float64),
            "q":np.asarray(qsimple,dtype=np.float64),
            "A":int(alead),"Q":int(qlead),"guard_010":int(glead),
        })
    if len(set(r["draft_id"] for r in rows))!=5000:
        raise SystemExit("all-eligible scoring did not cover all 5000 drafts")

    offsets=np.zeros(len(rows)+1,dtype=np.int64)
    offsets[1:]=np.cumsum([len(r["behavior"]) for r in rows])
    behavior=np.concatenate([r["behavior"] for r in rows])
    q=np.concatenate([r["q"] for r in rows])
    selected=np.asarray([r["selected"] for r in rows],dtype=np.int64)
    outcome=np.asarray([r["outcome"] for r in rows],dtype=np.float64)
    drafts=np.asarray([r["draft_id"] for r in rows])
    decisions_id=np.asarray([r["decision_id"] for r in rows])
    pack=np.asarray([r["pack"] for r in rows],dtype=np.int16)
    pick=np.asarray([r["pick"] for r in rows],dtype=np.int16)
    all_idx=np.arange(len(rows),dtype=np.int64)
    hashed=stable_hashed_indices(decisions_id,drafts,all_idx)
    targets={label:np.asarray([r[label] for r in rows],dtype=np.int64) for label in ("A","Q","guard_010")}

    result={}
    for label in ("Q","guard_010"):
        pieces={}
        for mode,idx in (("single_hashed",hashed),("all_eligible",all_idx)):
            aest,aterms=evaluate_draft_weighted(
                offsets=offsets,selected_ord=selected,target_ord=targets["A"],outcome=outcome,
                behavior=behavior,q_values=q,draft_ids=drafts,decision_indices=idx,cap=20.0,
            )
            cest,cterms=evaluate_draft_weighted(
                offsets=offsets,selected_ord=selected,target_ord=targets[label],outcome=outcome,
                behavior=behavior,q_values=q,draft_ids=drafts,decision_indices=idx,cap=20.0,
            )
            delta=paired_delta(cterms,aterms)
            pieces[mode]={
                "n_drafts":len(delta),
                "n_decisions":int(len(idx)),
                "dr_delta":float(np.mean(delta)),
                "per_draft_delta_variance":float(np.var(delta,ddof=1)),
                "candidate_ess_ratio":float(cest.ess_ratio),
            }
        retained_dr=float(retained["comparisons_vs_A"][label]["20"]["dr"])
        parity=abs(pieces["single_hashed"]["dr_delta"]-retained_dr)
        if parity>1e-9:
            raise SystemExit(f"{label} hashed parity failure {parity}")
        pieces["single_hashed"]["retained_parity_error"]=parity
        pieces["variance_ratio_single_over_all"]=(
            pieces["single_hashed"]["per_draft_delta_variance"]/
            pieces["all_eligible"]["per_draft_delta_variance"]
            if pieces["all_eligible"]["per_draft_delta_variance"]>0 else None
        )
        result[label]=pieces

    report={
        "phase":"r_prerun_spent20k_variance_environment",
        "scope":"spent_20k_diagnostic_only",
        "registered_result_unchanged":True,
        "expansion":args.expansion,
        "drafts":5000,
        "eligible_decisions":len(rows),
        "eligible_decisions_per_draft_mean":len(rows)/5000,
        "metadata":{"coverage":coverage,"unresolved":unresolved},
        "comparisons":result,
    }
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
    print(json.dumps(report,indent=2,sort_keys=True))


if __name__=="__main__":
    main()
