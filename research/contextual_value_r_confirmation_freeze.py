#!/usr/bin/env python3
"""Outcome-free transfer freeze for exact frozen R-LCB on one fresh environment."""
from __future__ import annotations

import argparse,csv,hashlib,json,sys
from pathlib import Path
from types import SimpleNamespace
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"))
sys.path.insert(0,str(ROOT/"research"))

from contextual_value import PRIMARY_PACK,PRIMARY_PICK_START,PRIMARY_PICK_STOP
from contextual_value.archive import ArchiveSignalProvider,GameStore,load_decisions
from contextual_value.dataset import Decision,_count,_games_lower_bound,_int,_number,normalized_draft_weights
from contextual_value.features import model_feature_map,strong_choice_offsets
from contextual_value.nuisance import build_fold_training_rows
from contextual_value.outcome import RidgeOutcomeModel
from contextual_value.rich_features import rich_feature_bundle
from contextual_value.schema import open_text,validate_header
from contextual_value_phase_a_features import _fetch_rich_set
from contextual_value_candidate_advantage_r_common import (
    choose_r_lcb,fit_skill_interaction_behavior,predict_skill_interaction_behavior,
)
import contextual_value_four_way_fresh as fresh

EXPECTED_DRAFT={
 "FIN":"9d5b2a3e908bb8daf0ea6e951097714b651546370a5c852893dc90a1f2f6ab8b",
 "TDM":"831ba8bc4be5eabe140fac00a8e6eaded3f3f931685be8f91403ad9cfde5cbf5",
 "DFT":"7812d16e0de78ff7a69faf9981f7ff03be4dfc618a86f14369424ec2204580cd",
}
EXPECTED_GAME={
 "FIN":"f645f796e53b15c5ff6933bea295821294301237795b74a30243834eab4b60a6",
 "TDM":"e2e679638487f5885ce626de3fb2cf9ef15c4071d2cb9c8179d3c683ced76755",
 "DFT":"734325ea523077888939b5fa4e67d783bb67e744c1692ba46bc97b6be43cfc72",
}
R_BUNDLE_SHA="8191ef8ef3eb0de5cbd963392b5e11c86b31f82984ec39b8701e6b5c107ac520"
FEATURE_SHA="351698079ebf2d108f4647d579ce20827adcc26adfa74c0f6bb85824805b460a"
C=2.49

def sha256(path:Path)->str:
 h=hashlib.sha256()
 with path.open("rb") as f:
  for block in iter(lambda:f.read(1024*1024),b""):h.update(block)
 return h.hexdigest()

def id_sha(ids):
 h=hashlib.sha256()
 for x in sorted(map(str,ids)):h.update(x.encode());h.update(b"\n")
 return h.hexdigest()

def load_contexts_without_outcomes(path:Path,keep_ids:set[str],expansion:str):
 """Read pre-pick context + historical action only; never access outcome columns."""
 out={}
 with open_text(path) as handle:
  reader=csv.reader(handle); header=tuple(next(reader)); validate_header(header,"draft")
  pos={n:i for i,n in enumerate(header)}
  draft_at=pos["draft_id"]; pack_cols=[(c[len("pack_card_"):],i) for i,c in enumerate(header) if c.startswith("pack_card_")]
  pool_cols=[(c[len("pool_"):],i) for i,c in enumerate(header) if c.startswith("pool_")]
  for values in reader:
   if len(values)!=len(header):continue
   did=values[draft_at].strip()
   if did not in keep_ids:continue
   event=values[pos["event_type"]].strip()
   if event!="PremierDraft":continue
   pack=_int(values[pos["pack_number"]]); pick=_int(values[pos["pick_number"]])
   if pack!=PRIMARY_PACK or pick is None or not (PRIMARY_PICK_START<=pick<PRIMARY_PICK_STOP):continue
   selected=values[pos["pick"]].strip()
   rate=_number(values[pos["user_game_win_rate_bucket"]]); games=_games_lower_bound(values[pos["user_n_games_bucket"]])
   if not selected or rate is None or games is None or not 0<=rate<=1:continue
   candidates=tuple(card for card,i in pack_cols if _count(values[i])>0)
   if not candidates or selected not in candidates or len(candidates)!=len(set(candidates)):continue
   pool=tuple(sorted((card,n) for card,i in pool_cols if (n:=_count(values[i]))>0))
   d=Decision(
     draft_id=did,expansion=expansion,event_type=event,
     draft_time=values[pos["draft_time"]].strip() if "draft_time" in pos else "",
     rank=values[pos["rank"]].strip() if "rank" in pos else "",
     pack_number=pack,pick_number=pick,selected_card=selected,candidates=candidates,pool=pool,
     user_game_win_rate=float(rate),user_games_lower_bound=int(games),
     event_match_wins=0,event_match_losses=None,
   )
   prior=out.get(d.decision_id)
   if prior is not None and prior!=d:raise SystemExit(f"conflicting context {d.decision_id}")
   out[d.decision_id]=d
 decisions=sorted(out.values(),key=lambda d:(d.draft_id,d.pack_number,d.pick_number))
 seen={d.draft_id for d in decisions}
 if seen!=keep_ids:raise SystemExit(f"context load mismatch missing={len(keep_ids-seen)} extra={len(seen-keep_ids)}")
 return decisions

def argmax(values,names):
 return min(range(len(names)),key=lambda i:(-float(values[i]),str(names[i])))

def rich_rows(decisions,base_by_id,metadata,candidate_feature_names):
 rows=[]; offsets=[0]; names=[]; cand=[]; selected=[]; skill=[]; weights=[]
 early_weights=normalized_draft_weights(decisions)
 for d in decisions:
  base=base_by_id[d.decision_id]
  _state,cm=rich_feature_bundle(d,base,metadata)
  local=list(d.candidates); names.extend(local)
  for name in local:cand.append([float(cm[name].get(f,0.0)) for f in candidate_feature_names])
  selected.append(local.index(d.selected_card)); skill.append(float(d.user_game_win_rate)); weights.append(float(early_weights[d.decision_id]))
  offsets.append(len(names))
 return {
  "offsets":np.asarray(offsets,dtype=np.int64),
  "candidate_names":np.asarray(names),
  "cand_rich":np.asarray(cand,dtype=np.float64),
  "selected_ord":np.asarray(selected,dtype=np.int16),
  "skill_rate":np.asarray(skill,dtype=np.float64),
  "decision_weight":np.asarray(weights,dtype=np.float64),
 }

def serialize_propensity(model):
 return {"feature_names":list(model.feature_names),"coefficients":[float(x) for x in model.coefficients],"l2":float(model.l2)}

def serialize_q(model):
 return {"feature_names":list(model.feature_names),"coefficients":[float(x) for x in model.coefficients],"l2":float(model.l2)}

def json_skill(model):
 out={}
 for k,v in model.items():
  if isinstance(v,np.ndarray):out[k]=v.tolist()
  elif isinstance(v,(np.floating,np.integer)):out[k]=v.item()
  else:out[k]=v
 return out

def score_digest(data,R,A,beta,cov,keep,scale,c):
 h=hashlib.sha256(); offsets=data["offsets"]; cand=data["cand_rich"]; cn=data["candidate_names"]
 cov=(cov+cov.T)/2
 for i in range(len(A)):
  s,t=int(offsets[i]),int(offsets[i+1]); a=int(A[i]); abase=cand[s+a,keep]
  h.update(str(i).encode());h.update(b"\0")
  for local in range(t-s):
   d=(cand[s+local,keep]-abase)/scale
   delta=float(d@beta); se=float(np.sqrt(max(0,float(d@cov@d)))); lcb=delta-c*se
   h.update(str(cn[s+local]).encode());h.update(np.float64(delta).tobytes());h.update(np.float64(se).tobytes());h.update(np.float64(lcb).tobytes())
  h.update(str(int(R[i])).encode());h.update(str(int(A[i])).encode())
 return h.hexdigest()

def main():
 p=argparse.ArgumentParser()
 p.add_argument("--expansion",choices=("FIN","TDM","DFT"),required=True)
 p.add_argument("--draft-archive",type=Path,required=True)
 p.add_argument("--game-archive",type=Path,required=True)
 p.add_argument("--reserve-json",type=Path,required=True)
 p.add_argument("--r-policy-bundle",type=Path,required=True)
 p.add_argument("--feature-report",type=Path,required=True)
 p.add_argument("--reproduction-validation-shard",type=Path,required=True)
 p.add_argument("--output-dir",type=Path,required=True)
 args=p.parse_args()
 if sha256(args.draft_archive)!=EXPECTED_DRAFT[args.expansion]:raise SystemExit("draft hash mismatch")
 if sha256(args.game_archive)!=EXPECTED_GAME[args.expansion]:raise SystemExit("game hash mismatch")
 if sha256(args.r_policy_bundle)!=R_BUNDLE_SHA:raise SystemExit("R bundle hash mismatch")
 if sha256(args.feature_report)!=FEATURE_SHA:raise SystemExit("feature report hash mismatch")

 reserve=json.loads(args.reserve_json.read_text())
 env=reserve["environments"][args.expansion]
 train_ids=frozenset(map(str,env["prior_train_ids"])); confirm_ids=frozenset(map(str,env["reserve_ids"]))
 if len(confirm_ids)!=15000 or train_ids&confirm_ids:raise SystemExit("bad reserve boundary")

 bundle=np.load(args.r_policy_bundle,allow_pickle=False)
 if abs(float(bundle["c"][0])-C)>1e-15:raise SystemExit("c changed")
 feature=json.loads(args.feature_report.read_text()); candidate_feature_names=list(feature["candidate_feature_names"])
 if len(candidate_feature_names)!=103:raise SystemExit("candidate schema changed")
 keep=np.asarray(bundle["keep_indices"],dtype=np.int64)
 beta=np.asarray(bundle["global_beta"],dtype=np.float64); cov=np.asarray(bundle["global_covariance"],dtype=np.float64); scale=np.asarray(bundle["z_scale"],dtype=np.float64)
 if len(beta)!=82 or len(scale)!=82 or cov.shape!=(82,82) or len(keep)!=82:raise SystemExit("frozen R shape mismatch")

 # Exact development-action reproduction from retained validation contexts.
 rv=np.load(args.reproduction_validation_shard,allow_pickle=False)
 fit=SimpleNamespace(global_beta=beta,global_covariance=cov,keep_indices=keep,z_scale=scale)
 rd={"offsets":rv["offsets"],"incumbent_ord":rv["incumbent_ord"],"cand_rich":rv["cand_rich"],"candidate_names":rv["candidate_names"]}
 reproduced,rdiag=choose_r_lcb(data=rd,fit=fit,decision_indices=np.asarray(bundle["eligible_indices"],int),behavior=np.asarray(rv["behavior"],float),c=C)
 exact_actions=bool(np.array_equal(reproduced,np.asarray(bundle["r_lcb_ord"],int)))
 if not exact_actions:raise SystemExit("frozen R development actions do not reproduce exactly")
 dev_score_sha=score_digest(rd,reproduced,np.asarray(rv["incumbent_ord"],int),beta,cov,keep,scale,C)

 # Old training outcomes only.
 train=load_decisions(args.draft_archive,keep_ids=train_ids)
 if {d.draft_id for d in train}!=set(train_ids):raise SystemExit("training draft load incomplete")
 # New confirmation context/action only; outcomes are never parsed by this loader.
 confirm=load_contexts_without_outcomes(args.draft_archive,set(confirm_ids),args.expansion)
 games=GameStore.from_archives([args.game_archive],train_ids)
 provider=ArchiveSignalProvider([*train,*confirm],games)

 wanted=set()
 for d in [*train,*confirm]:
  wanted.update(d.candidates);wanted.update(name for name,_ in d.pool)
 metadata,unresolved=_fetch_rich_set(args.expansion,wanted)
 coverage=len(metadata)/max(1,len(wanted))
 if coverage<.98:raise SystemExit(f"metadata coverage {coverage}")

 train_rows=build_fold_training_rows(train,train_ids,signal_provider=provider,inner_feature_folds=fresh.INNER_FEATURE_FOLDS)
 primary_model,primary_fit=fresh._fit_propensity(train_rows,True)
 q_rows=[];q_y=[];q_w=[]
 for row in train_rows:
  fmap=fresh._drop_strong_map(row.features)
  q_rows.append(fmap[row.selected_action]);q_y.append(float(row.outcome));q_w.append(float(row.sample_weight))
 q_model=RidgeOutcomeModel.fit(q_rows,q_y,sample_weights=q_w,l2=10.0)

 # Policy-window alternative evaluator: skill x frozen rich candidate representation,
 # fit only on prior training IDs and never used to recompute R actions/support.
 train_decision={d.decision_id:d for d in train if d.pack_number==PRIMARY_PACK and PRIMARY_PICK_START<=d.pick_number<PRIMARY_PICK_STOP}
 train_early_rows=[r for r in train_rows if r.decision_id in train_decision]
 train_early=[train_decision[r.decision_id] for r in train_early_rows]
 base_train={r.decision_id:r.features for r in train_early_rows}
 tdata=rich_rows(train_early,base_train,metadata,candidate_feature_names)
 tbeh=[]
 for row,d in zip(train_early_rows,train_early):
  probs=primary_model.probabilities(fresh._drop_strong_map(row.features),row.offsets)
  tbeh.extend(float(probs[a]) for a in d.candidates)
 tbeh=np.asarray(tbeh,float)
 skill_model=fit_skill_interaction_behavior(data=tdata,baseline_behavior=tbeh,l2=1000.0)

 # Freeze all confirmation actions/nuisance predictions without outcomes.
 base_confirm={}; offset_confirm={}; primary_flat=[];q_flat=[];A=[]
 for d in confirm:
  signals=provider(d,train_ids)
  fmap=model_feature_map(d,signals); base_confirm[d.decision_id]=fmap
  offs=strong_choice_offsets(signals,d.candidates);offset_confirm[d.decision_id]=offs
  probs=primary_model.probabilities(fresh._drop_strong_map(fmap),offs)
  primary_flat.extend(float(probs[a]) for a in d.candidates)
  q_flat.extend(float(q_model.predict(fresh._drop_strong(fmap[a]))) for a in d.candidates)
  ascore=[float(fmap[a].get("strong_choice_probability",0.0)) for a in d.candidates]
  A.append(argmax(ascore,list(d.candidates)))
 cdata=rich_rows(confirm,base_confirm,metadata,candidate_feature_names)
 primary_flat=np.asarray(primary_flat,float);q_flat=np.asarray(q_flat,float);A=np.asarray(A,dtype=np.int16)
 if len(primary_flat)!=len(cdata["candidate_names"]):raise SystemExit("candidate prediction alignment failure")
 cdata["incumbent_ord"]=A
 fit=SimpleNamespace(global_beta=beta,global_covariance=cov,keep_indices=keep,z_scale=scale)
 idx=np.arange(len(confirm),dtype=np.int64)
 R,pdiag=choose_r_lcb(data=cdata,fit=fit,decision_indices=idx,behavior=primary_flat,c=C)
 alt=predict_skill_interaction_behavior(skill_model,data=cdata,baseline_behavior=primary_flat)

 selected=np.asarray(cdata["selected_ord"],dtype=np.int16)
 offsets=np.asarray(cdata["offsets"],dtype=np.int64)
 overrides=R!=A
 if np.any(overrides):
  ii=np.flatnonzero(overrides)
  rp=primary_flat[offsets[ii]+R[ii]];ap=primary_flat[offsets[ii]+A[ii]]
  if np.any(rp<.05) or np.any(ap<.05):raise SystemExit("frozen R override violated both-action primary support")
 score_sha=score_digest(cdata,R,A,beta,cov,keep,scale,C)

 args.output_dir.mkdir(parents=True,exist_ok=True)
 meta=args.output_dir/"card-metadata.json";meta.write_text(json.dumps(metadata,indent=2,sort_keys=True)+"\n")
 npz=args.output_dir/"frozen-evaluation-context.npz"
 np.savez_compressed(
  npz,
  decision_ids=np.asarray([d.decision_id for d in confirm]),
  draft_ids=np.asarray([d.draft_id for d in confirm]),
  expansion=np.asarray([args.expansion]*len(confirm)),
  pack_number=np.asarray([d.pack_number for d in confirm],dtype=np.int16),
  pick_number=np.asarray([d.pick_number for d in confirm],dtype=np.int16),
  offsets=offsets,candidate_names=cdata["candidate_names"],
  selected_ord=selected,incumbent_ord=A,r_lcb_ord=np.asarray(R,dtype=np.int16),
  primary_behavior=primary_flat,alternative_behavior=np.asarray(alt,float),q_values=q_flat,
 )
 models={
  "primary_behavior":serialize_propensity(primary_model),
  "primary_behavior_fit":primary_fit,
  "q_model":serialize_q(q_model),
  "alternative_skill_model":json_skill(skill_model),
 }
 (args.output_dir/"nuisance-models.json").write_text(json.dumps(models,indent=2,sort_keys=True)+"\n")
 report={
  "phase":"R_independent_confirmation_environment_outcome_free_freeze",
  "expansion":args.expansion,
  "confirmation_outcomes_parsed":False,
  "confirmation_outcomes_used":False,
  "archive":{"draft_sha256":EXPECTED_DRAFT[args.expansion],"game_sha256":EXPECTED_GAME[args.expansion]},
  "cohort":{"prior_train_n":len(train_ids),"prior_train_id_sha256":id_sha(train_ids),"confirmation_n":len(confirm_ids),"confirmation_id_sha256":id_sha(confirm_ids),"overlap":0},
  "R":{"policy_bundle_sha256":R_BUNDLE_SHA,"c":C,"feature_report_sha256":FEATURE_SHA,"global_beta_n":len(beta),"keep_indices_n":len(keep),"development_action_reproduction_exact":exact_actions,"development_score_digest_sha256":dev_score_sha,"transfer_score_digest_sha256":score_sha,"policy":pdiag},
  "A":{"definition":"leakage-safe strong-player argmax constructed only from the environment's previously authorized prior training IDs; complement-refitted incumbent analogue, not claimed literal deployed artifact parity"},
  "primary_behavior":{"definition":"strong-offset conditional logit; fixed strong evidence as offset, learned strong-choice fields removed","fit":primary_fit},
  "alternative_behavior":{"definition":"P1P1-P1P8 prior-training-only skill x rich-candidate conditional-logit correction over primary behavior; L2=1000; fixed R/A actions unchanged","fit":{"l2":1000.0,"objective":float(skill_model["objective"]),"iterations":int(skill_model["iterations"]),"gradient_max_abs":float(skill_model["gradient_max_abs"])}},
  "q_nuisance":{"definition":"fixed simple RidgeOutcomeModel L2=10 fit once on prior training IDs; strong-choice fields removed","l2":10.0,"training_rows":len(train_rows)},
  "metadata":{"wanted":len(wanted),"resolved":len(metadata),"coverage":coverage,"unresolved":unresolved,"sha256":sha256(meta)},
  "context":{"drafts":len(confirm_ids),"decisions":len(confirm),"candidate_rows":len(cdata["candidate_names"]),"npz_sha256":None,"override_count":int(np.sum(overrides)),"override_fraction":float(np.mean(overrides))},
  "boundary":"All policy actions, behavior probabilities, Q predictions, metadata, and feature construction are frozen before confirmation event_match_wins is parsed. Alternative behavior never recomputes the primary R support gate.",
 }
 report["context"]["npz_sha256"]=sha256(npz)
 (args.output_dir/"freeze-report.json").write_text(json.dumps(report,indent=2,sort_keys=True)+"\n")
 print(json.dumps({"expansion":args.expansion,"confirmation_outcomes_parsed":False,"confirmation_n":len(confirm_ids),"decisions":len(confirm),"override_fraction":report["context"]["override_fraction"],"context_sha256":report["context"]["npz_sha256"],"metadata_sha256":report["metadata"]["sha256"],"development_actions_reproduce":exact_actions},indent=2,sort_keys=True))

if __name__=="__main__":main()
