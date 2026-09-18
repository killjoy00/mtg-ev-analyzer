#!/usr/bin/env python3
"""Offline, source-held-out Premier/Traditional experiment. Never writes production."""
import argparse
from collections import Counter, defaultdict
import csv
import gzip
import hashlib
import json
import math
from pathlib import Path
import random
import statistics

from build_replays import (CountStore, OutOfFoldModel, DraftSkill, MODEL_VERSION,
    candidate_columns, pool_columns, parse_example, parse_games_lower_bound,
    parse_rate_bucket, select_strong_drafts, stable_score)
from deck_fit import card_colours, observe_examples, estimate, commitment
from eval_model import draft_split, pick_metrics, Accumulator, Calibration, file_sha256
from format_residuals import metadata_for_set, residual_report
from import_all_trophies import archive, BASE, csv_bytes, rows, trajectory, atomic_json, request

EVENTS=('PremierDraft','TradDraft')
MODELS=('premier','traditional','combined','event_feature')
TEMPERATURES=(1,1.25,1.5,1.75,2,2.5)
EVENT_WEIGHTS=(0,.25,.5,.75,1)
SEED=20260918

def first_game_decks(path,wanted,event):
    # Traditional post-sideboard decks must not manufacture a format feature.
    # Restrict both formats to their observed first match/game, not the union of
    # cards played across the event. Missing first games do not invent a deck.
    played={};hits=defaultdict(Counter)
    for row in rows(path,wanted):
        if row.get('event_type')!=event:raise ValueError('Game archive event mismatch')
        if 'match_number' not in row or 'game_number' not in row:raise ValueError('First-game provenance unavailable')
        if float(row['match_number'] or -1)!=1 or float(row['game_number'] or -1)!=1:continue
        did=row['draft_id']
        cards={k[5:] for k,v in row.items() if k.startswith('deck_') and float(v or 0)>0}
        colors=''.join(c for c in row.get('main_colors','').upper() if c in 'WUBRG')
        if did in played:
            if played[did]!=cards:raise ValueError('Conflicting first-game deck')
            continue
        played[did]=cards
        for card in cards:hits[card][colors]+=1
    return played,hits

def cohort(path,event,include_sources=False):
    drafts={};conflicts=set()
    with csv_bytes(path) as f:
        header=next(csv.reader([f.readline().decode('utf-8-sig')]))
        required={'draft_id','event_type','event_match_wins','event_match_losses','pack_number','pick_number','pick','user_n_games_bucket','user_game_win_rate_bucket'}
        if not required.issubset(header): raise ValueError('Equivalent outcome/skill fields unavailable: '+','.join(sorted(required-set(header))))
        modern=header[:9]==['expansion','event_type','draft_id','draft_time','rank','event_match_wins','event_match_losses','pack_number','pick_number'] and header[-2:]==['user_n_games_bucket','user_game_win_rate_bucket']
        for line in f:
            if not line.strip(): continue
            if modern:
                row=dict(zip(header[:9],(v.decode().strip('"') for v in line.split(b',',9)[:9])))
                row.update(zip(header[-2:],(v.decode().strip().strip('"') for v in line.rsplit(b',',2)[-2:])))
            else:
                values=next(csv.reader([line.decode()]))
                if len(values)!=len(header): raise ValueError('Malformed archive row')
                row=dict(zip(header,values))
            if row['event_type']!=event: raise ValueError('Archive event identity mismatch')
            d=dict(wins=int(float(row['event_match_wins'] or -1)),losses=int(float(row['event_match_losses'])) if row['event_match_losses'] else None,games=parse_games_lower_bound(row['user_n_games_bucket']),rate=parse_rate_bucket(row['user_game_win_rate_bucket']))
            did=row['draft_id']
            if did in drafts and drafts[did]!=d: conflicts.add(did)
            else: drafts[did]=d
    skills={did:DraftSkill(d['rate'],d['games']) for did,d in drafts.items() if did not in conflicts and d['rate'] is not None and d['games'] is not None}
    _,cutoff,experienced=select_strong_drafts(skills,100,.15,None);cutoff=max(.6,cutoff)
    qualified={did for did,s in skills.items() if s.games_lower_bound>=100 and s.rate>=cutoff}
    def trophy(d): return d['wins']==(7 if event=='PremierDraft' else 3) and d['losses'] in ((0,1,2) if event=='PremierDraft' else (0,))
    wanted={did for did in qualified if trophy(drafts[did])}
    examples=defaultdict(list);pack=candidate_columns(header);pool=pool_columns(header)
    if not pack or not pool: raise ValueError('Missing candidate/pool columns')
    for row in rows(path,wanted):
        if int(float(row['pack_number']))!=0 or not 0<=int(float(row['pick_number']))<8: continue
        p=parse_example(row,pack,pool)
        if p: examples[p.draft_id].append(p)
    clean={};excluded=Counter();source_reasons={}
    for did in sorted(wanted):
        valid,prior,reason=trajectory(examples[did],8)
        if prior or len(valid)!=8 or valid[0].raw_pick_number!=0:
            excluded[reason or 'missing_complete_first_eight']+=1
            source_reasons[did]=reason or 'missing_complete_first_eight'
        else: clean[did]=valid
    report=dict(source_drafts=len(drafts),experienced=experienced,qualified_drafts=len(qualified),qualified_trophies=len(wanted),complete_trajectories=len(clean),excluded=dict(excluded),cutoff=cutoff,source_conflicts=len(conflicts),trophy_outcomes=dict(Counter(f"{d['wins']}-{d['losses']}" for d in drafts.values() if trophy(d))))
    if include_sources:
        report['sources']={did:{**d,'qualified':did in qualified,'complete':did in clean,
            'reason':'inconsistent_source_metadata' if did in conflicts else
            'experience_unverified_or_below_100' if (d['games'] or 0)<100 else
            'win_rate_unverified_or_below_cutoff' if d['rate'] is None or d['rate']<cutoff else source_reasons.get(did)}
            for did,d in drafts.items() if trophy(d)}
    return clean,report

def normalize(values,exponent=1):
    # Log-space normalization avoids underflow in the conditional interpolation.
    logs=[exponent*math.log(max(1e-12,v)) for v in values];peak=max(logs)
    weights=[math.exp(x-peak) for x in logs];total=sum(weights)
    return [x/total for x in weights]

def fit_model(pairs,played,hits):
    counts=CountStore.empty()
    for _,p in pairs: counts.observe(p)
    model=OutOfFoldModel(counts,CountStore.empty())
    for _,p in pairs: counts.observe_expected(p,model.base_tendency)
    colours=card_colours(hits)
    buckets,cards,stages=observe_examples(pairs,played,colours)
    if not cards: raise ValueError('Training drafts did not match the game archive')
    fit=estimate(buckets,cards,colours,stages)
    return OutOfFoldModel(counts,CountStore.empty(),fit),colours

def supports(model,p,cards): return [model.card_tendency(c,p.raw_pack_number,p.raw_pick_number,p.pool) for c in cards]

def event_support(combined,conditional,weight):
    return [math.exp((1-weight)*math.log(max(1e-12,a))+weight*math.log(max(1e-12,b))) for a,b in zip(combined,conditional)]

def mean_loss(records,model,temperature,weight=0):
    # Equal event weight prevents the larger Premier cohort choosing the feature.
    losses=defaultdict(list)
    for r in records:
        raw=r['raw'][model] if model!='event_feature' else event_support(r['raw']['combined'],r['raw']['premier' if r['event']==EVENTS[0] else 'traditional'],weight)
        ps=normalize(raw,temperature);losses[r['event']].append(-math.log(max(1e-12,ps[r['chosen']])))
    return statistics.fmean(statistics.fmean(v) for v in losses.values()) if losses else math.inf

def metric_report(records,key):
    acc=Accumulator();cal=Calibration()
    for r in records:
        ps=r[key];acc.add(*pick_metrics(ps,r['chosen']),len(ps));cal.add(ps,r['chosen'])
    return {'metrics':acc.summary(),'calibration':cal.summary()}

def paired_interval(records,left,right,metric=0,draws=500):
    by_draft=defaultdict(list)
    for r in records: by_draft[r['draft']].append(pick_metrics(r[left],r['chosen'])[metric]-pick_metrics(r[right],r['chosen'])[metric])
    means=[statistics.fmean(v) for v in by_draft.values()]
    if not means:return None
    randomizer=random.Random(SEED);samples=sorted(statistics.fmean(randomizer.choices(means,k=len(means))) for _ in range(draws))
    return {'delta':statistics.fmean(means),'low':samples[int(.025*draws)],'high':samples[min(draws-1,int(.975*draws))],'drafts':len(means)}

def run_set(sid,directory):
    directory.mkdir(parents=True,exist_ok=True)
    groups={};cohorts={};sources={};pairs={};decks={};colour_hits={}
    for event in EVENTS:
        draft=directory/f'{event}.draft.csv.gz';game=directory/f'{event}.game.csv.gz'
        sources[event]={'draft':archive(f'{BASE}/draft_data/draft_data_public.{sid.upper()}.{event}.csv.gz',draft)}
        groups[event],cohorts[event]=cohort(draft,event)
        split={name:sorted((did for did in groups[event] if draft_split(did)==name),key=lambda d:stable_score('format-training:'+d)) for name in ('train','validation','test')}
        split['train']=split['train'][:5000];cohorts[event]['splits']={k:len(v) for k,v in split.items()}
        cohorts[event]['sufficient_for_pooling']=len(split['train'])>=100 and len(split['validation'])>=20 and len(split['test'])>=50
        if len(split['train'])<100 or len(split['validation'])<20 or not split['test']: raise ValueError(f'{sid}/{event}: insufficient complete qualified trophy drafts: {cohorts[event]["splits"]}')
        cohorts[event]['training_ids_sha256']=hashlib.sha256('\n'.join(sorted(split['train'])).encode()).hexdigest()
        sources[event]['game']=archive(f'{BASE}/game_data/game_data_public.{sid.upper()}.{event}.csv.gz',game)
        played,hits=first_game_decks(game,set(split['train']),event)
        cohorts[event]['first_game_training_decks']=len(played)
        pairs[event]=[(event+'|'+did,p) for did in split['train'] for p in groups[event][did]]
        decks[event]={event+'|'+did:cards for did,cards in played.items()};colour_hits[event]=hits
        # Compact data and source hashes suffice for model fitting after this pass.
        draft.unlink();game.unlink()
        print(sid,event,cohorts[event]['splits'],flush=True)
    combined_hits=defaultdict(Counter)
    for hits in colour_hits.values():
        for card,values in hits.items(): combined_hits[card].update(values)
    models={}
    for name,event in zip(MODELS[:2],EVENTS): models[name],_=fit_model(pairs[event],decks[event],colour_hits[event])
    models['combined'],colours=fit_model(pairs[EVENTS[0]]+pairs[EVENTS[1]],{**decks[EVENTS[0]],**decks[EVENTS[1]]},combined_hits)
    validation=[];test=[]
    for event,drafts in groups.items():
        for did,examples in drafts.items():
            split=draft_split(did)
            if split=='train':continue
            for p in examples:
                cards=sorted(p.candidates)
                record={'set':sid,'event':event,'draft':sid+'|'+event+'|'+did,'pick':p.raw_pick_number+1,'cards':cards,'chosen':cards.index(p.historical_pick),'pool':p.pool,'raw':{name:supports(model,p,cards) for name,model in models.items()},'commitments':{c:commitment(p.pool,colours,c) for c in cards}}
                (validation if split=='validation' else test).append(record)
    calibration={}
    for name in MODELS:
        calibration_rows=[r for r in validation if name not in MODELS[:2] or r['event']==EVENTS[MODELS.index(name)]]
        _,temperature,weight=min((mean_loss(calibration_rows,name,t,w),t,w) for t in TEMPERATURES for w in (EVENT_WEIGHTS if name=='event_feature' else (0,)))
        calibration[name]={'temperature':temperature,'event_weight':weight}
        for r in test:
            raw=r['raw'][name] if name!='event_feature' else event_support(r['raw']['combined'],r['raw']['premier' if r['event']==EVENTS[0] else 'traditional'],weight)
            r[name]=normalize(raw,temperature);r[name+'_raw']=normalize(raw)
    for r in test: del r['raw']
    report={'card_tags':metadata_for_set(sid,models['combined']),'schema':1,'set':sid,'model_version':MODEL_VERSION,'source_hashes':sources,'cohorts':cohorts,'calibration':calibration,'implementation':{name:file_sha256(Path(__file__).parent/name) for name in ('format_research.py','build_replays.py','deck_fit.py','eval_model.py')},'tests':test}
    with gzip.open(directory/'measurements.json.gz','wt') as f: json.dump(report,f,separators=(',',':'))
    atomic_json(directory/'summary.json',{k:v for k,v in report.items() if k!='tests'})
    return report

def summarize(paths,out):
    reports=[];missing=[]
    for path in paths:
        if path.name=='error.json':missing.append(json.loads(path.read_text()));continue
        with gzip.open(path,'rt') as f: reports.append(json.load(f))
    eligible=[r for r in reports if all(r['cohorts'][e]['sufficient_for_pooling'] for e in EVENTS)]
    eligible_sets={r['set'] for r in eligible}
    groups={r['set']:r['tests'] for r in reports};groups['pooled']=[x for r in eligible for x in r['tests']]
    output={};passed=len(eligible)>=3
    for sid,records in groups.items():
        output[sid]={}
        for event in EVENTS:
            rows=[r for r in records if r['event']==event];same='premier' if event==EVENTS[0] else 'traditional';other='traditional' if same=='premier' else 'premier'
            metrics={m:metric_report(rows,m) for m in MODELS};raw={m:metric_report(rows,m+'_raw') for m in MODELS}
            comparisons={'combined_vs_same':paired_interval(rows,'combined',same),'cross_vs_same':paired_interval(rows,other,same),'event_gain':paired_interval(rows,'combined','event_feature'),'combined_top1':paired_interval(rows,'combined',same,2)}
            base=metrics[same]['metrics'].get('log_loss');combined=metrics['combined']['metrics'].get('log_loss')
            ok=bool(base and all(comparisons.values()) and comparisons['combined_vs_same']['high']<=.02*base and comparisons['cross_vs_same']['high']<=.05*base and comparisons['event_gain']['high']<.01*combined and comparisons['combined_top1']['low']>=-.01)
            if sid in eligible_sets or sid=='pooled':passed=passed and ok
            output[sid][event]={'calibrated':metrics,'raw':raw,'comparisons':comparisons,'prediction_criteria_pass':ok}
    result={'schema':1,'sets':[r['set'] for r in reports],'eligible_sets':sorted(eligible_sets),'missing':missing,'prediction_pooling_supported':passed,'prediction':output,'cohorts':{r['set']:r['cohorts'] for r in reports},'calibration':{r['set']:r['calibration'] for r in reports},'production_changed':False,'decision':'Pending residual analysis; no production pooling.'}
    result['residuals']=residual_report(eligible)
    supported=passed and result['residuals']['all_categories_have_three_sets'] and not result['residuals']['persistent_category_patterns']
    result['model_evidence_decision']='Pooling supported for a separately versioned validation rollout' if supported else 'Retain Premier-only evidence: pooling criteria not established'
    result['playable_puzzle_decision']='Remain Premier-only pending separate source/metadata/quality gates and an explicit publication decision'
    result['decision']='Analysis complete; no production data or model changed.'
    atomic_json(out,result);print(json.dumps({'sets':result['sets'],'prediction_pooling_supported':passed,'missing':missing}),flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--set');parser.add_argument('--directory',type=Path,default=Path('generated/format-research'));parser.add_argument('--summarize',nargs='*',type=Path);parser.add_argument('--out',type=Path,default=Path('generated/format-research/report.json'));args=parser.parse_args()
    if args.summarize is not None:return summarize(args.summarize,args.out)
    if args.set not in ('blb','dft','fin','hob'):parser.error('Use a predeclared set.')
    try:run_set(args.set,args.directory/args.set)
    except Exception as e:
        atomic_json(args.directory/args.set/'error.json',{'set':args.set,'error':f'{type(e).__name__}: {e}','production_changed':False});raise

if __name__=='__main__':main()
