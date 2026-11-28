#!/usr/bin/env python3
"""#1863: fixed rarity-mean comparison, residual-only, no serving writes."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
import math
from pathlib import Path
import random
import subprocess

import numpy as np
from scipy.optimize import minimize
from scipy.special import logsumexp

import pool_aware_v7_context_stage as stage
import pool_aware_skill_expansion as exp
import pool_aware_skill_contrast as skill
import pool_aware_skill_reviewed_validation as reviewed
import pool_aware_skill_context_validation as ctx
import pool_aware_statistical_validation as stat
import pool_aware_v7_refit as refit
import pool_aware_mana_final as mana
import scoring_experiment as scoring
from pool_aware_archive import read_json, sha256
from pool_aware_diagnostics import grade
from pool_aware_refit import Choice, weights

PROTOCOL='v7-rarity-shrinkage-residual-v1'
STAGE_RUN=46160142490
DRAWS=stage.DRAWS
COHORTS=stage.COHORTS
ARMS=('zero','rarity')
GROUPS=('common','uncommon','rare','mythic','special','unknown','cube')
FREE=GROUPS[1:5]
FIXED=('common','unknown','cube')
WIDTH=96
SNAPSHOT_PROTOCOL='production-corpus-rarity-exact-name-v1'

def seed(sid,cohort):
    return int.from_bytes(hashlib.sha256((PROTOCOL+'|'+sid+'|'+cohort).encode()).digest()[:8],'big')

def rarity(value):
    if not isinstance(value,str) or not value.strip():
        return None
    v=value.strip().lower()
    if v in GROUPS[:4]:
        return v
    if v in ('special','bonus','bonus-sheet','bonus_sheet','bonus sheet','timeshifted'):
        return 'special'
    return None

def group_for(sid,name,metadata,records):
    if sid=='powered-cube':
        return 'cube','cube-single-group'
    entry=metadata.get(name)
    if isinstance(entry,dict) and rarity(entry.get('rarity')):
        return rarity(entry['rarity']),'pinned-metadata'
    observed=records.get(name,[])
    valid={rarity(v) for v in observed}
    valid.discard(None)
    if len(valid)==1:
        return next(iter(valid)),'production-exact-name'
    return 'unknown','production-conflict' if len(valid)>1 else 'unrecorded'

def snapshot(connection_file,output):
    # Never query individual player data, puzzle/source IDs or chosen labels.
    # Corpus candidate card names/printed rarity only; stable read-only snapshot.
    import psycopg
    from model_training import V6_CORPUS
    result={}
    with psycopg.connect(connection_file.read_text().strip()) as conn:
        conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        if conn.execute('SHOW transaction_read_only').fetchone()[0]!='on':
            raise ValueError('production transaction not read-only')
        conn.execute("SET LOCAL statement_timeout='180s'")
        revision=conn.execute('SELECT revision::text FROM draft_run_serving_revision WHERE singleton').fetchone()[0]
        for sid in sorted(exp.SETS):
            if sid=='powered-cube':
                result[sid]={}
                continue
            rows=conn.execute("""SELECT DISTINCT c->>'name',c->>'rarity'
                FROM draft_run_verified_puzzles p
                CROSS JOIN LATERAL jsonb_array_elements(p.payload->'candidates') c
                WHERE p.set_id=%s AND p.corpus_version=%s
                  AND c->>'name' IS NOT NULL AND c->>'rarity' IS NOT NULL
                ORDER BY 1,2""",(sid,V6_CORPUS)).fetchall()
            cards=defaultdict(list)
            for name,value in rows:
                cards[name].append(value)
            result[sid]=dict(cards)
            print(json.dumps({'set':sid,'distinct_card_names':len(cards)}),flush=True)
        conn.rollback()
    exp.write(output,{'protocol':SNAPSHOT_PROTOCOL,'project':'patient-shadow-91417882',
        'branch':'br-orange-feather-ayps8kep','database':'pack1','corpus_version':V6_CORPUS,
        'revision':revision,'source':'draft_run_verified_puzzles.payload.candidates: distinct exact name and rarity',
        'transaction':'repeatable read read only','sets':result})

def fit_rarity(records,cards,penalty,groups,staged):
    # Same unscaled conditional multinomial objective and gradient as baseline.
    # Each group receives one intercept; common/unknown/cube are fixed zero.
    # The sparse card sentinel receives no u coefficient, not a fake observation.
    n=len(records)
    width=max(len(r.candidates) for r,_ in records)
    size=len(cards); ng=len(FREE); nc=12 if staged else 6
    ids={c:i for i,c in enumerate(cards)}; gids={g:i for i,g in enumerate(FREE)}
    offset=np.full((n,width),-np.inf); f=np.zeros((n,width,6))
    ix=np.arange(n); chosen=np.empty(n,dtype=np.intp); bucket=np.empty(n,dtype=np.intp)
    u=np.full((n,width),size,dtype=np.intp); g=np.full((n,width),ng,dtype=np.intp)
    for i,(row,k) in enumerate(records):
        m=len(row.candidates); offset[i,:m]=np.log(row.support)
        f[i,:m]=np.asarray(row.features)[:,:6]
        u[i,:m]=[ids.get(c,size) for c in row.candidates]
        g[i,:m]=[gids.get(groups[c],ng) for c in row.candidates]
        chosen[i]=row.chosen; bucket[i]=int(staged and k>4)
    blocks=[np.flatnonzero(bucket==s) for s in range(nc//6)]
    if not all(len(b) for b in blocks):
        raise ValueError('empty context stage')
    cf=np.stack([f[b,chosen[b]].sum(axis=0)/n for b in blocks])
    cu=np.bincount(u[ix,chosen],minlength=size+1)[:size]/n
    cg=np.bincount(g[ix,chosen],minlength=ng+1)[:ng]/n
    uf=u.ravel(); gf=g.ravel()
    def objective(b):
        context=b[:nc].reshape(-1,6); means=b[nc:nc+ng]; residual=b[nc+ng:]
        logits=offset+np.einsum('nkd,nd->nk',f,context[bucket])+np.append(means,0.)[g]+np.append(residual,0.)[u]
        norm=logsumexp(logits,axis=1); probs=np.exp(logits-norm[:,None])
        loss=(norm-logits[ix,chosen]).mean()+.5*(skill.CONTEXT_PENALTY*(np.dot(b[:nc],b[:nc])+np.dot(means,means))+penalty*np.dot(residual,residual))
        byrow=np.einsum('nk,nkd->nd',probs,f)
        gc=np.stack([byrow[z].sum(axis=0)/n for z in blocks])-cf+skill.CONTEXT_PENALTY*context
        gu=np.bincount(uf,weights=probs.ravel(),minlength=size+1)[:size]/n-cu+penalty*residual
        gg=np.bincount(gf,weights=probs.ravel(),minlength=ng+1)[:ng]/n-cg+skill.CONTEXT_PENALTY*means
        return float(loss),np.concatenate([gc.ravel(),gg,gu])
    result=minimize(objective,np.zeros(nc+ng+size),jac=True,method='L-BFGS-B',
        options={'maxiter':1000,'gtol':1e-6/math.sqrt(nc+ng+size),'ftol':1e-15})
    loss,grad=objective(result.x); gn=float(np.linalg.norm(grad))
    if not math.isfinite(loss) or gn>1e-6:
        raise RuntimeError('rarity fit did not converge: '+str(gn))
    context=tuple(tuple(map(float,x)) for x in result.x[:nc].reshape(-1,6))
    means={**dict.fromkeys(FIXED,0.),**dict(zip(FREE,map(float,result.x[nc:nc+ng])))}
    residual=dict(zip(cards,map(float,result.x[nc+ng:])))
    effects={name:means[group]+residual.get(name,0.) for name,group in groups.items()}
    return {'context':context,'means':means,'effects':effects,'residuals':residual,
            'optimizer':{'decisions':n,'iterations':int(result.nit),'objective':loss,'gradient_norm':gn,'converged':True}}

def fit_models(train,rules,groups,staged,sid):
    features={c:stage.features(train[c],rules) for c in COHORTS}
    cards=skill.eligible_cards(*[[r for r,_ in features[c]] for c in COHORTS])
    penalty=skill.CARD_PRIOR/min(len(features[c]) for c in COHORTS)
    models={}
    for c in COHORTS:
        f=features[c]
        context,effects,report=(stage.stage_fit(f,cards,penalty) if staged else
            skill.cohort_fit([r for r,_ in f],cards,penalty))
        base={'context':context if staged else (context,),
            'means':dict.fromkeys(GROUPS,0.),'effects':effects,'residuals':effects,'optimizer':report}
        # With all group means fixed zero this is mathematically the identical
        # model. Reuse the exact baseline fit to avoid numeric pseudo-changes.
        other=base if sid=='powered-cube' else fit_rarity(f,cards,penalty,groups,staged)
        models[c]={'zero':base,'rarity':other}
    return models,set(cards),penalty

def params(models,arm):
    e,o=(models[c][arm] for c in COHORTS)
    keys=e['effects'].keys()|o['effects'].keys()
    return e['context'],{k:e['effects'].get(k,0.)-o['effects'].get(k,0.) for k in keys}

def bucket(ctx,k):
    return ctx[int(len(ctx)==2 and k>4)]

def raw_cohort_loss(row,k,model):
    # Diagnostic: unscaled conditional model's own likelihood. Primary loss
    # uses served contrast probabilities, matching prompt 2's raw log loss.
    context=bucket(model['context'],k)
    logits=[math.log(q)+sum(a*b for a,b in zip(f[:6],context))+model['effects'].get(n,0.)
        for q,f,n in zip(row.support,row.features,row.candidates)]
    return float(logsumexp(logits)-logits[row.chosen])

def auc_hist(e,o):
    n=float(e.sum()*o.sum())
    if n<=0:
        raise ValueError('empty AUC cohort')
    return float(e@(np.cumsum(o)-.5*o)/n)

def interval(samples):
    if len(samples)<.9*DRAWS:
        raise ValueError('insufficient paired bootstrap draws')
    return np.percentile(samples,[2.5,97.5]).tolist()

def pick_auc(a,b):
    v=[auc_hist(a[5+i*WIDTH:5+(i+1)*WIDTH],b[5+i*WIDTH:5+(i+1)*WIDTH]) for i in range(2)]
    return v

def loss_stats(total,boot):
    n=total[0]
    if n<=0 or np.any(boot[:,0]<=0):
        raise ValueError('empty holdout')
    def stats(i,j):
        return {'zero':float(total[i]/n),'rarity':float(total[j]/n),
            'delta':float((total[j]-total[i])/n),'ci95':interval((boot[:,j]-boot[:,i])/boot[:,0])}
    return {'decisions':int(n),'raw_contrast_log_loss':stats(1,2),'unscaled_own_cohort_log_loss':stats(3,4)}

def measure_cohort(sid,c,records,rules,models):
    par={a:params(models,a) for a in ARMS}
    # Loss totals and chosen model-only score histograms grouped by whole
    # source; never export source IDs or row-level labels.
    clusters=defaultdict(lambda:np.zeros(5+2*WIDTH))
    bank=[]
    local={d:i for i,d in enumerate(sorted({r.source for r,_,_ in records},
        key=lambda d:hashlib.sha256((PROTOCOL+'|'+sid+'|'+d).encode()).digest()))}
    for r,pool,k in records:
        x=clusters[r.source]; x[0]+=1
        grades=[]
        for i,a in enumerate(ARMS):
            context,cards=par[a]
            p=stage.probabilities(r,pool,k,rules,bucket(context,k),cards)
            x[1+i]-=math.log(p[r.chosen])
            g=grade(p)[r.chosen]; x[5+i*WIDTH+g]+=1
            grades.append(g)
        f=stage.features([(r,pool,k)],rules)[0][0]
        for i,a in enumerate(ARMS):
            x[3+i]+=raw_cohort_loss(f,k,models[c][a])
        if len(r.candidates)>=4:
            bank.append([c,local[r.source],k,scoring.band(r.support),*grades])
    arr=np.stack([clusters[d] for d in sorted(clusters)]); n=len(arr)
    rng=np.random.default_rng(seed(sid,c))
    boot=np.empty((DRAWS,arr.shape[1]))
    for j in range(DRAWS):
        boot[j]=np.bincount(rng.integers(0,n,size=n),minlength=n)@arr
    total=arr.sum(axis=0)
    return {'drafts':n,'total':total.tolist(),'bootstrap':boot.tolist(),'summary':loss_stats(total,boot)},bank

def profile_auc(sid,bank):
    # Use the same historical run-profile generator, difficulty bands, model
    # grades, source bootstrap, and eight-pick sampling as reviewed v7.
    # If coverage does not support profiles, use the explicitly allowed
    # pick-level fallback. Technical failures are never disguised as coverage.
    rows=list(stat.simulation_rows(sid,bank,'rarity'))
    scoring.MODELS=['v6','rarity'];scoring.EXPONENTS=[1.]
    scoring.BASELINE=stat.BASE;scoring.SEED=stat.SEED
    env='powered-cube' if sid=='powered-cube' else 'mixed'
    try:
        profiles=ctx.profile_request(rows,env,stat.RUNS,single=sid)
    except subprocess.CalledProcessError as exc:
        if 'Insufficient held-out coverage for this run profile' not in (exc.stderr or ''):
            raise
        return {'status':'unavailable','reason':'insufficient residual holdout profile coverage'}
    v,n=scoring.simulate(rows,profiles)
    if n<.9*len(profiles):
        return {'status':'unavailable','reason':'insufficient distinct source drafts'}
    keys=(stat.BASE,'rarity|1')
    point=[scoring.auc(v['elite'][k],v['control'][k]) for k in keys]
    samples=[]
    rng=random.Random(stat.SEED+1)
    for j in range(DRAWS):
        v,n=scoring.simulate(scoring.resample_sources(rows,rng),profiles[:stat.BOOTSTRAP_RUNS],stat.SEED+j)
        if n<.9*min(len(profiles),stat.BOOTSTRAP_RUNS):
            samples.append(None)
        else:
            samples.append([scoring.auc(v['elite'][k],v['control'][k]) for k in keys])
    if sum(x is not None for x in samples)<.9*DRAWS:
        return {'status':'unavailable','reason':'insufficient valid paired profile resamples'}
    return {'status':'measured','point':point,'bootstrap':samples,'profiles':len(profiles)}

def rarity_summary(groups,provenance,eligible,models):
    effects={a:params(models,a)[1] for a in ARMS}
    out={}
    for g in GROUPS:
        out[g]={}
        for label in ('eligible','ineligible'):
            names=[n for n in groups if groups[n]==g and (n in eligible)==(label=='eligible')]
            out[g][label]={'cards':len(names),'rarity_provenance':dict(Counter(provenance[n] for n in names))}
            for a in ARMS:
                out[g][label][a+'_mean_contrast']=(math.fsum(effects[a].get(n,0.) for n in names)/len(names) if names else None)
    return out

def stage_input(path):
    result=read_json(path)
    if (result.get('protocol')!=stage.PROTOCOL or result.get('phase')!='residual' or
        result.get('release_allowed') is not False or set(result.get('formats',{}))!=set(exp.SETS)
        or not isinstance(result.get('decision',{}).get('adopt'),bool)):
        raise ValueError('missing or invalid prompt 2 decision')
    for s,r in result['formats'].items():
        if (r.get('code_sha256')!=sha256(Path(stage.__file__)) or r.get('set')!=s or r.get('phase')!='residual'):
            raise ValueError('prompt 2 report provenance mismatch '+s)
    return result

def measure(sid,folder,decision_path,snapshot_path,output):
    stage_result=stage_input(decision_path)
    staged=stage_result['decision']['adopt']
    reference=stage_result['formats'][sid]
    snap=read_json(snapshot_path)
    if snap.get('protocol')!=SNAPSHOT_PROTOCOL or set(snap.get('sets',{}))!=set(exp.SETS):
        raise ValueError('invalid production rarity snapshot')
    prior=reviewed.frozen_prior(folder,sid)
    e,o,metadata,_,prov,_,_,_=refit.prepare(sid,exp.directory(sid)/'manifest.json',prior,'residual')
    if prov['phase']!='residual' or any(len(rs)!=prior['fit'][c]['decisions'] for c,rs in zip(COHORTS,(e,o))):
        raise ValueError('residual cohort parity failure')
    train,test,split=stage.split(e,o)
    if split!=reference['split'] or prov!=reference['provenance']:
        raise ValueError('prompt 2 split/input parity failure')
    names={n for c in COHORTS for r,_,_ in train[c]+test[c] for n in r.candidates}
    pairs={n:group_for(sid,n,metadata,snap['sets'][sid]) for n in sorted(names)}
    groups={n:v[0] for n,v in pairs.items()}; sources={n:v[1] for n,v in pairs.items()}
    rules=mana.index(metadata)
    models,eligible,penalty=fit_models(train,rules,groups,staged,sid)
    if len(eligible)!=reference['eligible_cards'] or penalty!=reference['card_penalty']:
        raise ValueError('prompt 2 card eligibility/prior mismatch')
    baseline_arm='stage' if staged else 'single'
    for c in COHORTS:
        actual=np.asarray(models[c]['zero']['context'])
        expected=np.asarray(reference['coefficients'][c][baseline_arm]['context']).reshape(actual.shape)
        if not np.allclose(actual,expected,rtol=1e-9,atol=1e-9):
            raise ValueError('prompt 2 zero-shrinkage coefficient parity failure '+c)
    banks={}; score_bank=[]
    for c in COHORTS:
        banks[c],rows=measure_cohort(sid,c,test[c],rules,models)
        score_bank.extend(rows)
        old=reference['cohorts'][c]['summary'][baseline_arm+'_log_loss']
        new=banks[c]['summary']['raw_contrast_log_loss']['zero']
        if not math.isclose(old,new,rel_tol=1e-9,abs_tol=1e-9):
            raise ValueError('prompt 2 raw loss parity failure '+c)
    classification=reference['evidence_class']
    report={'protocol':PROTOCOL,'phase':'residual','set':sid,'release_allowed':False,
        'code_sha256':sha256(Path(__file__)),'stage_run':STAGE_RUN,'stage_decision_sha256':sha256(decision_path),
        'context_structure':'stage' if staged else 'single','split':split,'evidence_class':classification,
        'card_penalty':penalty,'eligible_cards':len(eligible),'draws':DRAWS,
        'rarity_snapshot_sha256':sha256(snapshot_path),'rarity_snapshot_revision':snap['revision'],
        'metadata_sha256':prov['sources']['metadata'],'rarity_provenance':dict(Counter(sources.values())),
        'group_means':{c:models[c]['rarity']['means'] for c in COHORTS},
        'optimizers':{c:{a:models[c][a]['optimizer'] for a in ARMS} for c in COHORTS},
        'rarity_contrast':rarity_summary(groups,sources,eligible,models),
        'cohorts':banks,'profile_auc':profile_auc(sid,score_bank)}
    exp.write(output,report)
    print(json.dumps({'set':sid,'context':report['context_structure'],'split':split,
        'rarity_provenance':report['rarity_provenance'],'cohorts':{c:banks[c]['summary'] for c in COHORTS},
        'profile_status':report['profile_auc']['status']},allow_nan=False),flush=True)

def separation(reports):
    # Pooled strict result includes every strict non-Cube format, including
    # standalone formats. Use fixed decision-count weights to standardize
    # within-format AUCs, avoiding cross-format grade confounding. When any
    # format lacks eight-pick profile support, use pick AUC for the entire
    # scope rather than mix estimands. Also report per-format choice.
    w=np.array([sum(r['cohorts'][c]['summary']['decisions'] for c in COHORTS) for r in reports],dtype=float)
    w/=w.sum()
    use_profiles=all(r['profile_auc']['status']=='measured' for r in reports)
    if use_profiles:
        point=np.array([r['profile_auc']['point'] for r in reports])
        samples=[]
        for j in range(DRAWS):
            draw=[r['profile_auc']['bootstrap'][j] for r in reports]
            if all(x is not None for x in draw):
                samples.append(w@np.asarray(draw))
        if len(samples)<.9*DRAWS:
            use_profiles=False
    if not use_profiles:
        point=[]; by_format=[]
        for r in reports:
            e,o=[r['cohorts'][c] for c in COHORTS]
            point.append(pick_auc(np.array(e['total']),np.array(o['total'])))
            by_format.append([pick_auc(np.array(a),np.array(b)) for a,b in zip(e['bootstrap'],o['bootstrap'])])
        point=np.array(point)
        samples=np.einsum('f,fda->da',w,np.array(by_format))
    p=w@point; draws=np.asarray(samples)
    return {'method':'eight-pick profile AUC' if use_profiles else 'pick-level AUC',
        'pooling':'holdout-decision-weighted mean of within-format AUCs',
        'fallback_reason':None if use_profiles else 'one or more formats lacks common profile coverage',
        'zero':float(p[0]),'rarity':float(p[1]),'delta':float(p[1]-p[0]),
        'ci95':interval(draws[:,1]-draws[:,0]),'valid_draws':len(draws)}

def pool(reports):
    out={}
    for c in COHORTS:
        b=[r['cohorts'][c] for r in reports]
        out[c]=loss_stats(np.sum([x['total'] for x in b],axis=0),np.sum([x['bootstrap'] for x in b],axis=0))
        out[c]['drafts']=sum(x['drafts'] for x in b)
    return {'cohorts':out,'separation':separation(reports)}

def decide(strict):
    # Primary loss is the raw applied contrast likelihood in each cohort,
    # consistent with prompt 2; unscaled separate cohort losses are diagnostic.
    e=strict['cohorts']['elite']['raw_contrast_log_loss']['ci95'][1]
    o=strict['cohorts']['control']['raw_contrast_log_loss']['ci95'][1]
    a=strict['separation']['ci95'][0]
    criteria={'strong_upper_le_0.001':{'value':e,'pass':e<=.001},
        'ordinary_upper_le_0.001':{'value':o,'pass':o<=.001},
        'separation_lower_ge_minus_0.002':{'value':a,'pass':a>=-.002}}
    return {'adopt':all(x['pass'] for x in criteria.values()),'criteria':criteria,
        'conditional_on':'contrast card term retained after prompt 1'}

def aggregate(folder,output,summary):
    reports={}
    for path in sorted(folder.rglob('rarity-report.json')):
        r=read_json(path);sid=r['set']
        if (sid in reports or sid not in exp.SETS or r['protocol']!=PROTOCOL or
            r['phase']!='residual' or r['release_allowed'] or r['code_sha256']!=sha256(Path(__file__)) or r['stage_run']!=STAGE_RUN):
            raise ValueError('incompatible report '+sid)
        reports[sid]=r
    if set(reports)!=set(exp.SETS):
        raise ValueError('missing formats '+str(sorted(set(exp.SETS)-set(reports))))
    for k in ('stage_decision_sha256','context_structure','rarity_snapshot_sha256'):
        if len({r[k] for r in reports.values()})!=1:
            raise ValueError('cross-format identity mismatch '+k)
    groups={'Strict':[r for s,r in reports.items() if s!='powered-cube' and r['evidence_class']=='strict_game_time'],
            'Legacy':[r for s,r in reports.items() if s!='powered-cube' and r['evidence_class']=='source_draft_disjoint_only'],
            'Powered Cube':[reports['powered-cube']]}
    if sum(map(len,groups.values()))!=len(reports):
        raise ValueError('unclassified format')
    pooled={k:pool(v) for k,v in groups.items()}
    formats={k:pool([r]) for k,r in sorted(reports.items())}
    decision=decide(pooled['Strict'])
    exp.write(output,{'protocol':PROTOCOL,'phase':'residual','release_allowed':False,
        'groups':{k:[r['set'] for r in v] for k,v in groups.items()},'pooled':pooled,'formats':formats,
        'reports':reports,'decision':decision})
    lines=['# Rarity shrinkage — residual holdout','',
        'Conditional decision: '+('ADOPT rarity means' if decision['adopt'] else 'KEEP zero shrinkage')+' if the contrast term survives prompt 1.',
        'Only prompt 2 selected context structure; exact same residual split. Loss is raw contrast prediction; own unscaled fit likelihood also reported.',
        '95% paired whole-draft intervals; lower log loss and higher AUC are better. Pooled AUC is holdout-decision-weighted within format.','',
        '| Scope | Strong zero | Strong rarity | Strong delta [95% CI] | Ordinary zero | Ordinary rarity | Ordinary delta [95% CI] | AUC method | AUC zero | AUC rarity | AUC delta [95% CI] |',
        '|---|---:|---:|---|---:|---:|---|---|---:|---:|---|']
    def cell(x):
        return f"{x['zero']:.6f} | {x['rarity']:.6f} | {x['delta']:+.6f} [{x['ci95'][0]:+.6f}, {x['ci95'][1]:+.6f}]"
    for k,v in list(pooled.items())+list(formats.items()):
        e,o=[v['cohorts'][c]['raw_contrast_log_loss'] for c in COHORTS]
        a=v['separation']
        lines.append(f"| {k} | {cell(e)} | {cell(o)} | {a['method']} | {cell(a)} |")
    lines+=['','Criteria: '+json.dumps(decision),'','## Rarity group coverage and contrast']
    for sid,r in sorted(reports.items()):
        lines+=['','### '+sid,'Context: '+r['context_structure']+'; split: '+json.dumps(r['split']),
            'Rarity provenance: '+json.dumps(r['rarity_provenance']),
            'Cohort group means: '+json.dumps(r['group_means']),
            'Mean contrast, equal card weighting: '+json.dumps(r['rarity_contrast']),
            'Unscaled own-cohort log loss: '+json.dumps({c:r['cohorts'][c]['summary']['unscaled_own_cohort_log_loss'] for c in COHORTS}),
            'Profile availability: '+r['profile_auc']['status']]
    summary.parent.mkdir(parents=True,exist_ok=True)
    summary.write_text('\n'.join(lines)+'\n',encoding='utf8')
    print(json.dumps(decision,indent=2),flush=True)

def self_test():
    assert group_for('blb','a',{'a':{'rarity':'mythic'}},{'a':['rare']})==('mythic','pinned-metadata')
    assert group_for('blb','a',{}, {'a':['rare','uncommon']})==('unknown','production-conflict')
    assert group_for('blb','A',{}, {'a':['rare']})==('unknown','unrecorded')
    assert group_for('powered-cube','a',{'a':{'rarity':'mythic'}},{})==('cube','cube-single-group')
    records=[]
    for i in range(400):
        r=Choice(str(i),'2025-01-01T00:00:00Z',('a','b','c'),(1/3,)*3,((0.,)*8,)*3,0 if i<180 else 2 if i<360 else 1)
        records.append((r,2 if i%2 else 9))
    groups={'a':'rare','b':'common','c':'rare','d':'unknown'}
    for staged in (False,True):
        f=fit_rarity(records,('a','b'),.3,groups,staged)
        assert f['means']['rare']>0 and f['means']['common']==f['means']['unknown']==0
        assert f['effects']['c']==f['means']['rare'] and f['effects']['d']==0
        assert math.isclose(f['effects']['a'],f['means']['rare']+f['residuals']['a'])
    e=np.zeros(WIDTH);o=np.zeros(WIDTH);e[95]=o[95]=1
    assert auc_hist(e,o)==.5
    o[95]=0;o[0]=1
    assert auc_hist(e,o)==1.
    t=np.zeros(5+2*WIDTH);t[:5]=[10,5,5.01,6,6];t[5]=t[5+WIDTH]=10
    b=np.tile(t,(DRAWS,1))
    assert math.isclose(loss_stats(t,b)['raw_contrast_log_loss']['delta'],.001)
    rule={'cohorts':{c:{'raw_contrast_log_loss':{'ci95':[-.1,.001]}} for c in COHORTS},'separation':{'ci95':[-.002,.1]}}
    assert decide(rule)['adopt']
    rule['separation']['ci95'][0]=-.00201
    assert not decide(rule)['adopt']
    print('Rarity identification, sparse/unknown fallback, fixed penalties, AUC and immutable rule contracts passed.')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--snapshot',type=Path);p.add_argument('--connection-file',type=Path)
    p.add_argument('--set',choices=sorted(exp.SETS));p.add_argument('--prior',type=Path)
    p.add_argument('--stage-decision',type=Path);p.add_argument('--rarity-snapshot',type=Path)
    p.add_argument('--aggregate',type=Path);p.add_argument('--output',type=Path);p.add_argument('--summary',type=Path)
    a=p.parse_args()
    if a.self_test:self_test()
    elif a.snapshot:snapshot(a.connection_file,a.snapshot)
    elif a.aggregate:aggregate(a.aggregate,a.output,a.summary)
    elif a.set:measure(a.set,a.prior,a.stage_decision,a.rarity_snapshot,a.output)
    else:p.error('stage required')

if __name__=='__main__':
    main()
