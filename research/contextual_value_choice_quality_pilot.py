#!/usr/bin/env python3
"""Frozen propensity-free outcome-residual ranking challenger for issue #529."""
import argparse, gzip, json, math, random
from pathlib import Path
from collections import defaultdict
import numpy as np

GRID=(0.1,1.0,10.0,100.0,1000.0,10000.0); SEED=529; BOOT=5000

def primary(d):
    return (d['pack_number'].astype(int)==0)&(d['pick_number'].astype(int)<8)

def sel_idx(d):
    return d['offsets'][:-1].astype(np.int64)+d['selected_ord'].astype(np.int64)

def selected_cards(paths):
    out={}
    for p in paths:
        with np.load(p,allow_pickle=False) as d:
            ii=sel_idx(d)
            for did,card in zip(d['decision_ids'].astype(str),d['candidate_names'][ii].astype(str)):
                if did in out: raise SystemExit(f'duplicate decision {did}')
                out[did]=card
    return out

def simple_q(paths,cards):
    out={}
    for path in paths:
        with gzip.open(path,'rt',encoding='utf-8') as f:
            for line in f:
                r=json.loads(line); did=str(r['decision_id']); card=cards.get(did)
                if card is None: continue
                if did in out: raise SystemExit(f'duplicate retained Q for {did}')
                out[did]=float(r['q_values'][card])
    missing=set(cards)-set(out)
    extra=set(out)-set(cards)
    if missing or extra: raise SystemExit(f'retained Q coverage mismatch missing={len(missing)} extra={len(extra)}')
    return out

def assert_validation_q_parity(path,qmap):
    with np.load(path,allow_pickle=False) as d:
        ii=sel_idx(d)
        for did,q in zip(d['decision_ids'].astype(str),d['q_simple'][ii].astype(float)):
            if did not in qmap: raise SystemExit(f'validation retained Q missing {did}')
            if abs(float(qmap[did])-float(q))>1e-12: raise SystemExit(f'validation retained Q mismatch {did}')

def draft_rows(path,qmap=None,fold=None):
    with np.load(path,allow_pickle=False) as d:
        off=d['offsets'].astype(np.int64); cnt=np.diff(off).astype(float); cand=d['cand_rich'].astype(float)
        means=np.add.reduceat(cand,off[:-1],axis=0)/cnt[:,None]; ii=sel_idx(d); rel=cand[ii]-means
        mask=primary(d); q=d['q_simple'] if qmap is None else None; groups={}
        for i in np.flatnonzero(mask):
            did=str(d['draft_ids'][i]); row=groups.setdefault(did,[[],[],float(d['outcome'][i]),str(d['expansion'][i])])
            row[0].append(rel[i]); row[1].append(float(q[ii[i]]) if qmap is None else qmap[str(d['decision_ids'][i])])
    return [{'draft_id':did,'fold':fold,'x':np.mean(v[0],axis=0),'base':float(np.mean(v[1])),'y':v[2],'exp':v[3],'n':len(v[0])} for did,v in groups.items()]

def arrays(rows):
    return np.stack([r['x'] for r in rows]),np.array([r['y'] for r in rows]),np.array([r['base'] for r in rows])

def fit(X,r,l2):
    mu=X.mean(0); sd=X.std(0); a=sd>1e-8; Z=(X[:,a]-mu[a])/sd[a]; intercept=float(r.mean())
    beta=np.linalg.solve(Z.T@Z+l2*np.eye(a.sum()),Z.T@(r-intercept))
    return mu,sd,a,intercept,beta

def predict(m,X):
    mu,sd,a,intercept,beta=m; return intercept+((X[:,a]-mu[a])/sd[a])@beta

def metric(y,p):
    e=p-y; return {'n':len(e),'rmse':float(np.sqrt(np.mean(e*e))),'mae':float(np.mean(np.abs(e))),'bias':float(np.mean(e))}

def corr(a,b):
    return float(np.corrcoef(a,b)[0,1]) if len(a)>1 and np.std(a)>0 and np.std(b)>0 else None

def cv(train):
    X,y,b=arrays(train); r=y-b; f=np.array([x['fold'] for x in train]); grid=[]
    se0=ae0=n0=0
    for h in range(5):
        tr=f!=h; te=f==h; e=np.full(te.sum(),r[tr].mean())-r[te];se0+=(e*e).sum();ae0+=np.abs(e).sum();n0+=te.sum()
    for l2 in GRID:
        se=ae=n=0; folds=[]
        for h in range(5):
            tr=f!=h; te=f==h; p=predict(fit(X[tr],r[tr],l2),X[te]);e=p-r[te]
            se+=(e*e).sum();ae+=np.abs(e).sum();n+=te.sum();folds.append({'fold':h,'rmse':float(np.sqrt(np.mean(e*e))),'corr':corr(p,r[te])})
        grid.append({'l2':l2,'rmse':float(np.sqrt(se/n)),'mae':float(ae/n),'folds':folds})
    chosen=min(grid,key=lambda x:x['rmse'])['l2']
    return {'grid':grid,'chosen_l2':chosen,'intercept_only_rmse':float(np.sqrt(se0/n0)),'intercept_only_mae':float(ae0/n0)},fit(X,r,chosen)

def bootstrap(base,aug):
    dm=np.abs(aug)-np.abs(base); ds=aug*aug-base*base; rng=random.Random(SEED); am=[]; sm=[]; n=len(base)
    for _ in range(BOOT):
        ids=[rng.randrange(n) for __ in range(n)];am.append(sum(dm[i] for i in ids)/n);sm.append(sum(ds[i] for i in ids)/n)
    am.sort();sm.sort();lo=int(.025*BOOT);hi=int(.975*BOOT)
    return {'draws':BOOT,'seed':SEED,'mae_delta':float(dm.mean()),'mae_ci95':[am[lo],am[hi]],'mse_delta':float(ds.mean()),'mse_ci95':[sm[lo],sm[hi]]}

def ranking(path,m):
    with np.load(path,allow_pickle=False) as d:
        mu,sd,a,intercept,beta=m; raw=np.zeros(d['cand_rich'].shape[1]);raw[a]=beta/sd[a]
        off=d['offsets'].astype(np.int64); q=d['q_simple']; cand=d['cand_rich'].astype(float); beh=d['behavior']; hist=d['selected_ord']; inc=d['incumbent_ord']; mask=primary(d)
        counts=defaultdict(int); sums=defaultdict(float); by=defaultdict(lambda:defaultdict(list)); n=0
        for i in np.flatnonzero(mask):
            s,t=int(off[i]),int(off[i+1]); x=cand[s:t]; c=(x-x.mean(0))@raw; qq=q[s:t]; aa=qq+c; j=int(np.argmax(aa));f=int(np.argmax(qq));h=int(hist[i]);A=int(inc[i]);n+=1
            counts['J_eq_F']+=j==f;counts['J_eq_A']+=j==A;counts['J_eq_hist']+=j==h
            for name,o in [('J',j),('F',f),('A',A),('hist',h)]: sums['q_'+name]+=qq[o];sums['score_'+name]+=aa[o];sums['support_'+name]+=beh[s+o]
            r=by[str(d['draft_ids'][i])];r['y'].append(float(d['outcome'][i]));r['base'].append(float(qq[h]));r['Jreg'].append(float(aa[j]-aa[h]));r['Freg'].append(float(qq[f]-qq[h]))
    arr=np.array([[np.mean(r['y']),np.mean(r['base']),np.mean(r['Jreg']),np.mean(r['Freg'])] for r in by.values()]);res=arr[:,0]-arr[:,1]
    return {'decisions':n,'agreement':{k:v/n for k,v in counts.items()},'means':{k:v/n for k,v in sums.items()},'J_regret_corr':corr(arr[:,2],res),'F_regret_corr':corr(arr[:,3],res),'note':'behavior support is descriptive only; propensity is not used for fit or selection'}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--simple-q-prediction',action='append',required=True);ap.add_argument('--train-fold',action='append',required=True);ap.add_argument('--validation-fold',required=True);ap.add_argument('--feature-report',required=True);ap.add_argument('--output',required=True);args=ap.parse_args()
    paths=[Path(x) for x in args.train_fold]
    if len(paths)!=5: raise SystemExit('need five train folds')
    fr=json.load(open(args.feature_report));assert fr['assessment_opened'] is False and fr['ranking_strong_player_features_removed']
    validation_path=Path(args.validation_fold)
    cards=selected_cards(paths+[validation_path]);qmap=simple_q([Path(x) for x in args.simple_q_prediction],cards);assert_validation_q_parity(validation_path,qmap);train=[]
    for p in paths:
        with np.load(p,allow_pickle=False) as d: fold=int(d['fold'][0]); assert fold in range(5) and 'q_simple' not in d.files
        train.extend(draft_rows(p,qmap,fold))
    val=draft_rows(validation_path,qmap=qmap);
    if len(train)!=4789 or len(val)!=1218: raise SystemExit(f'cohort mismatch {len(train)}/{len(val)}')
    cvrep,model=cv(train);VX,VY,VB=arrays(val);correction=predict(model,VX);base=VB;aug=VB+correction;be=base-VY;ae=aug-VY
    exp=np.array([r['exp'] for r in val]);byset={}
    for e in sorted(set(exp)):
        mm=exp==e;byset[e]={'base':metric(VY[mm],base[mm]),'augmented':metric(VY[mm],aug[mm]),'correction_corr':corr(correction[mm],(VY-VB)[mm])}
    report={'phase':'outcome-residual-choice-quality-pilot','scope':'core-development-only','assessment_opened':False,'assessment_outcomes_used':False,'propensity_used_for_fit':False,'propensity_used_for_primary_evidence':False,'spec':{'primary_window':'P1P1-P1P8 available eligible decisions','features':'mean selected-minus-pack-mean rich candidate features','target':'event_match_wins minus mean retained strong-offset-only simple-Q historical-selection prediction','ridge_grid':list(GRID),'selection':'five-fold training-only residual RMSE','ranking_rule':'J = argmax(simple_q + beta_raw dot candidate-minus-pack-mean)','simple_q_source':'strong_offset_only outer-fold predictions from ablation run 36280148906 for train and validation','strong_player_ranking_features':'excluded'},'cohort':{'train_drafts':len(train),'validation_drafts':len(val),'mean_primary_train':float(np.mean([r['n'] for r in train])),'mean_primary_validation':float(np.mean([r['n'] for r in val]))},'training_cv':cvrep,'validation':{'base':metric(VY,base),'augmented':metric(VY,aug),'correction_corr':corr(correction,VY-VB),'correction_std':float(np.std(correction)),'bootstrap':bootstrap(be,ae),'by_set':byset},'ranking':ranking(Path(args.validation_fold),model),'model':{'chosen_l2':cvrep['chosen_l2'],'active_features':int(model[2].sum())},'next_gate':{'assessment_authorized':False,'status':'freeze-before-ood','recommended_next_step':'rejection-only HOB/TMT outcome-residual stress with matching leakage-safe inputs'}}
    Path(args.output).parent.mkdir(parents=True,exist_ok=True);Path(args.output).write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    print(json.dumps({'chosen_l2':cvrep['chosen_l2'],'cv_intercept_rmse':cvrep['intercept_only_rmse'],'cv_chosen_rmse':min(x['rmse'] for x in cvrep['grid']),'val_base_rmse':report['validation']['base']['rmse'],'val_aug_rmse':report['validation']['augmented']['rmse'],'mse_delta_ci95':report['validation']['bootstrap']['mse_ci95'],'J_eq_F':report['ranking']['agreement']['J_eq_F'],'J_regret_corr':report['ranking']['J_regret_corr'],'F_regret_corr':report['ranking']['F_regret_corr']},indent=2))
if __name__=='__main__': main()
