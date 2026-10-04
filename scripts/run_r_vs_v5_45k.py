#!/usr/bin/env python3
"""Research-only exact frozen R-LCB vs uncapped v5 comparison on the spent 45k cohort."""
from __future__ import annotations
import argparse,csv,gzip,hashlib,json,sys
from pathlib import Path
from collections import defaultdict
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from build_replays import (CountStore,OutOfFoldModel,build_colour_tables_by_fold,build_fold_training,
    candidate_columns,normalize_probabilities,parse_games_lower_bound,parse_rate_bucket,pool_columns,
    select_strong_drafts,stable_fold,truthy_count,DraftSkill,PickExample)

CAPS=(10.,20.,50.); BOOT=10000; SEED=529
EXPECTED={
 'FIN':{'training':20366,'draft_sha':'9d5b2a3e908bb8daf0ea6e951097714b651546370a5c852893dc90a1f2f6ab8b','game_sha':'f6452e622976f66dd5420c55741da5b246c7e8d25d63c080e728635e1741a6a6'},
 'TDM':{'training':11887,'draft_sha':'831ba8bc4be5eabe140fac00a8e6eaded3f3f931685be8f91403ad9cfde5cbf5','game_sha':'e2e679168818d67d812972343ba541d626d0f57140bc22955e09dd07bc2086e4'},
 'DFT':{'training':18966,'draft_sha':'7812d16e0de78ff7a69faf9981f7ff03be4dfc618a86f14369424ec2204580cd','game_sha':'734325afbe5c023245e7769fab66c88dcf241407666becb06b956d7fee13a28b'},
}

def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1<<20),b''): h.update(b)
 return h.hexdigest()

def scan_skills(path):
 skills={}; ids=set()
 with gzip.open(path,'rt',encoding='utf-8-sig',newline='') as f:
  r=csv.reader(f); head=tuple(next(r)); pos={x:i for i,x in enumerate(head)}
  for need in ('draft_id','user_n_games_bucket','user_game_win_rate_bucket'):
   if need not in pos: raise SystemExit(f'{path}: missing {need}')
  event=pos.get('event_type')
  for row in r:
   if len(row)!=len(head): continue
   did=row[pos['draft_id']].strip()
   if not did or (event is not None and row[event].strip()!='PremierDraft'): continue
   ids.add(did)
   if did in skills: continue
   rate=parse_rate_bucket(row[pos['user_game_win_rate_bucket']]); games=parse_games_lower_bound(row[pos['user_n_games_bucket']])
   if rate is not None and games is not None: skills[did]=DraftSkill(rate=rate,games_lower_bound=games)
 return skills,ids,head

def load_examples(path,wanted,header,full_ids):
 pack_cols=candidate_columns(header); pool_cols=pool_columns(header); pos={x:i for i,x in enumerate(header)}
 packed=[(c,pos[c]) for c in pack_cols]; pooled=[(c,pos[c]) for c in pool_cols]; by=defaultdict(list)
 with gzip.open(path,'rt',encoding='utf-8-sig',newline='') as f:
  r=csv.reader(f); actual=tuple(next(r))
  if actual!=header: raise SystemExit('header changed')
  for row in r:
   if len(row)!=len(header): continue
   did=row[pos['draft_id']].strip()
   if did not in wanted: continue
   historical=row[pos['pick']].strip()
   if not historical: continue
   try: pack=int(float(row[pos['pack_number']])); pick=int(float(row[pos['pick_number']]))
   except ValueError: continue
   if did not in full_ids and (pack!=0 or pick>7): continue
   candidates=[c[len('pack_card_'):] for c,i in packed if truthy_count(row[i])>0]
   if historical not in candidates or len(candidates)!=len(set(candidates)): continue
   pool={c[len('pool_'):]:n for c,i in pooled if (n:=truthy_count(row[i]))>0}
   by[did].append(PickExample(did,pack,pick,historical,candidates,pool))
 for did in by: by[did].sort(key=lambda x:(x.raw_pack_number,x.raw_pick_number))
 return dict(by)

def probs(model,ex):
 raw={c:model.card_tendency(c,ex.raw_pack_number,ex.raw_pick_number,ex.pool) for c in ex.candidates}
 return normalize_probabilities(raw)
def ranking(p): return sorted(p,key=lambda c:(-p[c],c))
def source_hash(sid,did): return hashlib.sha256(f'{sid}|{did}'.encode()).hexdigest()[:32]

def outcomes(path,ids):
 out={}
 with gzip.open(path,'rt',encoding='utf-8-sig',newline='') as f:
  r=csv.reader(f); head=tuple(next(r)); pos={x:i for i,x in enumerate(head)}
  for need in ('draft_id','event_match_wins'):
   if need not in pos: raise SystemExit(f'{path}: missing {need}')
  for row in r:
   if len(row)!=len(head): continue
   did=row[pos['draft_id']].strip()
   if did not in ids: continue
   raw=row[pos['event_match_wins']].strip()
   if not raw: continue
   y=float(raw)
   if did in out and out[did]!=y: raise SystemExit(f'{did}: inconsistent outcome')
   out[did]=y
 if set(out)!=ids: raise SystemExit(f'{path}: missing outcomes={len(ids-set(out))}')
 return out

def hist_modules(root):
 sys.path.insert(0,str(root/'research'))
 from contextual_value_draft_weighted_ope import evaluate_draft_weighted,paired_delta
 return evaluate_draft_weighted,paired_delta

def estimate(data,left,right,y,behavior,eval_dw,paired_delta):
 idx=np.arange(len(data['draft_ids']),dtype=np.int64); rows={}; deltas={}
 for cap in CAPS:
  le,lt=eval_dw(offsets=data['offsets'],selected_ord=data['selected_ord'],target_ord=left,outcome=y,behavior=behavior,q_values=data['q_values'],draft_ids=data['draft_ids'],decision_indices=idx,cap=cap)
  re,rt=eval_dw(offsets=data['offsets'],selected_ord=data['selected_ord'],target_ord=right,outcome=y,behavior=behavior,q_values=data['q_values'],draft_ids=data['draft_ids'],decision_indices=idx,cap=cap)
  d=paired_delta(lt,rt); rows[str(int(cap))]={'left':le.__dict__,'right':re.__dict__,'minus_right':{'dr':float(le.dr-re.dr),'direct':float(le.direct-re.direct),'residual_correction':float((le.dr-re.dr)-(le.direct-re.direct)),'snips':float(le.snips-re.snips),'ipw':float(le.ipw-re.ipw)}}; deltas[str(int(cap))]=np.asarray(d,float)
 return rows,deltas

def run_env(a):
 env=a.env.upper(); exp=EXPECTED[env]; sid=env.lower()
 if sha(a.draft)!=exp['draft_sha'] or sha(a.game)!=exp['game_sha']: raise SystemExit(f'{env}: archive hash mismatch')
 z0=np.load(a.freeze,allow_pickle=False); data={k:z0[k] for k in z0.files}; ids=set(map(str,data['draft_ids']))
 if len(ids)!=15000: raise SystemExit(f'{env}: expected 15000 frozen drafts, got {len(ids)}')
 skills,all_ids,header=scan_skills(a.draft); training,cutoff,experienced=select_strong_drafts(skills,100,.15,None); training=set(training)
 if len(training)!=exp['training']: raise SystemExit(f'{env}: v5 training count {len(training)} != {exp["training"]}')
 with gzip.open(a.corpus,'rt',encoding='utf-8') as f: corpus=json.load(f)
 by_hash={source_hash(sid,d):d for d in all_ids}; served_ids={by_hash[p['source_draft_hash']] for p in corpus if p.get('source_draft_hash') in by_hash}
 wanted=training|ids|served_ids; full_ids=training|served_ids
 examples=load_examples(a.draft,wanted,header,full_ids); lookup={(d,e.raw_pack_number+1,e.raw_pick_number+1):e for d,rows in examples.items() for e in rows}
 pairs=[(d,e) for d in training for e in examples.get(d,())]; folds=build_fold_training(pairs,training,5); fits=build_colour_tables_by_fold(a.game,pairs,folds,sid); models={f.fold:OutOfFoldModel(f.counts,CountStore.empty(),fits[f.fold]) for f in folds}
 maxerr=0.; mism=0; checked=0
 for p in corpus:
  did=by_hash.get(p.get('source_draft_hash')); key=(did,1,int(p['pick_number'])) if did else None; ex=lookup.get(key) if key else None
  if ex is None: continue
  pr=probs(models[stable_fold(did,5)],ex); stored={c['name']:float(c['model_probability']) for c in p['candidates']}
  if set(pr)!=set(stored): raise SystemExit(f'{env}: v5 corpus candidate mismatch {key}')
  maxerr=max(maxerr,max(abs(pr[c]-stored[c]) for c in pr)); mism+=ranking(pr)[0]!=ranking(stored)[0]; checked+=1
 if checked<100 or maxerr>1.1e-6 or mism: raise SystemExit(f'{env}: v5 reconstruction failed checked={checked} maxerr={maxerr} mism={mism}')
 offs=np.asarray(data['offsets'],np.int64); names=np.asarray(data['candidate_names']); dids=np.asarray(data['draft_ids']).astype(str); packs=np.asarray(data['pack_number'],np.int64); picks=np.asarray(data['pick_number'],np.int64); selected=np.asarray(data['selected_ord'],np.int64)
 v5=np.empty(len(dids),np.int16)
 for i,did in enumerate(dids):
  key=(did,int(packs[i])+1,int(picks[i])+1); ex=lookup.get(key)
  if ex is None: raise SystemExit(f'{env}: missing frozen decision {key}')
  lo,hi=int(offs[i]),int(offs[i+1]); local=[str(x) for x in names[lo:hi]]
  if set(local)!=set(ex.candidates) or local[int(selected[i])]!=ex.historical_pick: raise SystemExit(f'{env}: frozen decision mismatch {key}')
  v5[i]=local.index(ranking(probs(models[stable_fold(did,5)],ex))[0])
 r=np.asarray(data['r_lcb_ord'],np.int64); ymap=outcomes(a.draft,ids); y=np.asarray([ymap[str(x)] for x in data['draft_ids']],float); eval_dw,paired_delta=hist_modules(a.historical_root)
 prow,pdelta=estimate(data,r,v5,y,np.asarray(data['primary_behavior'],float),eval_dw,paired_delta); arow,adelta=estimate(data,r,v5,y,np.asarray(data['alternative_behavior'],float),eval_dw,paired_delta)
 out={'env':env,'drafts':15000,'decisions':len(v5),'v5':{'training_drafts':len(training),'experienced_drafts':int(experienced),'win_rate_cutoff':float(cutoff),'corpus_reproduction_decisions':checked,'corpus_max_abs_probability_error':maxerr,'corpus_top_pick_mismatches':mism},'r_v5_action_agreement':float(np.mean(r==v5)),'r_v5_disagreement_rate':float(np.mean(r!=v5)),'primary':prow,'alternative':arow,'primary_cap20_per_draft':pdelta['20'].tolist(),'alternative_cap20_per_draft':adelta['20'].tolist()}
 a.out.parent.mkdir(parents=True,exist_ok=True); a.out.write_text(json.dumps(out,separators=(',',':'))+'\n'); print(json.dumps({k:v for k,v in out.items() if k not in ('primary_cap20_per_draft','alternative_cap20_per_draft')},indent=2))

def bootstrap(series):
 envs=sorted(series); n=15000; vals=np.empty(BOOT); rng=np.random.default_rng(SEED); chunk=20
 for start in range(0,BOOT,chunk):
  take=min(chunk,BOOT-start); inds=rng.integers(0,n,size=(take,len(envs),n)); means=np.zeros(take)
  for j,e in enumerate(envs): means+=np.mean(np.asarray(series[e],float)[inds[:,j,:]],axis=1)
  vals[start:start+take]=means/len(envs)
 return [float(np.quantile(vals,.025)),float(np.quantile(vals,.975))]

def aggregate(a):
 reports={}
 for p in sorted(a.aggregate.glob('*.json')):
  r=json.loads(p.read_text()); reports[r['env']]=r
 if set(reports)!=set(EXPECTED): raise SystemExit(f'need FIN/TDM/DFT reports, got {sorted(reports)}')
 primary={e:r['primary_cap20_per_draft'] for e,r in reports.items()}; alt={e:r['alternative_cap20_per_draft'] for e,r in reports.items()}; point=lambda x:float(np.mean([np.mean(np.asarray(v,float)) for v in x.values()]))
 pp,ap=point(primary),point(alt); pci,aci=bootstrap(primary),bootstrap(alt)
 out={'schema':1,'phase':'frozen_R_LCB_vs_exact_v5_spent45k','scope':'45,000 previously spent FIN/TDM/DFT drafts; 15k each; all available P1P1-P1P8; equal environment weight','model':'strong-player-colour-stage-v5','r_policy':'frozen R-LCB c=2.49','estimator':'paired draft-weighted cap20 DR; 10,000-draw environment-stratified paired draft bootstrap; seed 529','primary':{'cap20_dr':pp,'ci95':pci,'ci_above_zero':pci[0]>0,'excludes_plus_0_03':pci[1]<0.03},'alternative_same_actions':{'cap20_dr':ap,'ci95':aci,'ci_above_zero':aci[0]>0},'historical_r_vs_v4':{'cap20_dr':0.008600,'ci95':[-0.005029,0.021874]},'per_environment':{e:{k:v for k,v in r.items() if k not in ('primary_cap20_per_draft','alternative_cap20_per_draft')} for e,r in reports.items()},'production_change_authorized':False}
 a.out.parent.mkdir(parents=True,exist_ok=True); a.out.write_text(json.dumps(out,indent=2,sort_keys=True)+'\n'); print(json.dumps(out,indent=2,sort_keys=True))

def main():
 p=argparse.ArgumentParser(); p.add_argument('--env',choices=sorted(EXPECTED)); p.add_argument('--draft',type=Path); p.add_argument('--game',type=Path); p.add_argument('--freeze',type=Path); p.add_argument('--corpus',type=Path); p.add_argument('--historical-root',type=Path); p.add_argument('--aggregate',type=Path); p.add_argument('--out',type=Path,required=True); a=p.parse_args()
 if a.aggregate: aggregate(a)
 else:
  for name in ('env','draft','game','freeze','corpus','historical_root'):
   if getattr(a,name) is None: raise SystemExit(f'missing --{name.replace("_","-")}')
  run_env(a)
if __name__=='__main__': main()
