#!/usr/bin/env python3
"""Frozen five-candidate, source-separated strength selector comparison."""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import sparse

import card_strength_benchmark as b
import puzzle_quality_experiment as experiment
import puzzle_quality_v2 as v2
import puzzle_quality_v3 as v3

ROOT = Path(__file__).resolve().parents[1]
PROTOCOL = ROOT / 'research/puzzle-quality-model-selection-v3.json'
OUT = ROOT / 'artifacts/puzzle-quality-v3'
INPUTS = ROOT / 'raw-data/puzzle-quality-v1'


def read(path):
    return json.loads(Path(path).read_text())


def protocol():
    p = read(PROTOCOL)
    frozen = read(OUT / 'protocol-freeze.json')
    if b.sha256(PROTOCOL) != frozen['protocol_sha256']:
        raise ValueError('Protocol changed after freeze')
    return p


def inputs(p):
    contexts, inventory, _ = experiment.read_inputs(INPUTS)
    new = read(ROOT / 'raw-data/puzzle-quality-v3/inventory-tmt.json')
    launch = read(ROOT / 'raw-data/launch-quality-audit/schedule.json')
    all_sets = p['development_sets'] + [p['confirmation_set']]
    sources = {s: sorted({x['source_draft_hash'] for x in contexts + inventory + new + launch if x['set_id'] == s}) for s in all_sets}
    return inventory + new, sources


def paths(sid):
    if sid == 'tmt':
        return ROOT / 'raw-data/puzzle-quality-v3', OUT / 'cache'
    return ROOT / 'raw-data/card-strength-v1', ROOT / 'artifacts/card-strength-v1/cache'


def completed_ids(allowed, draft, times, budget):
    last = np.zeros(int(draft.max()) + 1, dtype=np.int64)
    np.maximum.at(last, draft, times)
    ordered = allowed[np.lexsort((allowed, last[allowed]))]
    n = len(ordered) if budget == 'all' else int(budget)
    if len(ordered) < n:
        raise ValueError('Insufficient completed drafts')
    selected = ordered[:n]
    return selected, int(last[selected].max())


def verified_valid_ids(path, cached_rows):
    """Reconstruct identity after invalid rows remove an entire source draft.

    Mirror the frozen benchmark's row validation; prove encoded identities,
    timestamps and outcomes agree with its cache, rather than shift indices.
    """
    header=pd.read_csv(path,nrows=0).columns.tolist()
    names=[c[5:] for c in header if c.startswith('deck_')]
    groups=('deck_','opening_hand_','drawn_','tutored_')
    cols=[g+n for g in groups for n in names if g+n in header]
    all_ids=[];all_times=[];all_y=[]
    for frame in pd.read_csv(path,usecols=['draft_id','game_time','won']+cols,
                             dtype={c:'float32' if c in cols else str for c in ['draft_id','game_time','won']+cols},chunksize=12000):
        invalid=np.zeros(len(frame),dtype=bool);matrices=[]
        for g in groups:
            m=frame.reindex(columns=[g+n for n in names],fill_value=0).fillna(0).to_numpy(float)
            invalid|=(~np.isfinite(m)|(m<0)|(m!=np.floor(m))|(m>255)).any(axis=1)
            matrices.append(np.nan_to_num(m).clip(0,255).astype(np.uint8))
        deck,opening,drawn,tutored=matrices
        seen=(opening.astype(int)+drawn.astype(int)+tutored.astype(int))>0
        invalid|=((seen&(deck==0)).any(axis=1)|(opening>deck).any(axis=1))
        size=deck.sum(axis=1);invalid|=(size<40)|(size>100)|(opening.sum(axis=1)>7)
        y,valid_y=b.parse_bool(frame['won']);time=pd.to_datetime(frame['game_time'],errors='coerce',utc=True)
        valid=~invalid&valid_y&time.notna().to_numpy()&frame['draft_id'].notna().to_numpy()
        valid&=frame['draft_id'].fillna('').str.len().to_numpy()>0
        all_ids.extend(frame.loc[valid,'draft_id'].astype(str))
        all_times.append(time.astype('int64').to_numpy()[valid]);all_y.append(y[valid].astype(float))
    ids,inverse=np.unique(all_ids,return_inverse=True)
    if not (np.array_equal(inverse,cached_rows['draft']) and np.array_equal(np.concatenate(all_times),cached_rows['time']) and np.array_equal(np.concatenate(all_y),cached_rows['y'])):
        raise ValueError('Reconstructed valid identities do not exactly match cache')
    return ids


def standardize(values, known):
    sd = float(values[known].std())
    if sd <= 0:
        raise ValueError('No outcome variation')
    return (values - float(values[known].mean())) / sd


def outcome_table(info, rows, draft_ids, cache, sid, prior):
    mask = np.isin(rows['draft'], draft_ids)
    y = rows['y'][mask]
    _, codes = np.unique(rows['draft'][mask], return_inverse=True)
    grouping = sparse.csr_matrix((np.ones(len(y)), (codes, np.arange(len(y)))), shape=(len(draft_ids), len(y)))
    result = {name:{} for name in info['cards']}
    for kind, metric in [('hand','gih'), ('deck','deck'), ('opening','opening')]:
        m = sparse.load_npz(cache / f'{sid.upper()}-{kind}.npz')[mask]
        m.data[:] = 1
        counts = np.asarray(m.sum(axis=0)).ravel()
        wins = np.asarray(m.T @ y).ravel()
        draft_counts = np.asarray((grouping @ m).getnnz(axis=0)).ravel()
        means = (wins + prior * y.mean()) / (counts + prior)
        z = standardize(means, counts > 0)
        for i,name in enumerate(info['cards']):
            result[name].update({metric+'_z':float(z[i]) if counts[i] else None,
                                metric+'_games':int(counts[i]), metric+'_drafts':int(draft_counts[i])})
    return result, {'games':len(y), 'drafts':len(draft_ids)}


def prepare(p):
    inventory,sources = inputs(p)
    old = read(ROOT / 'research/card-strength-v1.json')
    b.write_json(OUT / 'inventory.json', inventory)
    b.write_json(OUT / 'excluded-sources.json', sources)
    audit = {}
    for sid in p['development_sets'] + [p['confirmation_set']]:
        target=OUT/'sets'/sid
        if (target/'complete.json').exists():
            receipt=read(target/'complete.json')
            permitted_protocols={b.sha256(PROTOCOL)}
            history=OUT/'validation-rule-history/protocol-freeze.json'
            if history.exists():
                initial=read(history)
                old_recipe={k:v for k,v in initial['protocol'].items() if k not in ('winner_rule','selection_rule_revision')}
                new_recipe={k:v for k,v in p.items() if k not in ('winner_rule','selection_rule_revision')}
                if old_recipe==new_recipe:permitted_protocols.add(initial['protocol_sha256'])
            if receipt['protocol_sha256'] not in permitted_protocols or receipt['source_exclusion_sha256'] != hashlib.sha256('\n'.join(sources[sid]).encode()).hexdigest():
                raise ValueError('Stale prepared set')
            if any(b.sha256(target/name)!=value for name,value in receipt['outputs'].items()):
                raise ValueError('Prepared output changed')
            audit[sid]=read(target/'audit.json');continue
        raw,cache=paths(sid);upper=sid.upper();manifest=read(raw/'sources.json')
        info=b.prepare_one(upper,raw/f'{upper}.csv.gz',cache,manifest[upper])
        rows=dict(np.load(cache/f'{upper}-rows.npz'))
        ids=np.sort(pd.read_csv(raw/f'{upper}.csv.gz',usecols=['draft_id'],dtype=str)['draft_id'].dropna().unique())
        if info['duplicate_games_excluded']:
            raise ValueError('Cannot verify source identities')
        if len(ids)!=info['drafts']:
            ids=verified_valid_ids(raw/f'{upper}.csv.gz',rows)
        if len(ids)!=info['drafts']:raise ValueError('Source identity count mismatch')
        hashes=np.array([experiment.source_hash(sid,x) for x in ids])
        split=b.partitions(rows['draft'],rows['time'],old)
        train,val,test=[experiment.independent_training_ids(x,hashes,set(sources[sid])) for x in split]
        if any(set(x)&set(y) for x,y in [(train,val),(train,test),(val,test)]):raise AssertionError('Split overlap')
        target.mkdir(parents=True,exist_ok=True)
        b.write_npz(target/'split-ids.npz',lambda buf:np.savez_compressed(buf,train=train,validation=val,test=test))
        deck=sparse.load_npz(cache/f'{upper}-deck.npz');hand=sparse.load_npz(cache/f'{upper}-hand.npz')
        a={'source_sha256':manifest[upper]['sha256'],'source_overlap':0,'source_exclusion_count':len(sources[sid]),'budgets':{},'outcomes':{},
           'cache_array_sha256':{kind:b.sha256(cache/f'{upper}-{kind}.npz') for kind in ('rows','deck','hand','opening')}}
        for budget in p['budgets']:
            fit,cutoff=completed_ids(train,rows['draft'],rows['time'],budget)
            mask=np.isin(rows['draft'],fit)
            assert rows['time'][mask].max()<=cutoff
            norm,raw_values,nd,nh,baseline=b.estimate_strengths(deck[mask],hand[mask],rows['x'][mask],rows['y'][mask],old['prior_games'],old['adjusted_model_C'])
            table={'set':sid,'event_type':'PremierDraft','training_drafts':len(fit),'baseline':baseline,'cutoff_ns':cutoff,'cards':{}}
            for i,name in enumerate(info['cards']):
                table['cards'][name]={'deck_games':int(nd[i]),'in_hand_games':int(nh[i]),**{m+'_z':float(norm[m][i]) for m in b.MODELS}}
            b.write_json(target/f'strength-{budget}.json',table)
            a['budgets'][budget]={'drafts':len(fit),'games':int(mask.sum()),'cutoff':str(np.datetime64(cutoff,'ns')),'fitting_source_sha256':hashlib.sha256('\n'.join(sorted(hashes[fit])).encode()).hexdigest()}
        for label,selected in [('validation',val),('test',test)]:
            evidence,counts=outcome_table(info,rows,selected,cache,sid,old['prior_games'])
            b.write_json(target/f'evidence-{label}.json',evidence)
            a['outcomes'][label]={**counts,'sources_sha256':hashlib.sha256('\n'.join(sorted(hashes[selected])).encode()).hexdigest()}
        b.write_json(target/'audit.json',a)
        names=['audit.json','split-ids.npz','evidence-validation.json','evidence-test.json']+[f'strength-{x}.json' for x in p['budgets']]
        b.write_json(target/'complete.json',{'protocol_sha256':b.sha256(PROTOCOL),'source_exclusion_sha256':hashlib.sha256('\n'.join(sources[sid]).encode()).hexdigest(),'outputs':{n:b.sha256(target/n) for n in names}})
        audit[sid]=a
        print(f'{sid}: independent strengths and outcome partitions prepared; candidate assessment unopened',flush=True)
    b.write_json(OUT/'data-audit.json',audit)


def compact(row):
    keys=('puzzle_id','source_draft_hash','set_id','pick_number','eligible','reasons','warnings','credible_choices','quality_score','pair')
    return {**{k:row[k] for k in keys},'cards':[{'id':c['id'],'name':c['name']} for c in row['cards']]}


def pair_value(row,evidence,p,metric='gih'):
    pair=row.get('pair')
    if not pair:return None
    cards={c['id']:c['name'] for c in row['cards']}
    values=[evidence.get(cards[pair[k]],{}) for k in ('target_id','alternative_id')]
    if any(v.get(metric+'_z') is None or v.get(metric+'_games',0)<p['minimum_assessment_hand_games'] or v.get(metric+'_drafts',0)<p['minimum_assessment_hand_drafts'] for v in values):return None
    return min(v[metric+'_z'] for v in values)


def summarize(rows,portfolio,evidence,p):
    chosen=set(portfolio['selected_puzzle_ids']);chosen=[r for r in rows if r['puzzle_id'] in chosen]
    planned=sum(r['quota'] for r in portfolio['strata'])
    values=[pair_value(r,evidence,p) for r in chosen]
    good=sum(v is not None and v>=0 for v in values)
    bad=sum(v is not None and v<0 for v in values);unknown=sum(v is None for v in values)
    denominator=max(planned,1)
    result={'planned':planned,'selected':len(chosen),'strong':good,'weak':bad,'unknown':unknown,
            'eligible':sum(r['eligible'] for r in rows),'utility':(good-bad-unknown)/denominator,
            'yield':good/denominator,'coverage':len(chosen)/denominator,
            'verified_strong_fraction':good/len(chosen) if chosen else None,
            'later_weaker_gih_mean':float(np.mean([v for v in values if v is not None])) if any(v is not None for v in values) else None,
            'penalty_sensitivity':{str(cost):(good-cost*(bad+unknown))/denominator for cost in p['penalty_sensitivity']}}
    for metric in ['deck','opening']:
        v=[pair_value(r,evidence,p,metric) for r in chosen]
        result[metric]={'known':sum(x is not None for x in v),'both_above_average':sum(x is not None and x>=0 for x in v),'weaker_mean':float(np.mean([x for x in v if x is not None])) if any(x is not None for x in v) else None}
    result['by_pick']={str(k):{'selected':sum(r['pick_number']==k for r in chosen),'eligible':sum(r['pick_number']==k and r['eligible'] for r in rows)} for k in sorted({r['pick_number'] for r in rows})}
    return result


def choose_weight(validation,sets,budget,weights):
    if not sets:raise ValueError('No non-target calibration sets')
    means={str(w):float(np.mean([validation[s][budget]['blend:'+str(w)]['utility'] for s in sets])) for w in weights}
    # Prefer pure GIH, then pure adjusted, then fewer blended parts on exact ties.
    order=[0.,1.,.5,.25,.75]
    best=min(weights,key=lambda w:(-means[str(w)],order.index(w)))
    return best,means


def recommend(set_scores,candidates,complexity):
    matrix=np.array([[set_scores[s][name] for name in candidates] for s in sorted(set_scores)])
    means=matrix.mean(axis=0);leader=int(np.argmax(means));ties=[];se={}
    for i,name in enumerate(candidates):
        delta=matrix[:,leader]-matrix[:,i]
        stderr=float(delta.std(ddof=1)/np.sqrt(len(delta))) if len(delta)>1 else 0.
        se[name]=stderr
        if means[leader]-means[i]<=stderr+1e-12:ties.append(name)
    # Candidate-specific SE is diagnostic only: otherwise a worse, noisier
    # method can displace the empirical leader while a better simple one cannot.
    exact_ties=[name for i,name in enumerate(candidates) if abs(means[leader]-means[i])<=1e-12]
    recommended=next(n for n in complexity if n in exact_ties)
    return {'empirical_leader':candidates[leader],'recommended':recommended,'means':dict(zip(candidates,means.tolist())),'within_one_se':ties,'paired_set_standard_errors':se}


def elect(p):
    inventory=read(OUT/'inventory.json');base=read(ROOT/'research/puzzle-quality-v2.json')
    sets=p['development_sets']+[p['confirmation_set']]
    frozen={};validation={};all_rows={}
    for sid in sets:
        puzzles=[x for x in inventory if x['set_id']==sid]
        frozen[sid]={};all_rows[sid]={}
        if sid in p['development_sets']:validation[sid]={}
        for budget in p['budgets']:
            table=read(OUT/'sets'/sid/f'strength-{budget}.json')
            frozen[sid][budget]={};all_rows[sid][budget]={}
            if sid in p['development_sets']:validation[sid][budget]={}
            specs=[('gih','gih',None),('iwd','iwd',None),('adjusted','adjusted',None),('equal_blend','equal_blend',None)]+[(f'blend:{w}','adaptive_blend',w) for w in p['blend_weights']]
            for name,est,w in specs:
                rows=[compact(v3.assess(x,table,base,est,w)) for x in puzzles]
                port=v2.select_portfolio(rows,p['selection_fraction'])
                frozen[sid][budget][name]=port;all_rows[sid][budget][name]=rows
                if sid in p['development_sets']:
                    validation[sid][budget][name]=summarize(rows,port,read(OUT/'sets'/sid/'evidence-validation.json'),p)
    weights={}
    for sid in sets:
        others=[s for s in p['development_sets'] if s!=sid]
        weights[sid]={}
        for budget in p['budgets']:
            w,means=choose_weight(validation,others,budget,p['blend_weights'])
            weights[sid][budget]={'adjusted_weight':w,'training_sets':others,'training_utilities':means}
            key='blend:'+str(w)
            frozen[sid][budget]['adaptive_blend']=frozen[sid][budget][key]
            all_rows[sid][budget]['adaptive_blend']=all_rows[sid][budget][key]
            if sid in p['development_sets']:validation[sid][budget]['adaptive_blend']=validation[sid][budget][key]
    scores={sid:{name:float(np.mean([validation[sid][x][name]['utility'] for x in p['primary_budgets']])) for name in p['candidates']} for sid in p['development_sets']}
    decision=recommend(scores,p['candidates'],p['complexity_order'])
    decision.update(selection_phase='development-validation-only',primary_budgets=p['primary_budgets'],set_scores=scores,final_adaptive_weights=weights[p['confirmation_set']])
    b.write_json(OUT/'frozen-rows.json',all_rows);b.write_json(OUT/'frozen-portfolios.json',frozen)
    b.write_json(OUT/'validation-metrics.json',validation);b.write_json(OUT/'adaptive-weights.json',weights)
    b.write_json(OUT/'decision-before-test.json',decision)
    names=['inventory.json','excluded-sources.json','data-audit.json','frozen-rows.json','frozen-portfolios.json','validation-metrics.json','adaptive-weights.json','decision-before-test.json']
    b.write_json(OUT/'freeze.json',{'protocol_sha256':b.sha256(PROTOCOL),'code_sha256':{x:b.sha256(ROOT/'scripts'/x) for x in ['puzzle_quality_model_selection.py','puzzle_quality_v3.py','puzzle_quality_v2.py','puzzle_quality.py','card_strength_benchmark.py']},'files':{n:b.sha256(OUT/n) for n in names},'set_receipts':{sid:b.sha256(OUT/'sets'/sid/'complete.json') for sid in sets}})
    print(json.dumps({'decision_frozen_before_test':decision},indent=2),flush=True)


def verify(p):
    f=read(OUT/'freeze.json')
    if f['protocol_sha256']!=b.sha256(PROTOCOL):raise ValueError('Protocol changed')
    for n,h in f['files'].items():
        if h!=b.sha256(OUT/n):raise ValueError('Frozen output changed: '+n)
    for n,h in f['code_sha256'].items():
        if h!=b.sha256(ROOT/'scripts'/n):raise ValueError('Code changed: '+n)
    for sid,h in f['set_receipts'].items():
        target=OUT/'sets'/sid
        if h!=b.sha256(target/'complete.json'):raise ValueError('Set receipt changed')
        for n,v in read(target/'complete.json')['outputs'].items():
            if b.sha256(target/n)!=v:raise ValueError('Set evidence changed')


def macro(metrics,sets,budgets,names):
    out={}
    for name in names:
        cells=[metrics[s][x][name] for s in sets for x in budgets]
        out[name]={k:float(np.mean([c[k] for c in cells])) for k in ['utility','yield','coverage']}
        out[name].update({k:sum(c[k] for c in cells) for k in ['planned','selected','strong','weak','unknown']})
        out[name]['precision']=out[name]['strong']/out[name]['selected'] if out[name]['selected'] else None
        out[name]['penalty_sensitivity']={str(cost):float(np.mean([c['penalty_sensitivity'][str(cost)] for c in cells])) for cost in protocol()['penalty_sensitivity']}
    return out


def bootstrap_game_evidence(p,rows,ports):
    """Paired draft bootstrap of later outcomes, preserving shared cards.

    Portfolios/strength estimates remain fixed. Sets are resampled afterwards.
    """
    rng=np.random.default_rng(p['seed']);out={};audit={}
    for sid in p['development_sets']+[p['confirmation_set']]:
        raw,cache=paths(sid);upper=sid.upper();info=read(cache/f'{upper}.json')
        data=dict(np.load(cache/f'{upper}-rows.npz'));test=np.load(OUT/'sets'/sid/'split-ids.npz')['test']
        mask=np.isin(data['draft'],test);y=data['y'][mask];_,codes=np.unique(data['draft'][mask],return_inverse=True)
        group=sparse.csr_matrix((np.ones(len(y)),(codes,np.arange(len(y)))),shape=(len(test),len(y)))
        hand=sparse.load_npz(cache/f'{upper}-hand.npz')[mask]
        ng=(group@hand).tocsr();wg=(group@hand.multiply(y[:,None])).tocsr()
        game_n=np.bincount(codes);game_w=np.bincount(codes,weights=y);total=np.asarray(ng.sum(axis=0)).ravel();known=total>0
        lookup={name:i for i,name in enumerate(info['cards'])};specs={}
        evidence=read(OUT/'sets'/sid/'evidence-test.json')
        for budget in p['budgets']:
            for name in p['candidates']:
                chosen=set(ports[sid][budget][name]['selected_puzzle_ids']);pairs=[];unknown=0
                for r in rows[sid][budget][name]:
                    if r['puzzle_id'] not in chosen:continue
                    if pair_value(r,evidence,p) is None:unknown+=1;continue
                    names={c['id']:c['name'] for c in r['cards']}
                    pairs.append([lookup[names[r['pair'][k]]] for k in ('target_id','alternative_id')])
                specs[budget,name]=(np.array(pairs,dtype=int).reshape(-1,2),unknown,sum(x['quota'] for x in ports[sid][budget][name]['strata']))
        draws=np.zeros((p['bootstrap_draws'],len(p['budgets']),len(p['candidates'])))
        for start in range(0,p['bootstrap_draws'],40):
            n=min(40,p['bootstrap_draws']-start)
            multiplicity=rng.multinomial(len(test),np.full(len(test),1/len(test)),size=n).astype(float)
            nh=np.asarray(ng.T@multiplicity.T).T;wh=np.asarray(wg.T@multiplicity.T).T
            baseline=(multiplicity@game_w)/(multiplicity@game_n)
            gih=(wh+400*baseline[:,None])/(nh+400)
            center=gih[:,known].mean(axis=1)
            above=gih>=center[:,None]
            for (budget,name),(pairs,unknown,planned) in specs.items():
                good=above[:,pairs].all(axis=2).sum(axis=1)
                utility=(2*good-len(pairs)-unknown)/max(planned,1)
                draws[start:start+n,p['budgets'].index(budget),p['candidates'].index(name)]=utility
        out[sid]=draws;audit[sid]={'assessment_drafts':len(test),'fixed_portfolios':True,'strength_refit':False}
        print(f'{sid}: shared-card-aware assessment bootstrap complete',flush=True)
    chosen=read(OUT/'decision-before-test.json')['recommended'];leader_i=p['candidates'].index(chosen)
    early=[p['budgets'].index(x) for x in p['primary_budgets']]
    dev=np.stack([out[s][:,early,:].mean(axis=1) for s in p['development_sets']],axis=1)
    selected=rng.integers(len(p['development_sets']),size=(p['bootstrap_draws'],len(p['development_sets'])))
    boot=dev[np.arange(p['bootstrap_draws'])[:,None],selected].mean(axis=1)
    conf=out[p['confirmation_set']][:,early,:].mean(axis=1)
    result={'recommended':chosen,'conditional_on_fixed_fits_and_portfolios':True,'shared_card_uncertainty_included':True,'repeated_player_clustering':False,'by_set':audit}
    for label,x in [('development_test',boot),('confirmation',conf)]:
        result[label]={}
        for i,name in enumerate(p['candidates']):
            delta=x[:,leader_i]-x[:,i]
            result[label][name]={'utility_ci95':np.quantile(x[:,i],[.025,.975]).tolist(),'recommended_minus_candidate_ci95':np.quantile(delta,[.025,.975]).tolist(),'recommended_minus_candidate_familywise_ci':np.quantile(delta,[.05/(2*(len(p['candidates'])-1)),1-.05/(2*(len(p['candidates'])-1))]).tolist()}
    b.write_npz(OUT/'bootstrap-draws.npz',lambda buf:np.savez_compressed(buf,**out))
    return result


def assess(p):
    verify(p);rows=read(OUT/'frozen-rows.json');ports=read(OUT/'frozen-portfolios.json');decision=read(OUT/'decision-before-test.json')
    metrics={}
    for sid in p['development_sets']+[p['confirmation_set']]:
        evidence=read(OUT/'sets'/sid/'evidence-test.json');metrics[sid]={}
        for budget in p['budgets']:
            metrics[sid][budget]={n:summarize(rows[sid][budget][n],ports[sid][budget][n],evidence,p) for n in p['candidates']}
    report={'decision_before_test':decision,'test':metrics,
            'development_early':macro(metrics,p['development_sets'],p['primary_budgets'],p['candidates']),
            'development_full':macro(metrics,p['development_sets'],['all'],p['candidates']),
            'confirmation_early':macro(metrics,[p['confirmation_set']],p['primary_budgets'],p['candidates']),
            'confirmation_full':macro(metrics,[p['confirmation_set']],['all'],p['candidates'])}
    winner=decision['recommended'];matched={}
    for sid in metrics:
        matched[sid]={}
        for budget in p['budgets']:
            evidence=read(OUT/'sets'/sid/'evidence-test.json');matched[sid][budget]={}
            for other in [n for n in p['candidates'] if n!=winner]:
                selected=v2.matched_portfolios(rows[sid][budget][winner],rows[sid][budget][other],p['selection_fraction'])
                matched[sid][budget][other]={n:summarize(rows[sid][budget][n],port,evidence,p) for n,port in zip([winner,other],selected)}
    report['matched_volume']=matched
    b.write_json(OUT/'report.json',report)
    print(json.dumps({k:report[k] for k in ['development_early','confirmation_early','development_full','confirmation_full']},indent=2),flush=True)
    b.write_json(OUT/'uncertainty.json',bootstrap_game_evidence(p,rows,ports))
    sources=read(OUT/'excluded-sources.json');base=read(ROOT/'research/puzzle-quality-v2.json')
    for budget in p['budgets']:
        tables={sid:read(OUT/'sets'/sid/f'strength-{budget}.json') for sid in metrics}
        path=OUT/f'strength-{budget}.json';b.write_json(path,tables)
        artifact={'version':'puzzle-quality-v3','use':'offline-research-only','strength_estimator':winner,
                  'adjusted_weight':decision['final_adaptive_weights'][budget]['adjusted_weight'] if winner=='adaptive_blend' else None,
                  'base_protocol':base,'excluded_sources':sources,'strength_sha256':b.sha256(path),'evidence_budget':budget,
                  'decision_sha256':b.sha256(OUT/'decision-before-test.json'),'protocol_sha256':b.sha256(PROTOCOL)}
        b.write_json(OUT/f'selector-{budget}.json',artifact)
    b.write_json(OUT/'assessment-receipt.json',{'freeze_sha256':b.sha256(OUT/'freeze.json'),'report_sha256':b.sha256(OUT/'report.json'),'uncertainty_sha256':b.sha256(OUT/'uncertainty.json')})


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('command',choices=['prepare','elect','assess'])
    args=parser.parse_args();p=protocol()
    {'prepare':prepare,'elect':elect,'assess':assess}[args.command](p)


if __name__=='__main__':main()
