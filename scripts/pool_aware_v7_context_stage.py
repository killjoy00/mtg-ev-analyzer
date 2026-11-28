#!/usr/bin/env python3
"""#1863: one residual-only chronological stage-interaction comparison."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import numpy as np
from scipy.optimize import minimize
from scipy.special import logsumexp
import pool_aware_skill_expansion as exp
import pool_aware_skill_contrast as skill
import pool_aware_skill_final_correction as final
import pool_aware_skill_reviewed_validation as reviewed
import pool_aware_v7_refit as refit
import pool_aware_mana_final as mana
import pool_aware_mana_parser_v2 as v2
from pool_aware_refit import weights, Choice
from pool_aware_archive import read_json, sha256
from pool_aware_diagnostics import grade

PROTOCOL = 'v7-context-stage-residual-v1'
DRAWS = 400
COHORTS = ('elite', 'control')
TARGETS = {'blb': 'Agate Assault', 'powered-cube': "Yawgmoth's Will"}

def seed(sid):
    return int.from_bytes(hashlib.sha256((exp.PROTOCOL+'|'+sid).encode()).digest()[:8], 'big')

def split(elite, ordinary):
    # One chronological cutoff across both cohorts. Keep all tied source
    # timestamps together, choosing the closest boundary to 70% of drafts.
    time = {}
    for r, _, _ in elite + ordinary:
        if r.source in time and time[r.source] != r.event_time:
            raise ValueError('inconsistent source time')
        time[r.source] = r.event_time
    if {r.source for r,_,_ in elite} & {r.source for r,_,_ in ordinary}:
        raise ValueError('cohort overlap')
    counts = Counter(time.values())
    times = sorted(counts)
    if len(times) < 2:
        raise ValueError('insufficient time groups')
    n = len(time)
    k = 0
    choices = []
    for t in times[:-1]:
        k += counts[t]
        choices.append((abs(10*k-7*n), t, k))
    _, cutoff, ntrain = min(choices)
    fit, test = {}, {}
    for c, records in zip(COHORTS, (elite,ordinary)):
        fit[c] = [x for x in records if x[0].event_time <= cutoff]
        test[c] = [x for x in records if x[0].event_time > cutoff]
        if not fit[c] or not test[c] or len({r.source for r,_,_ in test[c]}) < 2:
            raise ValueError('empty/insufficient chronological cohort '+c)
    assert not ({r.source for rows in fit.values() for r,_,_ in rows} &
                {r.source for rows in test.values() for r,_,_ in rows})
    return fit,test,{'cutoff_inclusive':cutoff,'training_drafts':ntrain,'holdout_drafts':n-ntrain,
                     'training_fraction':ntrain/n}

def features(records, rules):
    return [(final.fit_features(r,p,rules), k) for r,p,k in records]

def stage_fit(records, cards, card_penalty):
    # Same objective, normalization, card sentinel, L2 and optimizer as
    # skill.cohort_fit. Context design is [f*early, f*late]; no intercept.
    n=len(records); width=max(len(r.candidates) for r,_ in records)
    size=len(cards); ix=np.arange(n); ids={c:i for i,c in enumerate(cards)}
    offset=np.full((n,width),-np.inf)
    f=np.zeros((n,width,6)); indexes=np.full((n,width),size,dtype=np.intp)
    chosen=np.empty(n,dtype=np.intp); stage=np.empty(n,dtype=np.intp)
    for i,(row,k) in enumerate(records):
        m=len(row.candidates); offset[i,:m]=np.log(row.support)
        f[i,:m]=np.asarray(row.features)[:,:6]
        indexes[i,:m]=[ids.get(c,size) for c in row.candidates]
        chosen[i]=row.chosen; stage[i]=int(k>4)
    blocks=[np.flatnonzero(stage==s) for s in (0,1)]
    if not all(len(b) for b in blocks):
        raise ValueError('missing stage in fit')
    cf=np.stack([f[b,chosen[b]].sum(axis=0)/n for b in blocks])
    cc=np.bincount(indexes[ix,chosen],minlength=size+1)[:size]/n
    def objective(b):
        ctx=b[:12].reshape(2,6); card=b[12:]
        logits=offset+np.einsum('nkd,nd->nk',f,ctx[stage])+np.append(card,0.)[indexes]
        norm=logsumexp(logits,axis=1); probs=np.exp(logits-norm[:,None])
        loss=(norm-logits[ix,chosen]).mean()+.5*(skill.CONTEXT_PENALTY*np.dot(b[:12],b[:12])+card_penalty*np.dot(card,card))
        byrow=np.einsum('nk,nkd->nd',probs,f)
        gc=np.stack([byrow[b].sum(axis=0)/n for b in blocks])-cf+skill.CONTEXT_PENALTY*ctx
        gi=np.bincount(indexes.ravel(),weights=probs.ravel(),minlength=size+1)[:size]/n-cc+card_penalty*card
        return float(loss),np.concatenate([gc.ravel(),gi])
    result=minimize(objective,np.zeros(12+size),jac=True,method='L-BFGS-B',
        options={'maxiter':1000,'gtol':1e-6/math.sqrt(12+size),'ftol':1e-15})
    loss,grad=objective(result.x); norm=float(np.linalg.norm(grad))
    if not math.isfinite(loss) or norm>1e-6:
        raise RuntimeError('stage fit did not converge: '+str(norm))
    return (tuple(tuple(map(float,x)) for x in result.x[:12].reshape(2,6)),
            dict(zip(cards,map(float,result.x[12:]))),
            {'decisions':n,'iterations':int(result.nit),'objective':loss,'gradient_norm':norm,'converged':True})

def fit_models(train,rules):
    f={c:features(train[c],rules) for c in COHORTS}
    cards=skill.eligible_cards([r for r,_ in f['elite']],[r for r,_ in f['control']])
    penalty=skill.CARD_PRIOR/min(len(f['elite']),len(f['control']))
    models={}
    for c in COHORTS:
        models[c]={'single':skill.cohort_fit([r for r,_ in f[c]],cards,penalty),
                   'stage':stage_fit(f[c],cards,penalty)}
    return models, len(cards), penalty

def params(models, arm, pick):
    e=models['elite'][arm]; o=models['control'][arm]
    return (e[0] if arm=='single' else e[0][int(pick>4)],
            {c:e[1][c]-o[1][c] for c in e[1]})

def probabilities(r,pool,k,rules,ctx,cards):
    return weights(final.apply(r,pool,rules,ctx,cards),skill.APPLY)

def late_classes(pool,candidates,rules):
    # Descriptive only: mandatory printed WUBRG evidence, unique primary
    # color by counts of prior spells. All routes must require a color
    # outside primary for either class; flexible/ambiguous routes excluded.
    demand=Counter(c for name in pool for c in v2.requirements(rules.get(name).mandatory)
                   if c in mana.COLORS)
    if not demand:
        return {}
    rank=demand.most_common()
    if len(rank)>1 and rank[0][1]==rank[1][1]:
        return {}
    main=rank[0][0]; second=set(demand)-{main}
    groups={}
    for i,name in enumerate(candidates):
        card=rules.get(name)
        if card.status!='readable' or not card.routes:
            continue
        extras=[{c for c,n in zip(mana.COLORS,route) if n}-{main} for route in card.routes]
        if all(x and x<=second for x in extras):
            groups[i]='second_color'
        elif all(x-second for x in extras):
            groups[i]='off_color'
    return groups

def summarize(total,boot):
    n,s,t=total
    if n<=0 or np.any(boot[:,0]<=0):
        raise ValueError('no holdout observations')
    d=(boot[:,2]-boot[:,1])/boot[:,0]
    return {'decisions':int(n),'single_log_loss':float(s/n),'stage_log_loss':float(t/n),
            'delta':float((t-s)/n),'ci95':np.percentile(d,[2.5,97.5]).tolist()}

def measure_cohort(sid, records, rules, models):
    # Precompute the three coefficient vectors/card contrasts once.
    par={k:[params(models,'single',k),params(models,'stage',k)] for k in (1,5)}
    clusters=defaultdict(lambda: np.zeros(3)); late=defaultdict(lambda:np.zeros(4))
    examples=[]
    for r,pool,k in records:
        a,b=[probabilities(r,pool,k,rules,*x) for x in par[1 if k<=4 else 5]]
        clusters[r.source]+=np.array([1.,-math.log(a[r.chosen]),-math.log(b[r.chosen])])
        if 8<=k<=10:
            for i,g in late_classes(pool,r.candidates,rules).items():
                for key in (g, str(k)+'/'+g):
                    late[key]+=[1.,float(i==r.chosen),a[i],b[i]]
        target=TARGETS.get(sid)
        if target and target in r.candidates and (k==10 if sid=='blb' else k>=5):
            # Residual analogues only: exact historical audit pack is not
            # identified by public comment and validation labels forbidden.
            demand=Counter(c for name in pool for c in v2.requirements(rules.get(name).mandatory))
            match=(set(demand)=={'G'} if sid=='blb' else
                   {'Polluted Delta','Frantic Search',"Lion's Eye Diamond"}<=set(pool))
            if match:
                i=r.candidates.index(target)
                examples.append({'card':target,'pick':k,'pool':sorted(pool),'pack':list(r.candidates),
                    'v6_grade':grade(r.support)[i],'single_grade':grade(a)[i],'stage_grade':grade(b)[i],
                    'scope':'residual holdout analogue, not the exact earlier audit pack'})
    arr=np.stack([clusters[d] for d in sorted(clusters)]); n=len(arr)
    rng=np.random.default_rng(seed(sid)); boot=np.empty((DRAWS,3))
    for j in range(DRAWS):
        boot[j]=np.bincount(rng.integers(0,n,size=n),minlength=n)@arr
    total=arr.sum(axis=0)
    # Stable selection unrelated to delta or picked card. No source IDs exported.
    examples=sorted(examples,key=lambda x:(x['pick'],x['pool'],x['pack']))[:5]
    return {'drafts':n,'total':total.tolist(),'bootstrap':boot.tolist(),
            'summary':summarize(total,boot),'late':{g:v.tolist() for g,v in late.items()},
            'examples':examples}

def rates(late):
    return {k:{'offers':int(v[0]),'picks':int(v[1]),'observed_rate':v[1]/v[0],
               'single_expected_rate':v[2]/v[0],'stage_expected_rate':v[3]/v[0]}
            for k,v in sorted(late.items()) if v[0]>0}

def measure(sid,folder,output):
    prior=reviewed.frozen_prior(folder,sid)
    e,o,metadata,_,prov,_,_,_=refit.prepare(sid,exp.directory(sid)/'manifest.json',prior,'residual')
    if prov['phase']!='residual':
        raise ValueError('non-residual phase')
    for c,rs in zip(COHORTS,(e,o)):
        if len(rs)!=prior['fit'][c]['decisions']:
            raise ValueError('frozen residual count mismatch '+c)
    train,test,cut=split(e,o); rules=mana.index(metadata)
    models,eligible,penalty=fit_models(train,rules)
    classification=((prior['provenance'].get('recovery') or {}).get('chronology') or {}).get(
        'classification','strict_game_time')
    if classification not in ('strict_game_time','source_draft_disjoint_only'):
        raise ValueError('unknown chronology')
    report={'protocol':PROTOCOL,'set':sid,'phase':'residual','draws':DRAWS,'seed':seed(sid),
        'code_sha256':sha256(Path(__file__)),'evidence_class':classification,'split':cut,
        'features':list(skill.FEATURES[:6]),'context_penalty':skill.CONTEXT_PENALTY,
        'eligible_cards':eligible,'card_penalty':penalty,'provenance':prov,
        'coefficients':{c:{a:{'context':v[0],'optimizer':v[2]} for a,v in arms.items()}
                        for c,arms in models.items()},'cohorts':{}}
    for c in COHORTS:
        report['cohorts'][c]=measure_cohort(sid,test[c],rules,models)
        report['cohorts'][c]['training_drafts']=len({r.source for r,_,_ in train[c]})
        report['cohorts'][c]['late_rates']=rates(report['cohorts'][c]['late'])
    exp.write(output,report)
    print(json.dumps({'set':sid,'split':cut,'summary':{c:v['summary'] for c,v in report['cohorts'].items()}},allow_nan=False))

def pool(reports):
    out={}
    for c in COHORTS:
        banks=[r['cohorts'][c] for r in reports]
        total=np.sum([x['total'] for x in banks],axis=0)
        boot=np.sum([x['bootstrap'] for x in banks],axis=0)
        late=defaultdict(lambda:np.zeros(4))
        for x in banks:
            for k,v in x['late'].items():
                late[k]+=v
        out[c]={**summarize(total,boot),'drafts':sum(x['drafts'] for x in banks),'late_rates':rates(late)}
    return out

def decide(pooled, reports):
    s=pooled['Strict']['elite']; o=pooled['All formats']['control']
    worst=max(r['cohorts']['elite']['summary']['delta'] for r in reports)
    checks={'strict_elite_upper_below_zero':{'value':s['ci95'][1],'pass':s['ci95'][1]<0},
        'all_format_elite_delta_at_most_0.002':{'value':worst,'pass':worst<=.002},
        'all_formats_control_upper_at_most_0.001':{'value':o['ci95'][1],'pass':o['ci95'][1]<=.001}}
    return {'adopt':all(v['pass'] for v in checks.values()),'criteria':checks}

def aggregate(folder,output,summary):
    reports={}
    for p in sorted(folder.rglob('stage-report.json')):
        r=read_json(p); sid=r['set']
        if (sid in reports or sid not in exp.SETS or r['protocol']!=PROTOCOL or
            r['phase']!='residual' or r['draws']!=DRAWS or r['seed']!=seed(sid) or
            r['code_sha256']!=sha256(Path(__file__))):
            raise ValueError('incompatible report '+sid)
        reports[sid]=r
    if set(reports)!=set(exp.SETS):
        raise ValueError('missing formats '+str(sorted(set(exp.SETS)-set(reports))))
    groups={'Strict':[r for s,r in reports.items() if s!='powered-cube' and r['evidence_class']=='strict_game_time'],
            'Legacy':[r for s,r in reports.items() if s!='powered-cube' and r['evidence_class']=='source_draft_disjoint_only'],
            'Powered Cube':[reports['powered-cube']],
            'Strict including Cube if strict':[r for r in reports.values() if r['evidence_class']=='strict_game_time'],
            'All formats':list(reports.values())}
    pooled={k:pool(v) for k,v in groups.items()}
    decision=decide(pooled,list(reports.values()))
    result={'protocol':PROTOCOL,'phase':'residual','groups':{k:[r['set'] for r in v] for k,v in groups.items()},
            'pooled':pooled,'formats':reports,'decision':decision,'release_allowed':False}
    exp.write(output,result)
    lines=['# Context coefficients by pick stage — residual holdout','',
           'Decision: '+('ADOPT stage structure for replacement refit' if decision['adopt'] else 'KEEP single context coefficients'),
           '', 'Strict non-Cube pooled strong deciding population (existing mixed convention); ordinary pool includes all formats; Cube separately reported and included in all-format veto.',
           'Negative delta favors stage. All estimates are decision-weighted; paired 400 whole-draft resamples.','',
           '| Format | Strong N | Strong single | Strong stage | Strong delta [95% CI] | Ordinary N | Ordinary single | Ordinary stage | Ordinary delta [95% CI] |',
           '|---|---:|---:|---:|---|---:|---:|---:|---|']
    def cell(x):
        return f"{x['decisions']} | {x['single_log_loss']:.6f} | {x['stage_log_loss']:.6f} | {x['delta']:+.6f} [{x['ci95'][0]:+.6f}, {x['ci95'][1]:+.6f}]"
    for k,v in list(pooled.items())+[(s,{c:x['summary'] for c,x in r['cohorts'].items()}) for s,r in sorted(reports.items())]:
        lines.append(f"| {k} | {cell(v['elite'])} | {cell(v['control'])} |")
    lines+=['','Decision criteria: '+json.dumps(decision),'','## Coefficients and late-pick diagnostics']
    for k,r in sorted(reports.items()):
        lines+=['', '### '+k, 'Split: '+json.dumps(r['split']), 'Coefficients: '+json.dumps(r['coefficients'])]
        for c,x in r['cohorts'].items():
            lines+=[c+' rates: '+json.dumps(x['late_rates'])]
            if x['examples']:
                lines+=[c+' analogues: '+json.dumps(x['examples'])]
    lines+=['','Exact historical audit examples are not reconstructed from validation labels; residual analogues are explicitly distinct.']
    summary.parent.mkdir(parents=True,exist_ok=True)
    summary.write_text('\n'.join(lines)+'\n',encoding='utf8')
    print(json.dumps({'groups':result['groups'],'decision':decision},indent=2))

def self_test():
    def row(i,c):
        k=2 if i%2==0 else 9
        r=Choice(f'{c}{i}',f'2025-01-{i//20+1:02d}T00:00:00Z',('a','b'),(.5,.5),
                 ((1.,)+(0.,)*7,(0.,)*8),int((i%2)==0))
        return r,(),k
    e=[row(i,'e') for i in range(200)]; o=[row(i,'o') for i in range(200)]
    tr,te,info=split(e,o)
    assert info['training_fraction']==.7
    f=[(r,k) for r,_,k in tr['elite']]
    cards=('a','b'); p=skill.CARD_PRIOR/len(f)
    base=skill.cohort_fit([r for r,_ in f],cards,p)
    stage=stage_fit(f,cards,p)
    assert stage[0][0][0]<0<stage[0][1][0]
    assert stage[2]['converged'] and base[2]['converged']
    assert max(abs(x) for x in mana.bounded([100.,-100.]))<=mana.HALF_SPAN
    t=np.array([10.,5.,4.])
    assert summarize(t,np.tile(t,(400,1)))['ci95']==[-.1,-.1]
    print('Chronological draft split, two-stage fit, fixed card prior, clipping and paired summary passed.')

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--set'); p.add_argument('--prior',type=Path)
    p.add_argument('--aggregate',type=Path); p.add_argument('--output',type=Path)
    p.add_argument('--summary',type=Path)
    a=p.parse_args()
    if a.self_test: self_test()
    elif a.aggregate: aggregate(a.aggregate,a.output,a.summary)
    else: measure(a.set,a.prior,a.output)

if __name__=='__main__':
    main()
