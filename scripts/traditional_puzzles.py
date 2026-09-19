#!/usr/bin/env python3
"""Evaluate Traditional puzzle inventory with frozen, Premier-only v3 evidence.

No database writes or automatic publication. Reconstruct the existing importer
model from pinned archives and require parity with immutable v7 supplements.
"""
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import random
import statistics

from build_replays import (DraftSkill, MODEL_VERSION, OutOfFoldModel,
    build_colour_table, select_strong_drafts, stable_fold, slugify, render_replay)
from deck_fit import commitment
from eval_model import Accumulator, Calibration, pick_metrics
from format_research import cohort, normalize
from format_residuals import metadata_for_set, residual_report
from grading_curve import js_round
from import_all_trophies import (ROOT, BASE, archive, scan_metadata, eligible_trophies,
    collect_legacy_v3, trajectory, metadata, resolve_images, digest, encoded, atomic_json,
    write_gzip_jsonl)

SETS=('blb','dft','fin','hob')
EVENTS=('PremierDraft','TradDraft')
COMPONENT='traditional-premier-v3-v1'
THRESHOLDS={'minimum_trajectories_each':100,'minimum_sets':3,
    'absolute_ece_max':.15,'ece_increase_max':.04,
    'disagreement_increase_max':.10,'low_support_increase_max':.03,
    'mean_support_score_drop_max':8,'alternative_low_increase_max':.05,
    'alternative_95_shift_max':.05,'difficulty_total_variation_max':.15,
    'unusable_trajectory_fraction_max':.05}
METRICS=('disagreement','low_support','support_score','alternative_low','alternative_95')

def pinned_archive(source,path):
    actual=archive(source['url'],path)
    if any(actual.get(k)!=source.get(k) for k in ('sha256','compressed_bytes')):
        raise ValueError('Frozen Premier archive changed; do not substitute new evidence')
    return actual

def record(sid,event,did,p,model):
    cards=sorted(p.candidates)
    raw=normalize([model.card_tendency(c,p.raw_pack_number,p.raw_pick_number,p.pool) for c in cards])
    # Production persists six decimal places; use exactly that evidence here.
    raw=[round(v,6) for v in raw];chosen=cards.index(p.historical_pick)
    if any(not math.isfinite(v) or v<0 for v in raw) or max(raw)<=0:
        raise ValueError('Invalid model support')
    scores=[js_round(95*v/max(raw)) for v in raw]
    alternatives=[s for i,s in enumerate(scores) if i!=chosen]
    if not alternatives:raise ValueError('Missing alternatives')
    rating=js_round(100*sorted(raw,reverse=True)[1]/max(raw))
    return {'set':sid,'event':event,'draft':sid+'|'+event+'|'+did,
        'pick':p.raw_pick_number+1,'cards':cards,'chosen':chosen,'raw':raw,
        'combined':normalize(raw,1.75), # residual adapter: this is Premier v3, never combined training
        'commitments':{c:commitment(p.pool,model.fit_colours,c) for c in cards},
        'band':'easy' if rating<50 else 'medium' if rating<80 else 'hard',
        'disagreement':int(raw[chosen]<max(raw)),
        'low_support':int(scores[chosen]<25),'support_score':scores[chosen],
        'alternative_low':statistics.fmean(s<25 for s in alternatives),
        'alternative_95':statistics.fmean(s==95 for s in alternatives)}

def describe(records):
    acc=Accumulator();cal=Calibration()
    for r in records:
        ps=r['combined'];acc.add(*pick_metrics(ps,r['chosen']),len(ps));cal.add(ps,r['chosen'])
    return {'picks':len(records),'drafts':len({r['draft'] for r in records}),
        'prediction':acc.summary(),'calibration':cal.summary(),
        'scores':{k:statistics.fmean(r[k] for r in records) for k in METRICS} if records else {},
        'difficulty':dict(Counter(r['band'] for r in records))}

def difference(premier,traditional,key,draws=500):
    vectors=[]
    for rows in (premier,traditional):
        by_source=defaultdict(list)
        for r in rows:by_source[r['draft']].append(r[key])
        vectors.append([statistics.fmean(v) for _,v in sorted(by_source.items())])
    if not all(vectors):return None
    rng=random.Random(20260918);a,b=vectors
    samples=sorted(statistics.fmean(rng.choices(b,k=len(b)))-statistics.fmean(rng.choices(a,k=len(a))) for _ in range(draws))
    return {'delta':statistics.fmean(b)-statistics.fmean(a),
        'low':samples[int(.025*draws)],'high':samples[min(draws-1,int(.975*draws))]}

def compare(records):
    a=[r for r in records if r['event']==EVENTS[0]];b=[r for r in records if r['event']==EVENTS[1]]
    summaries={EVENTS[0]:describe(a),EVENTS[1]:describe(b)}
    intervals={k:difference(a,b,k) for k in METRICS}
    gates={}
    gates['sufficient_sources']=all(v['drafts']>=THRESHOLDS['minimum_trajectories_each'] for v in summaries.values())
    if not a or not b:return {'summaries':summaries,'gates':gates,'pass':False}
    ea=summaries[EVENTS[0]]['calibration']['confidence_ece'];eb=summaries[EVENTS[1]]['calibration']['confidence_ece']
    gates['calibration']=eb<=THRESHOLDS['absolute_ece_max'] and eb-ea<=THRESHOLDS['ece_increase_max']
    for key,limit in [('disagreement','disagreement_increase_max'),('low_support','low_support_increase_max'),('alternative_low','alternative_low_increase_max')]:
        gates[key]=intervals[key]['high']<=THRESHOLDS[limit]
    gates['support_score']=intervals['support_score']['low']>=-THRESHOLDS['mean_support_score_drop_max']
    ci=intervals['alternative_95'];gates['alternative_95']=max(abs(ci['low']),abs(ci['high']))<=THRESHOLDS['alternative_95_shift_max']
    tv=sum(abs(sum(r['band']==band for r in a)/len(a)-sum(r['band']==band for r in b)/len(b)) for band in ('easy','medium','hard'))/2
    gates['difficulty']=tv<=THRESHOLDS['difficulty_total_variation_max']
    return {'summaries':summaries,'intervals_traditional_minus_premier':intervals,'difficulty_total_variation':tv,'gates':gates,'pass':all(gates.values())}

def measure(sid,directory,frozen):
    directory.mkdir(parents=True,exist_ok=True)
    pin=json.loads((ROOT/'research/traditional-puzzle-v3-inputs.json').read_text())[sid]
    if MODEL_VERSION!=pin['model_version']:raise ValueError('Unexpected model implementation version')
    published=json.loads((frozen/sid/'manifest.json').read_text())
    if published['input_signature']!=pin['input_signature'] or digest(frozen/sid/'puzzles.jsonl.gz')!=pin['puzzle_file_sha256']:
        raise ValueError('Incorrect frozen v7 artifact')
    draft=directory/'premier.csv.gz';game=directory/'premier-game.csv.gz'
    sources={'PremierDraft':{'draft':pinned_archive(pin['source_archive'],draft),'game':pinned_archive(pin['skill_source'],game)}}
    # The frozen artifact predates loss-aware source identity. Reproduce its
    # exact statistics, then audit current eligibility separately. Never change
    # frozen scoring evidence to make a newer source-quality rule fit its label.
    drafts,header,_,conflicts=scan_metadata(draft,compare_losses=False)
    skills={did:DraftSkill(d['rate'],d['games']) for did,d in drafts.items() if d['rate'] is not None and d['games'] is not None and did not in conflicts}
    training,_,_=select_strong_drafts(skills,100,.15,pin['training_cap'])
    qualified,_=eligible_trophies({did:{**d,'losses':None} for did,d in drafts.items()},pin['win_rate_cutoff'],conflicts=conflicts)
    counts,folds,output,_,training_picks,colour_examples=collect_legacy_v3(draft,set(training),set(qualified),header)
    if len(training)!=pin['training_drafts'] or training_picks!=pin['training_picks'] or len(qualified)!=pin['qualified_trophies']:
        raise ValueError(f'Frozen training/cohort counts changed: actual={len(training),training_picks,len(qualified)}, expected={pin["training_drafts"],pin["training_picks"],pin["qualified_trophies"]}')
    fit=build_colour_table(game,colour_examples,{did for did,_ in colour_examples},sid)
    models=[OutOfFoldModel(counts,f,fit) for f in folds]
    # The original supplement is the actual serving evidence. Check every
    # available first-eight supplement decision, not merely a version label.
    by_hash={hashlib.sha256(f'{sid}|{did}'.encode()).hexdigest()[:32]:did for did in qualified}
    parity=0;known=metadata(ROOT)
    with gzip.open(frozen/sid/'puzzles.jsonl.gz','rt') as handle:
        for line in handle:
            old=json.loads(line)
            for c in old['candidates']+old['prior_picks']:
                known[c['name']]={k:v for k,v in c.items() if k in ('image_url','mana_cost','rarity','type_line')}
            if old['pick_number']>8:continue
            did=by_hash[old['source_draft_hash']]
            ps=[p for p in output[did] if p.raw_pick_number==old['pick_number']-1]
            if len(ps)!=1:raise ValueError('Frozen source decision missing')
            rebuilt=render_replay(did,ps,models[stable_fold(did,5)],1,1,{})['picks'][0]
            actual={c['name']:c['model_probability'] for c in rebuilt['candidates']}
            if actual!={c['name']:c['model_probability'] for c in old['candidates']}:
                raise ValueError('Reconstructed v3 evidence differs from immutable supplement')
            parity+=1
    if parity<200:raise ValueError('Insufficient frozen model parity coverage')
    strict_drafts,_,_,strict_conflicts=scan_metadata(draft)
    strict_qualified,strict_rejected=eligible_trophies(strict_drafts,pin['win_rate_cutoff'],conflicts=strict_conflicts)
    strict_qualified={did:d for did,d in strict_qualified.items() if d.get('losses') in (0,1,2)}
    audit=[{'source_draft_hash':hashlib.sha256(f'{sid}|{did}'.encode()).hexdigest()[:32],
        'reason':strict_rejected.get(did,'unverified_trophy_losses'),'wins':drafts[did]['wins'],
        'losses':strict_drafts[did].get('losses')} for did in sorted(set(qualified)-set(strict_qualified))]
    atomic_json(directory/'premier-source-audit.json',{'set':sid,'corpus_version':pin['corpus_version'],
        'source_archive':sources[EVENTS[0]]['draft'],'frozen_qualified':len(qualified),
        'currently_qualified':len(strict_qualified),'blocked_sources':audit,
        'outcomes':dict(Counter(f"7-{d.get('losses')}" for d in strict_drafts.values() if d['wins']==7))})
    groups={EVENTS[0]:{}}
    for did,examples in output.items():
        if did not in strict_qualified:continue
        valid,prior,why=trajectory(examples,8)
        if len(valid)==8 and not prior and not why:groups[EVENTS[0]][did]=valid
    trad=directory/'traditional.csv.gz'
    sources[EVENTS[1]]={'draft':archive(f'{BASE}/draft_data/draft_data_public.{sid.upper()}.TradDraft.csv.gz',trad)}
    groups[EVENTS[1]],trad_cohort=cohort(trad,EVENTS[1],include_sources=True)
    trad_sources=trad_cohort.pop('sources')
    names={c for group in groups.values() for examples in group.values() for p in examples for c in (*p.candidates,*p.pool)}
    known=resolve_images(names,known,directory/'images.json')
    records=[];puzzles=[];excluded=Counter();ledger=[]
    for did,d in sorted(trad_sources.items()):
        if not d['complete']:
            ledger.append({'source_draft_hash':hashlib.sha256(f'{sid}|TradDraft|{did}'.encode()).hexdigest()[:32],'status':'excluded','qualified':d['qualified'],'reason':d['reason'],'event_type':'TradDraft','wins':3,'losses':0})
    for event,group in groups.items():
        for did,examples in sorted(group.items()):
            reason=None
            if any(len(p.candidates)<4 for p in examples):reason='fewer_than_four_candidates'
            if any(not known.get(c,{}).get('image_url','').startswith('https://') for p in examples for c in (*p.candidates,*p.pool)):reason='metadata_or_image_missing'
            if any(len({slugify(c) for c in p.candidates})!=len(p.candidates) for p in examples):reason='card_identity_collision'
            if reason:
                excluded[event+':'+reason]+=1
                if event==EVENTS[1]:ledger.append({'source_draft_hash':hashlib.sha256(f'{sid}|{event}|{did}'.encode()).hexdigest()[:32],'status':'excluded','reason':reason,'event_type':event,'wins':3,'losses':0})
                continue
            model=models[stable_fold(did,5)]
            for p in examples:records.append(record(sid,event,did,p,model))
            if event!=EVENTS[1]:continue
            source=hashlib.sha256(f'{sid}|{event}|{did}'.encode()).hexdigest()[:32]
            fingerprint=hashlib.sha256(encoded([{'pick':p.raw_pick_number,'choice':p.historical_pick,'pack':p.candidates,'pool':p.pool} for p in examples])).hexdigest()
            rendered=render_replay(did,examples,model,1,1,known)['picks'];prior=[]
            for p in rendered:
                pid=hashlib.sha256(f'{COMPONENT}|{sid}|{event}|{did}|{p["pick_number"]}'.encode()).hexdigest()[:32]
                puzzles.append({'puzzle_id':pid,'set_id':sid,'source_draft_hash':source,'source_fingerprint':fingerprint,'corpus_version':COMPONENT,'model_version':MODEL_VERSION,'model_source_event':'PremierDraft','source_event_type':event,'source_evidence':'official_archive_trajectory','skill_evidence':'win_rate_bucket','event_match_wins':3,'event_match_losses':0,'player_games_lower_bound':trad_sources[did]['games'],'player_win_rate_bucket':trad_sources[did]['rate'],'pick_number':p['pick_number'],'historical_pick_id':p['historical_pick_id'],'candidates':p['candidates'],'prior_picks':list(prior)})
                card=next(c for c in p['candidates'] if c['id']==p['historical_pick_id']);prior.append({k:v for k,v in card.items() if k!='model_probability'})
            ledger.append({'source_draft_hash':source,'source_fingerprint':fingerprint,'status':'included','event_type':event,'wins':3,'losses':0,'puzzles':8})
    if len(ledger)!=len(trad_sources):raise ValueError('Traditional trophy accounting mismatch')
    report={'schema':1,'set':sid,'model_version':MODEL_VERSION,'model_source_event':'PremierDraft','model_training_changed':False,'source_hashes':sources,'frozen_input_signature':pin['input_signature'],'parity_picks':parity,'training_drafts':len(training),'training_picks':training_picks,'traditional_cohort':trad_cohort,'excluded':dict(excluded),'card_tags':metadata_for_set(sid,models[0]),'tests':records,'implementation':{name:digest(ROOT/'scripts'/name) for name in ('traditional_puzzles.py','build_replays.py','deck_fit.py','import_all_trophies.py')}}
    report['all_picks']=compare(records);report['late_picks']=compare([r for r in records if r['pick']>=7])
    serving=[r for r in records if max(r['raw'])<=.75 and sorted(r['raw'],reverse=True)[1]/max(r['raw'])>=.2]
    report['serving_picks']=compare(serving);report['serving_late_picks']=compare([r for r in serving if r['pick']>=7])
    report['premier_source_audit']={'blocked_sources':len(audit),'reasons':dict(Counter(r['reason'] for r in audit))}
    unusable=1-len(puzzles)/8/max(1,trad_cohort['complete_trajectories'])
    report['quality']={'usable_traditional_puzzles':len(puzzles),'unusable_fraction':unusable,'pass':unusable<=THRESHOLDS['unusable_trajectory_fraction_max']}
    write_gzip_jsonl(directory/'puzzles.jsonl.gz',puzzles);write_gzip_jsonl(directory/'trophies.jsonl.gz',ledger)
    with gzip.open(directory/'measurements.json.gz','wt') as f:json.dump(report,f,separators=(',',':'))
    atomic_json(directory/'summary.json',{k:v for k,v in report.items() if k not in ('tests','card_tags')})
    atomic_json(directory/'manifest.json',{'id':sid,'component_version':COMPONENT,'model_version':MODEL_VERSION,'model_source_event':'PremierDraft','source_event_type':'TradDraft','serving_status':'candidate','publication_authorized':False,'source_archive':sources[EVENTS[1]]['draft'],'puzzle_file_sha256':digest(directory/'puzzles.jsonl.gz'),'ledger_file_sha256':digest(directory/'trophies.jsonl.gz'),'puzzles':len(puzzles),'frozen_input_signature':pin['input_signature']})
    for path in (draft,game,trad):path.unlink()
    print(json.dumps({'set':sid,'parity_picks':parity,'puzzles':len(puzzles),'all_pass':report['all_picks']['pass'],'late_pass':report['late_picks']['pass']}),flush=True)

def summarize(paths,out):
    reports=[]
    for path in paths:
        with gzip.open(path,'rt') as f:reports.append(json.load(f))
    if sorted(r['set'] for r in reports)!=sorted(SETS):raise ValueError('All predeclared set results are required')
    residuals=residual_report(reports)
    residuals['definition']=residuals['definition'].replace('calibrated combined-model','frozen Premier-only v3 model')
    by_set={r['set']:{k:r[k] for k in ('all_picks','late_picks','serving_picks','serving_late_picks','quality','traditional_cohort','premier_source_audit','parity_picks','training_drafts','frozen_input_signature')} for r in reports}
    passing=[sid for sid,r in by_set.items() if all(r[k]['pass'] for k in ('all_picks','late_picks','serving_picks','serving_late_picks','quality'))]
    result={'schema':1,'thresholds':THRESHOLDS,'sets':by_set,'residuals':residuals,'passing_sets':passing,'expansion_supported':len(passing)>=THRESHOLDS['minimum_sets'] and not residuals['persistent_category_patterns'],'production_changed':False,'model_training_changed':False,'decision':'Candidate inventory only; require reviewed operational publication.'}
    atomic_json(out,result);print(json.dumps({k:v for k,v in result.items() if k not in ('sets','residuals')}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--set',choices=SETS);parser.add_argument('--directory',type=Path,default=ROOT/'generated/traditional-puzzles');parser.add_argument('--frozen',type=Path,default=ROOT/'generated/frozen-v7');parser.add_argument('--summarize',type=Path,nargs='+');args=parser.parse_args()
    if args.summarize:summarize(args.summarize,args.directory/'report.json')
    elif args.set:measure(args.set,args.directory/args.set,args.frozen)
    else:parser.error('Choose --set or --summarize')
