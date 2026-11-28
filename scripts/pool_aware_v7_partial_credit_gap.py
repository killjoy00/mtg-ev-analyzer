#!/usr/bin/env python3
"""Pairwise partial-credit audit of the frozen reviewed v7 contrast candidate.

Public 17Lands only. Fit one simple support correction on the earlier half of
the existing validation drafts; assess on later drafts, with format-held-out
transfer as well. No production imports/writes, trophy filtering, or row-level
exports. The temperature arm is a diagnostic of support spread, not permission
to change the score curve. The contextual arm is one additional pre-pick term.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
import math
from pathlib import Path
import json
import numpy as np
import pool_aware_skill_reviewed_validation as rv
import pool_aware_v7_refit as refit
import pool_aware_skill_final_correction as final
import pool_aware_mana_final as parser
import pool_aware_skill_contrast as skill
import pool_aware_skill_expansion as exp
import pool_aware_statistical_validation as stat
from pool_aware_refit import weights
from pool_aware_archive import read_json
from pool_aware_diagnostics import grade

PROTOCOL='v7-pairwise-credit-gap-v1'
REGISTRY='ba978db88bb5b569a100cfbc53103a697e2ee0a496b1ec9a9c2fcba1f90a6bdc'
BANDS=('0-19','20-39','40-59','60-79','80-89','90-95')
CUT=np.array([20,40,60,80,90])
# One scalar, no card-specific overrides; no tuning on later rows.
ARMS=[('baseline',0.)]+[('temperature',round(x,2)) for x in np.arange(.50,2.51,.10) if abs(x-1)>.001]+[('mana',round(x,2)) for x in np.arange(-1.,1.01,.20) if abs(x)>.001]
PROV=('sources','windows','purge_days','baseline_cutoff','baseline_picks','baseline_drafts','baseline_colour_coverage','recovery')

def armkey(a):
    return a[0]+':'+str(a[1])

def cluster(v,ids):
    """Sufficient moments for a whole-draft cluster-robust mean (not IID)."""
    if not len(v):return [0,0.,0,0.,0.,0.]
    n=np.bincount(ids);s=np.bincount(ids,weights=v,minlength=len(n))
    return [int(n.sum()),float(s.sum()),int(np.count_nonzero(n)),float(n@n),float(s@s),float(n@s)]

def combine_moments(rows):
    return np.sum(rows,axis=0).tolist() if rows else [0,0.,0,0.,0.,0.]

def estimate(m):
    n,s,g,nn,ss,ns=m
    if not n:return {'n':0,'drafts':0,'mean':None,'ci95':None}
    mean=s/n
    se=math.sqrt(max(0.,(ss-2*mean*ns+mean*mean*nn)*g/(g-1)))/n if g>1 else None
    return {'n':int(n),'drafts':int(g),'mean':mean,'ci95':[mean-1.96*se,mean+1.96*se] if se is not None else None}

def cell(p,y,ids):
    return {'expected_sum':float(p.sum()),'observed_sum':int(y.sum()),'gap':cluster(y-p,ids),'observed':cluster(y.astype(float),ids)}

def pool_cell(cells):
    m=estimate(combine_moments([x['gap'] for x in cells]))
    o=estimate(combine_moments([x['observed'] for x in cells]))
    n=m['n']
    return {'comparisons':n,'drafts':m['drafts'],'expected':sum(x['expected_sum'] for x in cells)/n if n else None,
            'observed':o['mean'],'observed_ci95':o['ci95'],'gap':m['mean'],'gap_ci95':m['ci95']}

def logistic(d):
    return np.exp(-np.logaddexp(0.,-d))

def pair_rows(z,valid,chosen):
    lead=np.argmax(z,axis=1)
    mask=valid.copy()
    mask[np.arange(len(z)),lead]=False
    alt_row,alt=np.where(mask&((chosen==lead)[:,None]|(np.arange(z.shape[1])[None,:]==chosen[:,None])))
    d=z[alt_row,alt]-z[alt_row,lead[alt_row]]
    y=(chosen[alt_row]==alt).astype(int)
    g=np.floor(95*np.exp(d)+.5).astype(int).clip(0,95)
    return alt_row,alt,lead,d,y,g

def cells(p,y,ids,grades,picks,mask):
    out={}
    for scope,scope_mask in [('all',mask),('p1-8',mask&(picks<=8)),('40-69',mask&(grades>=40)&(grades<=69))]+[(f'p{k}',mask&(picks==k)) for k in range(1,12)]:
        if scope=='40-69':
            out[scope]={'40-69':cell(p[scope_mask],y[scope_mask],ids[scope_mask])}
            continue
        bins=np.digitize(grades,CUT)
        out[scope]={b:cell(p[q],y[q],ids[q]) for i,b in enumerate(BANDS) for q in [scope_mask&(bins==i)]}
    return out

def compact_cells(p,y,ids,g,mask):
    return {b:cell(p[q],y[q],ids[q]) for i,b in enumerate(BANDS) for q in [mask&(np.digitize(g,CUT)==i)]}

def pack_arrays(records,metadata,fit):
    ordered=sorted(records,key=lambda t:(t[0].event_time,t[0].source,t[2]))
    ids=sorted({r.source for r,_,_ in ordered})
    imap={s:i for i,s in enumerate(ids)}
    times={}
    for r,_,_ in ordered:
        if r.source in times and times[r.source]!=r.event_time:raise ValueError('draft timestamp mismatch')
        times[r.source]=r.event_time
    ts=sorted(set(times.values()))
    if len(ts)<2:raise ValueError('insufficient distinct draft timestamps')
    # Divide by unique draft dates, with ties wholly on one side.
    st=sorted(times.values());boundary=st[len(st)//2]
    if boundary==st[0]:boundary=ts[1]
    width=max(len(r.candidates) for r,_,_ in ordered)
    z=np.full((len(ordered),width),-np.inf); mana=np.zeros_like(z); fixing=np.zeros_like(z,dtype=bool)
    supported=np.zeros_like(z); missing=np.zeros_like(z)
    chosen=np.zeros(len(ordered),dtype=int); picks=chosen.copy(); draft=chosen.copy()
    train=np.zeros(len(ordered),dtype=bool); names=[]
    rules=parser.index(metadata);context,cards=final.parameters(fit)
    for k,(r,pool,pick) in enumerate(ordered):
        # EXACT support path from reviewed candidate, no display exponent.
        corrected=final.apply(r,pool,rules,context,cards)
        q=weights(corrected,skill.APPLY)
        feat=final.fit_features(r,pool,rules).features
        order=sorted(range(len(r.candidates)),key=lambda j:r.candidates[j])
        names.append(tuple(r.candidates[j] for j in order))
        n=len(order)
        z[k,:n]=np.log([q[j] for j in order])
        # One predeclared net printed-mana feasibility feature, existing
        # bounded features only. Raw unknown-color imputation is unchanged.
        mana[k,:n]=[feat[j][0]-sum(feat[j][1:4]) for j in order]
        supported[k,:n]=[feat[j][0] for j in order]
        missing[k,:n]=[sum(feat[j][1:4]) for j in order]
        fixing[k,:n]=[bool(rules.get(r.candidates[j]).sources) for j in order]
        chosen[k]=order.index(r.chosen);picks[k]=pick;draft[k]=imap[r.source]
        train[k]=r.event_time<boundary
        if list(grade(q))!=[int(min(95,math.floor(95*v/max(q)+.5))) for v in q]:
            raise AssertionError('raw award mismatch')
    if not train.any() or train.all() or set(draft[train])&set(draft[~train]):
        raise ValueError('non-disjoint discovery and test drafts')
    return ordered,names,z,mana,fixing,supported,missing,chosen,picks,draft,train,boundary

def pattern_report(ordered,names,z,fixing,supported,missing,chosen,picks,draft,train,br,ba,bl,bd,by,bg):
    # Same offered named pair, stage and directional mana context, verified
    # with independent earlier/later source drafts. Only example prior pools
    # and card names from the public archives; never identifiers/times.
    fav=bl[br]
    gap=logistic(bd)
    delta=supported[br,ba]-supported[br,fav]
    md=missing[br,ba]-missing[br,fav]
    fix=fixing[br,ba].astype(int)-fixing[br,fav].astype(int)
    contexts=np.where((delta>.05)|(md<-.05),'alt-more-mana-fit',
              np.where((delta<-.05)|(md>.05),'fav-more-mana-fit','similar-or-uncommitted'))
    contexts=np.where(fix>0,'alt-is-source',np.where(fix<0,'fav-is-source',contexts))
    stages=np.where(picks[br]<=2,'p1-2',np.where(picks[br]<=5,'p3-5','p6+'))
    targets=np.where(bg>=90,'90-95',np.where((bg>=40)&(bg<=69),'40-69','other'))
    broad={};groups=defaultdict(list)
    for target in ('90-95','40-69'):
        for stage in ('p1-2','p3-5','p6+'):
            for c in ('alt-more-mana-fit','fav-more-mana-fit','similar-or-uncommitted','alt-is-source','fav-is-source'):
                mask=(targets==target)&(stages==stage)&(contexts==c)
                broad['|'.join((target,stage,c))]={s:cell(gap[q],by[q],draft[br[q]]) for s,q in [('all',mask),('discovery',mask&train[br]),('test',mask&~train[br])]}
    for i in np.flatnonzero(targets!='other'):
        k=br[i];a=ba[i];l=fav[i]
        groups[(targets[i],stages[i],contexts[i],names[k][l],names[k][a])].append(int(i))
    candidates=defaultdict(list)
    for key,items in groups.items():
        ix=np.asarray(items); d=ix[train[br[ix]]];t=ix[~train[br[ix]]]
        if len(d)<10 or len(t)<10 or len(set(draft[br[d]]))<10 or len(set(draft[br[t]]))<10:continue
        dc=cell(gap[d],by[d],draft[br[d]]);tc=cell(gap[t],by[t],draft[br[t]])
        a=pool_cell([dc]);b=pool_cell([tc]);direction=-1 if key[0]=='90-95' else 1
        if direction*a['gap']<.05 or direction*b['gap']<.05:continue
        # Example from the test partition, not fitted. Require the recurring
        # direction (strong player chose leader for overcredit, alt otherwise).
        matching=t[by[t]==(direction>0)]
        if not len(matching):continue
        i=int(matching[0]);k=br[i];r,pool,pick=ordered[k]
        sample={'pick':int(pick),'prior_pool':list(pool),'favorite':key[3],'alternative':key[4],
                'favorite_grade':95,'alternative_grade':int(bg[i]),
                'alternative_expected':float(gap[i]),'actual_pick':names[k][chosen[k]]}
        candidates[key[0]].append({'pattern':list(key[:3]),'favorite':key[3],'alternative':key[4],
               'discovery':a,'test':b,'example':sample,'rank':direction*a['gap']*math.sqrt(a['comparisons'])})
    return {'context_groups':broad,'recurring_pairs':{t:sorted(v,key=lambda x:-x['rank'])[:8] for t,v in candidates.items()}}

def measure_records(records,metadata,fit):
    ordered,names,z,mana,fixing,supported,missing,chosen,picks,draft,train,boundary=pack_arrays(records,metadata,fit)
    valid=np.isfinite(z)
    br,ba,bl,bd,by,bg=pair_rows(z,valid,chosen)
    bp=logistic(bd);bi=draft[br];bk=picks[br];bt=train[br]
    base_loss=np.logaddexp(0.,bd)-by*bd
    base_full=np.logaddexp.reduce(z,axis=1)-z[np.arange(len(z)),chosen]
    results={'coverage':{'packs':len(z),'drafts':len(set(draft)),'discovery_packs':int(train.sum()),
                         'test_packs':int((~train).sum()),'discovery_drafts':len(set(draft[train])),
                         'test_drafts':len(set(draft[~train])),'pick_counts':dict(Counter(map(int,picks))),
                         'favorite_chosen':int((chosen==bl).sum()),'off_favorite_chosen':int((chosen!=bl).sum()),
                         'comparisons':len(br),'cutoff':boundary},
             'baseline':{s:cells(bp,by,bi,bg,bk,m) for s,m in [('all',np.ones(len(br),dtype=bool)),('discovery',bt),('test',~bt)]},
             'patterns':pattern_report(ordered,names,z,fixing,supported,missing,chosen,picks,draft,train,br,ba,bl,bd,by,bg),
             'grid':{}}
    for arm in ARMS:
        kind,b=arm
        zz=z if kind=='baseline' else z*b if kind=='temperature' else z+b*mana
        # Identical ORIGINAL pairs for paired loss and calibration comparisons.
        d=zz[br,ba]-zz[br,bl[br]]
        p=logistic(d);loss=np.logaddexp(0.,d)-by*d
        full=np.logaddexp.reduce(zz,axis=1)-zz[np.arange(len(z)),chosen]
        rr,aa,ll,dd,yy,gg=pair_rows(zz,valid,chosen)
        test=~train[rr]
        results['grid'][armkey(arm)]={'discovery_loss_sum':float(loss[bt].sum()),'discovery_n':int(bt.sum()),
            'test_loss':cluster(loss[~bt],bi[~bt]),'test_loss_delta':cluster((loss-base_loss)[~bt],bi[~bt]),
            'test_pack_logloss_delta':cluster((full-base_full)[~train],draft[~train]),
            'test_top1_delta':cluster(((ll==chosen).astype(int)-(bl==chosen).astype(int))[~train],draft[~train]),
            'fixed_original_bands':compact_cells(p,by,bi,bg,~bt),
            'regraded_bands':compact_cells(logistic(dd),yy,draft[rr],gg,test),
            'regraded_p1_8':compact_cells(logistic(dd),yy,draft[rr],gg,test&(picks[rr]<=8))}
    return results

def measure(sid,folder,fits_path,output):
    prior=rv.frozen_prior(folder,sid)
    fits=refit.load_fits(fits_path)
    if rv.registry_digest(fits)!=REGISTRY:raise ValueError('wrong frozen reviewed registry')
    fit=refit.check_fit(fits[sid],sid,prior)
    elite,ordinary,metadata,path,prov,model,ids,windows=refit.prepare(sid,exp.directory(sid)/'manifest.json',prior,'validation')
    for k in PROV:
        if prov[k]!=fit['provenance'][k]:raise ValueError('fit provenance mismatch '+k)
    # No outcome filtering. Report distribution only after scoring.
    del ordinary,model,ids
    result=measure_records(elite,metadata,fit['fit'])
    source_ids={r.source for r,_,_ in elite}
    outcomes=stat.selected_outcomes(path,source_ids)
    result['coverage']['observed_draft_match_wins']=dict(Counter(x[1] for x in outcomes.values()))
    result['coverage']['unavailable_outcomes']=len(source_ids)-len(outcomes)
    result.update({'protocol':PROTOCOL,'set':sid,'registry':REGISTRY,'mode':'PremierDraft',
                   'evidence_class':prior['provenance'].get('recovery',{}).get('chronology',{}).get('classification','strict_game_time') if prior['provenance'].get('recovery') else 'strict_game_time',
                   'cohort_cutoff':prov['baseline_cutoff'],'coverage_exclusions':prov['coverage']})
    exp.write(output,result)
    print(json.dumps({'set':sid,'coverage':result['coverage'],'all':{k:pool_cell([v]) for k,v in result['baseline']['all']['all'].items()},'p1-8':{k:pool_cell([v]) for k,v in result['baseline']['all']['p1-8'].items()}},indent=2),flush=True)

def pooled_tables(entries,part):
    scopes=entries[0]['baseline'][part]
    return {s:{b:pool_cell([r['baseline'][part][s][b] for r in entries]) for b in scopes[s]} for s in scopes}

def pick_arm(entries):
    # Only discovery data may decide. Require a reproducible, meaningful
    # gap in a target band: >=3 formats show >=3pp in the same direction,
    # pooled >=3pp and a clustered interval excludes zero.
    eligible=[]
    for scope,band,direction in [('all','90-95',-1),('40-69','40-69',1)]:
        vals=[r['baseline']['discovery'][scope][band] for r in entries]
        pooled=pool_cell(vals)
        support=sum(1 for v in vals if (q:=pool_cell([v]))['comparisons']>=100 and direction*q['gap']>=.03)
        ci=pooled['gap_ci95']
        if ci and support>=3 and direction*pooled['gap']>=.03 and min(direction*x for x in ci)>0:
            eligible.append({'scope':scope,'band':band,'formats':support,'gap':pooled})
    baseline=armkey(ARMS[0])
    loss={armkey(a):sum(r['grid'][armkey(a)]['discovery_loss_sum'] for r in entries) for a in ARMS}
    n=sum(r['grid'][baseline]['discovery_n'] for r in entries)
    best=min(loss,key=lambda k:(loss[k],k!=baseline,k))
    gain=(loss[baseline]-loss[best])/n if n else 0
    selected=best if eligible and gain>=.0001 else baseline
    return selected,{'eligible_recurring_gaps':eligible,'discovery_pair_loss_gain':gain,'chosen':selected}

def correction_report(entries,selected):
    reports=[r['grid'][k] for r,k in zip(entries,selected)]
    baseline=[r['grid'][armkey(ARMS[0])] for r in entries]
    def c(k):
        return {b:pool_cell([r[k][b] for r in reports]) for b in BANDS}
    return {'selected_by_format':{r['set']:k for r,k in zip(entries,selected)},
            'test_pair_logloss':estimate(combine_moments([r['test_loss'] for r in reports])),
            'test_pair_logloss_delta':estimate(combine_moments([r['test_loss_delta'] for r in reports])),
            'test_pack_logloss_delta':estimate(combine_moments([r['test_pack_logloss_delta'] for r in reports])),
            'test_top1_delta':estimate(combine_moments([r['test_top1_delta'] for r in reports])),
            'baseline_pair_logloss':estimate(combine_moments([r['test_loss'] for r in baseline])),
            'fixed_original_bands':c('fixed_original_bands'),'regraded_bands':c('regraded_bands'),
            'regraded_p1_8':c('regraded_p1_8'),
            'per_format':{r['set']:{'pair_loss_delta':estimate(q['test_loss_delta']),'pack_loss_delta':estimate(q['test_pack_logloss_delta']),
                                   'top1_delta':estimate(q['test_top1_delta']),'regraded_bands':{b:pool_cell([v]) for b,v in q['regraded_bands'].items()}}
                          for r,q in zip(entries,reports)}}

def aggregate(folder,output):
    rr=[read_json(p) for p in sorted(folder.glob('*/report.json'))]
    if len(rr)!=len(exp.SETS) or {r['set'] for r in rr}!=set(exp.SETS):raise ValueError('incomplete per-format evidence')
    if any(r['protocol']!=PROTOCOL or r['registry']!=REGISTRY for r in rr):raise ValueError('mixed provenance')
    out={'protocol':PROTOCOL,'formats':len(rr),'coverage':{r['set']:r['coverage'] for r in rr},'scopes':{},
         'per_format':{r['set']:{'tables':pooled_tables([r],'all'),'patterns':r['patterns']['recurring_pairs']} for r in rr}}
    mixed=[r for r in rr if r['set']!='powered-cube']
    for label,entries in [('all',rr),('mixed',mixed),('cube',[r for r in rr if r['set']=='powered-cube']),
                          ('strict-mixed',[r for r in mixed if r['evidence_class']=='strict_game_time']),
                          ('legacy-mixed',[r for r in mixed if r['evidence_class']!='strict_game_time'])]:
        if not entries:continue
        selected,decision=pick_arm(entries)
        loo=[pick_arm([s for s in rr if s['set']!=r['set']])[0] for r in entries]
        patterns={k:{s:pool_cell([r['patterns']['context_groups'][k][s] for r in entries]) for s in ('all','discovery','test')} for k in entries[0]['patterns']['context_groups']}
        out['scopes'][label]={'baseline':pooled_tables(entries,'all'),'discovery':pooled_tables(entries,'discovery'),
               'test':pooled_tables(entries,'test'),'patterns':patterns,'correction_decision':decision,
               'later_drafts':correction_report(entries,[selected]*len(entries)),
               'other_format_fit_later_drafts':correction_report(entries,loo)}
    exp.write(output,out)
    print(json.dumps({'all':out['scopes']['all']['baseline']['all'],'p1-8':out['scopes']['all']['baseline']['p1-8'],
                      'correction_decision':out['scopes']['all']['correction_decision'],
                      'correction_later':{k:v for k,v in out['scopes']['all']['later_drafts'].items() if k!='per_format'},
                      'correction_transfer':{k:v for k,v in out['scopes']['all']['other_format_fit_later_drafts'].items() if k!='per_format'}},indent=2),flush=True)

def self_test():
    z=np.log(np.array([[.6,.3,.1],[.5,.4,.1],[.55,.25,.2]]))
    rr,aa,ll,dd,yy,gg=pair_rows(z,np.isfinite(z),np.array([0,1,2]))
    assert rr.tolist()==[0,0,1,2] and aa.tolist()==[1,2,1,2]
    assert yy.tolist()==[0,0,1,1] and gg.tolist()==[48,16,76,35]
    assert math.isclose(logistic(dd)[0],1/3)
    v=cell(np.array([.3,.4,.5]),np.array([0,1,1]),np.array([0,0,1]))
    q=pool_cell([v]);assert q['comparisons']==3 and q['drafts']==2 and math.isclose(q['gap'],2/3-.4)
    assert math.isclose(estimate(cluster(np.array([.1,.2,.3]),np.array([0,0,1])))['mean'],.2)
    assert len({armkey(a) for a in ARMS})==len(ARMS)
    print('Pair filtering, exact support odds, linear grade, draft-cluster and arm identity contracts passed.',flush=True)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--stage',choices=('measure','aggregate'));p.add_argument('--set',choices=sorted(exp.SETS))
    for k in ('prior','fits','folder','output'):p.add_argument('--'+k,type=Path)
    a=p.parse_args()
    if a.self_test:self_test()
    elif a.stage=='measure':measure(a.set,a.prior,a.fits,a.output)
    elif a.stage=='aggregate':aggregate(a.folder,a.output)
    else:p.error('stage required')
if __name__=='__main__':main()
