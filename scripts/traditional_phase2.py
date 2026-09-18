#!/usr/bin/env python3
"""Phase 2: evaluate every Phase-1-testable Traditional inventory against its frozen Premier v3 grader.

Research-only. No database writes, publication, model changes, or historical rewrites.
"""
import argparse
from collections import Counter, defaultdict
import csv
import gzip
import hashlib
import json
from pathlib import Path
from email.utils import parsedate_to_datetime

from build_replays import (
    DraftSkill, MODEL_VERSION, OutOfFoldModel, build_colour_table,
    candidate_columns, pool_columns, parse_example, parse_games_lower_bound,
    parse_rate_bucket, select_strong_drafts, stable_fold, slugify, render_replay,
)
from format_research import cohort
from format_residuals import metadata_for_set, residual_report
from import_all_trophies import (
    ROOT, BASE, archive, scan_metadata, eligible_trophies, collect, trajectory,
    metadata, resolve_images, digest, encoded, atomic_json, write_gzip_jsonl,
    csv_bytes, rows,
)
from traditional_puzzles import THRESHOLDS, record, compare

EVENTS=('PremierDraft','TradDraft')
CUBE='powered-cube'
SETS=(
    'hob','msh','sos','eoe','fin','tdm','dft','fdn','dsk','blb','mh3','otj',
    'mkm','ktk','lci','woe','ltr','mom','one','bro','dmu','snc','neo',
    'hbg','sir','pio',CUBE,
)
COMPONENT='traditional-premier-v3-phase2-v1'
REGRESSION={'blb':True,'dft':True,'fin':True,'hob':False}

def expansion(sid):
    return 'Cube_-_Powered' if sid==CUBE else sid.upper()

def serving_window(sid):
    return (2,9) if sid==CUBE else (1,8)

def late_floor(sid):
    return 8 if sid==CUBE else 7

def pinned_archive(source,path):
    actual=archive(source['url'],path)
    if any(actual.get(k)!=source.get(k) for k in ('sha256','compressed_bytes')):
        raise ValueError('Frozen Premier archive changed; do not substitute new evidence')
    return actual

def frozen_manifest(frozen,sid):
    catalog=json.loads((frozen/'catalog.json').read_text())
    if not catalog.get('complete') or catalog.get('errors'):
        raise ValueError('Frozen v7 artifact is incomplete')
    listed=next((x for x in catalog.get('sets',[]) if x.get('id')==sid),None)
    if not listed: raise ValueError('Environment absent from frozen v7 artifact')
    manifest=json.loads((frozen/sid/'manifest.json').read_text())
    for key in ('input_signature','puzzle_file_sha256','model_version','source_archive','skill_source','training_cap','training_drafts','training_picks','win_rate_cutoff','corpus_version'):
        if manifest.get(key)!=listed.get(key):
            raise ValueError('Frozen catalog/manifest mismatch: '+key)
    if digest(frozen/sid/'puzzles.jsonl.gz')!=manifest['puzzle_file_sha256']:
        raise ValueError('Frozen puzzle checksum mismatch')
    return manifest

def complete_source(examples,sid):
    last=9 if sid==CUBE else 8
    valid,prior,why=trajectory(examples,last)
    if sid==CUBE:
        ok=len(valid)==8 and len(prior)==1 and valid[0].raw_pick_number==1
        return valid,prior,None if ok else (why or 'missing_complete_p1p2_p1p9')
    ok=len(valid)==8 and not prior and valid and valid[0].raw_pick_number==0
    return valid,prior,None if ok else (why or 'missing_complete_p1p1_p1p8')

def cube_traditional_cohort(path,include_sources=False):
    event='TradDraft'; drafts={}; conflicts=set()
    with csv_bytes(path) as f:
        header=next(csv.reader([f.readline().decode('utf-8-sig')]))
        required={'draft_id','event_type','event_match_wins','event_match_losses','pack_number','pick_number','pick','user_n_games_bucket','user_game_win_rate_bucket'}
        if not required.issubset(header):
            raise ValueError('Equivalent outcome/skill fields unavailable: '+','.join(sorted(required-set(header))))
        modern=header[:9]==['expansion','event_type','draft_id','draft_time','rank','event_match_wins','event_match_losses','pack_number','pick_number'] and header[-2:]==['user_n_games_bucket','user_game_win_rate_bucket']
        for line in f:
            if not line.strip(): continue
            if modern:
                row=dict(zip(header[:9],(v.decode().strip('"') for v in line.split(b',9)[:9])))
                row.update(zip(header[-2:],(v.decode().strip().strip('"') for v in line.rsplit(b',2)[-2:])))
            else:
                values=next(csv.reader([line.decode()]))
                if len(values)!=len(header): raise ValueError('Malformed archive row')
                row=dict(zip(header,values))
            if row['event_type']!=event: raise ValueError('Archive event identity mismatch')
            d={'wins':int(float(row['event_match_wins'] or -1)),
               'losses':int(float(row['event_match_losses'])) if row['event_match_losses'] else None,
               'games':parse_games_lower_bound(row['user_n_games_bucket']),
               'rate':parse_rate_bucket(row['user_game_win_rate_bucket'])}
            did=row['draft_id']
            if did in drafts and drafts[did]!=d: conflicts.add(did)
            else: drafts[did]=d
    skills={did:DraftSkill(d['rate'],d['games']) for did,d in drafts.items()
            if did not in conflicts and d['rate'] is not None and d['games'] is not None}
    _,cutoff,experienced=select_strong_drafts(skills,100,.15,None);cutoff=max(.6,cutoff)
    qualified={did for did,s in skills.items() if s.games_lower_bound>=100 and s.rate>=cutoff}
    def trophy(d): return d['wins']==3 and d['losses']==0
    wanted={did for did in qualified if trophy(drafts[did])}
    examples=defaultdict(list);pack=candidate_columns(header);pool=pool_columns(header)
    if not pack or not pool: raise ValueError('Missing candidate/pool columns')
    for row in rows(path,wanted):
        if int(float(row['pack_number']))!=0 or not 1<=int(float(row['pick_number']))<9: continue
        p=parse_example(row,pack,pool)
        if p: examples[p.draft_id].append(p)
    clean={};excluded=Counter();source_reasons={}
    for did in sorted(wanted):
        valid,prior,reason=complete_source(examples[did],CUBE)
        if reason:
            excluded[reason]+=1;source_reasons[did]=reason
        else: clean[did]=valid
    report={'source_drafts':len(drafts),'experienced':experienced,'qualified_drafts':len(qualified),
        'qualified_trophies':len(wanted),'complete_trajectories':len(clean),'excluded':dict(excluded),
        'cutoff':cutoff,'source_conflicts':len(conflicts),
        'trophy_outcomes':dict(Counter(f"{d['wins']}-{d['losses']}" for d in drafts.values() if trophy(d)))}
    if include_sources:
        report['sources']={did:{**d,'qualified':did in qualified,'complete':did in clean,
            'reason':'inconsistent_source_metadata' if did in conflicts else
            'experience_unverified_or_below_100' if (d['games'] or 0)<100 else
            'win_rate_unverified_or_below_cutoff' if d['rate'] is None or d['rate']<cutoff else source_reasons.get(did)}
            for did,d in drafts.items() if trophy(d)}
    return clean,report

def archive_header(path):
    with csv_bytes(path) as f:return next(csv.reader([f.readline().decode('utf-8-sig')]))

def cube_snapshot_check(premier_source,premier_header,trad_source,trad_header):
    pdate=parsedate_to_datetime(premier_source['last_modified']).date().isoformat()
    tdate=parsedate_to_datetime(trad_source['last_modified']).date().isoformat()
    pcards={x[len('pack_card_'):] for x in candidate_columns(premier_header)}
    tcards={x[len('pack_card_'):] for x in candidate_columns(trad_header)}
    result={'premier_archive_date':pdate,'traditional_archive_date':tdate,
        'premier_card_columns':len(pcards),'traditional_card_columns':len(tcards),
        'same_archive_date':pdate==tdate,'same_card_column_universe':pcards==tcards,
        'premier_only_cards':sorted(pcards-tcards),'traditional_only_cards':sorted(tcards-pcards)}
    result['pass']=result['same_archive_date'] and result['same_card_column_universe']
    return result

def source_audit(sid,qualified,strict_drafts,strict_qualified,strict_rejected):
    blocked=[]
    for did in sorted(set(qualified)-set(strict_qualified)):
        d=strict_drafts.get(did,{})
        blocked.append({'source_draft_hash':hashlib.sha256(f'{sid}|{did}'.encode()).hexdigest()[:32],
            'reason':strict_rejected.get(did,'unverified_trophy_losses'),'wins':d.get('wins'),'losses':d.get('losses')})
    return blocked

def measure(sid,directory,frozen):
    if sid not in SETS:raise ValueError('Environment was not Phase-1-testable')
    directory.mkdir(parents=True,exist_ok=True)
    pin=frozen_manifest(frozen,sid)
    if pin['model_version']!=MODEL_VERSION:raise ValueError('Unexpected frozen model version')
    draft=directory/'premier.csv.gz';game=directory/'premier-game.csv.gz'
    premier_source=pinned_archive(pin['source_archive'],draft)
    game_source=pinned_archive(pin['skill_source'],game)

    drafts,header,_,conflicts=scan_metadata(draft,compare_losses=False)
    skills={did:DraftSkill(d['rate'],d['games']) for did,d in drafts.items()
            if d['rate'] is not None and d['games'] is not None and did not in conflicts}
    training,_,_=select_strong_drafts(skills,100,.15,pin['training_cap'])
    qualified,_=eligible_trophies({did:{**d,'losses':None} for did,d in drafts.items()},pin['win_rate_cutoff'],conflicts=conflicts)
    counts,folds,output,_,training_picks,colour_examples=collect(draft,set(training),set(qualified),header)
    if len(training)!=pin['training_drafts'] or training_picks!=pin['training_picks'] or len(qualified)!=pin['qualified_trophies']:
        raise ValueError('Frozen training/cohort counts changed')
    fit=build_colour_table(game,colour_examples,{did for did,_ in colour_examples},sid)
    models=[OutOfFoldModel(counts,f,fit) for f in folds]

    by_hash={hashlib.sha256(f'{sid}|{did}'.encode()).hexdigest()[:32]:did for did in qualified}
    first,last=serving_window(sid);parity=0;known=metadata(ROOT)
    with gzip.open(frozen/sid/'puzzles.jsonl.gz','rt') as handle:
        for line in handle:
            old=json.loads(line)
            for c in old['candidates']+old['prior_picks']:
                known[c['name']]={k:v for k,v in c.items() if k in ('image_url','mana_cost','rarity','type_line')}
            if not first<=old['pick_number']<=last:continue
            did=by_hash.get(old['source_draft_hash'])
            if not did:raise ValueError('Frozen source hash not in reconstructed cohort')
            ps=[p for p in output[did] if p.raw_pick_number==old['pick_number']-1]
            if len(ps)!=1:raise ValueError('Frozen source decision missing')
            rebuilt=render_replay(did,ps,models[stable_fold(did,5)],1,1,{})['picks'][0]
            actual={c['name']:c['model_probability'] for c in rebuilt['candidates']}
            if actual!={c['name']:c['model_probability'] for c in old['candidates']}:
                raise ValueError('Reconstructed v3 evidence differs from immutable supplement')
            parity+=1
    if parity<200:raise ValueError('Insufficient frozen parity coverage')

    strict_drafts,_,_,strict_conflicts=scan_metadata(draft)
    strict_qualified,strict_rejected=eligible_trophies(strict_drafts,pin['win_rate_cutoff'],conflicts=strict_conflicts)
    strict_qualified={did:d for did,d in strict_qualified.items() if d.get('losses') in (0,1,2)}
    blocked=source_audit(sid,qualified,strict_drafts,strict_qualified,strict_rejected)
    atomic_json(directory/'premier-source-audit.json',{'set':sid,'corpus_version':pin['corpus_version'],
        'source_archive':premier_source,'frozen_qualified':len(qualified),'currently_qualified':len(strict_qualified),
        'blocked_sources':blocked,'outcomes':dict(Counter(f"7-{d.get('losses')}" for d in strict_qualified.values()))})

    groups={EVENTS[0]:{}};premier_initial={}
    for did,examples in output.items():
        if did not in strict_qualified:continue
        valid,prior,reason=complete_source(examples,sid)
        if not reason:groups[EVENTS[0]][did]=valid;premier_initial[did]=prior

    trad=directory/'traditional.csv.gz'
    trad_source=archive(f'{BASE}/draft_data/draft_data_public.{expansion(sid)}.TradDraft.csv.gz',trad)
    if sid==CUBE:
        groups[EVENTS[1]],trad_cohort=cube_traditional_cohort(trad,include_sources=True)
    else:
        groups[EVENTS[1]],trad_cohort=cohort(trad,EVENTS[1],include_sources=True)
    trad_sources=trad_cohort.pop('sources')
    snapshot=None
    if sid==CUBE:
        snapshot=cube_snapshot_check(premier_source,header,trad_source,archive_header(trad))
        if not snapshot['pass']:raise ValueError('Powered Cube Premier/Traditional snapshot mismatch')

    names={c for group in groups.values() for examples in group.values() for p in examples for c in (*p.candidates,*p.pool)}
    known=resolve_images(names,known,directory/'images.json')
    records=[];puzzles=[];excluded=Counter();ledger=[]
    for did,d in sorted(trad_sources.items()):
        if not d['complete']:
            ledger.append({'source_draft_hash':hashlib.sha256(f'{sid}|TradDraft|{did}'.encode()).hexdigest()[:32],
                'status':'excluded','qualified':d['qualified'],'reason':d['reason'],'event_type':'TradDraft','wins':3,'losses':0})

    for event,group in groups.items():
        for did,examples in sorted(group.items()):
            reason=None
            if any(len(p.candidates)<4 for p in examples):reason='fewer_than_four_candidates'
            if any(not known.get(c,{}).get('image_url','').startswith('https://') for p in examples for c in (*p.candidates,*p.pool)):
                reason='metadata_or_image_missing'
            if any(len({slugify(c) for c in p.candidates})!=len(p.candidates) for p in examples):
                reason='card_identity_collision'
            if reason:
                excluded[event+':'+reason]+=1
                if event==EVENTS[1]:
                    ledger.append({'source_draft_hash':hashlib.sha256(f'{sid}|{event}|{did}'.encode()).hexdigest()[:32],
                        'status':'excluded','qualified':True,'reason':reason,'event_type':event,'wins':3,'losses':0})
                continue
            model=models[stable_fold(did,5)]
            for p in examples:records.append(record(sid,event,did,p,model))
            if event!=EVENTS[1]:continue
            source=hashlib.sha256(f'{sid}|{event}|{did}'.encode()).hexdigest()[:32]
            fingerprint=hashlib.sha256(encoded([{'pick':p.raw_pick_number,'choice':p.historical_pick,'pack':p.candidates,'pool':p.pool} for p in examples])).hexdigest()
            rendered=render_replay(did,examples,model,1,1,known)['picks']
            initial=[next(iter(examples[0].pool))] if sid==CUBE else []
            prior=[{**known.get(name,{}),'id':slugify(name),'name':name} for name in initial]
            for p in rendered:
                if not first<=p['pick_number']<=last:continue
                pid=hashlib.sha256(f'{COMPONENT}|{sid}|{event}|{did}|{p["pick_number"]}'.encode()).hexdigest()[:32]
                puzzles.append({'puzzle_id':pid,'set_id':sid,'source_draft_hash':source,'source_fingerprint':fingerprint,
                    'corpus_version':COMPONENT,'model_version':MODEL_VERSION,'model_source_event':'PremierDraft',
                    'source_event_type':event,'source_evidence':'official_archive_trajectory','skill_evidence':'win_rate_bucket',
                    'event_match_wins':3,'event_match_losses':0,'player_games_lower_bound':trad_sources[did]['games'],
                    'player_win_rate_bucket':trad_sources[did]['rate'],'pick_number':p['pick_number'],
                    'historical_pick_id':p['historical_pick_id'],'candidates':p['candidates'],'prior_picks':list(prior)})
                card=next(c for c in p['candidates'] if c['id']==p['historical_pick_id'])
                prior.append({k:v for k,v in card.items() if k!='model_probability'})
            ledger.append({'source_draft_hash':source,'source_fingerprint':fingerprint,'status':'included','qualified':True,
                'event_type':event,'wins':3,'losses':0,'puzzles':8})

    if len(ledger)!=len(trad_sources):raise ValueError('Traditional trophy accounting mismatch')
    if sid==CUBE:
        tags={name:[] for name in names}
    else:
        tags=metadata_for_set(sid,models[0])
    report={'schema':2,'set':sid,'model_version':MODEL_VERSION,'model_source_event':'PremierDraft',
        'model_training_changed':False,'source_hashes':{EVENTS[0]:{'draft':premier_source,'game':game_source},EVENTS[1]:{'draft':trad_source}},
        'frozen_input_signature':pin['input_signature'],'parity_picks':parity,'training_drafts':len(training),
        'traditional_cohort':trad_cohort,'excluded':dict(excluded),'card_tags':tags,'tests':records,
        'serving_window':{'first_pick':first,'last_pick':last},'late_pick_floor':late_floor(sid),
        'premier_source_audit':{'blocked_sources':len(blocked),'reasons':dict(Counter(r['reason'] for r in blocked))},
        'cube_snapshot':snapshot,
        'implementation':{name:digest(ROOT/'scripts'/name) for name in ('traditional_phase2.py','traditional_puzzles.py','build_replays.py','deck_fit.py','import_all_trophies.py')}}
    report['all_picks']=compare(records)
    report['late_picks']=compare([r for r in records if r['pick']>=late_floor(sid)])
    serving=[r for r in records if max(r['raw'])<=.75 and sorted(r['raw'],reverse=True)[1]/max(r['raw'])>=.2]
    report['serving_picks']=compare(serving)
    report['serving_late_picks']=compare([r for r in serving if r['pick']>=late_floor(sid)])
    unusable=1-len(puzzles)/8/max(1,trad_cohort['complete_trajectories'])
    report['quality']={'usable_traditional_puzzles':len(puzzles),'unusable_fraction':unusable,
        'pass':unusable<=THRESHOLDS['unusable_trajectory_fraction_max']}
    write_gzip_jsonl(directory/'puzzles.jsonl.gz',puzzles);write_gzip_jsonl(directory/'trophies.jsonl.gz',ledger)
    with gzip.open(directory/'measurements.json.gz','wt') as f:json.dump(report,f,separators=(',',':'))
    atomic_json(directory/'summary.json',{k:v for k,v in report.items() if k not in ('tests','card_tags')})
    atomic_json(directory/'manifest.json',{'id':sid,'component_version':COMPONENT,'model_version':MODEL_VERSION,
        'model_source_event':'PremierDraft','source_event_type':'TradDraft','serving_status':'candidate','publication_authorized':False,
        'serving_window':report['serving_window'],'source_archive':trad_source,
        'puzzle_file_sha256':digest(directory/'puzzles.jsonl.gz'),'ledger_file_sha256':digest(directory/'trophies.jsonl.gz'),
        'puzzles':len(puzzles),'frozen_input_signature':pin['input_signature'],'cube_snapshot':snapshot})
    for path in (draft,game,trad):
        if path.exists():path.unlink()
    passed=all(report[k]['pass'] for k in ('all_picks','late_picks','serving_picks','serving_late_picks','quality'))
    print(json.dumps({'set':sid,'parity_picks':parity,'traditional_trajectories':trad_cohort['complete_trajectories'],
        'puzzles':len(puzzles),'pass':passed,'all_pass':report['all_picks']['pass'],
        'late_pass':report['late_picks']['pass'],'serving_pass':report['serving_picks']['pass'],
        'serving_late_pass':report['serving_late_picks']['pass'],'quality_pass':report['quality']['pass'],
        'cube_snapshot_pass':None if snapshot is None else snapshot['pass']}),flush=True)

def summarize(paths,out):
    reports=[]
    for path in paths:
        with gzip.open(path,'rt') as f:reports.append(json.load(f))
    if sorted(r['set'] for r in reports)!=sorted(SETS):
        missing=sorted(set(SETS)-{r['set'] for r in reports});extra=sorted({r['set'] for r in reports}-set(SETS))
        raise ValueError(f'Incomplete Phase 2 results; missing={missing}, extra={extra}')
    residuals=residual_report(reports)
    residuals['definition']=residuals['definition'].replace('calibrated combined-model','frozen Premier-only v3 model')
    by_set={}
    for r in reports:
        passed=all(r[k]['pass'] for k in ('all_picks','late_picks','serving_picks','serving_late_picks','quality'))
        by_set[r['set']]={'pass':passed,'all_picks':r['all_picks'],'late_picks':r['late_picks'],
            'serving_picks':r['serving_picks'],'serving_late_picks':r['serving_late_picks'],'quality':r['quality'],
            'traditional_cohort':r['traditional_cohort'],'premier_source_audit':r['premier_source_audit'],
            'parity_picks':r['parity_picks'],'serving_window':r['serving_window'],'cube_snapshot':r.get('cube_snapshot')}
    regression={sid:{'expected':expected,'actual':by_set[sid]['pass'],'match':by_set[sid]['pass']==expected}
        for sid,expected in REGRESSION.items()}
    regression_ok=all(x['match'] for x in regression.values())
    passing=[sid for sid in SETS if by_set[sid]['pass']]
    failed=[sid for sid in SETS if not by_set[sid]['pass']]
    persistent=residuals['persistent_category_patterns']
    total_trajectories=sum(by_set[s]['traditional_cohort']['complete_trajectories'] for s in SETS)
    candidate_puzzles=sum(by_set[s]['quality']['usable_traditional_puzzles'] for s in SETS)
    result={'schema':2,'thresholds':THRESHOLDS,'sets':by_set,'regression':regression,'regression_ok':regression_ok,
        'residuals':residuals,'passing_sets':passing,'failed_sets':failed,'traditional_trajectories':total_trajectories,
        'usable_candidate_puzzles':candidate_puzzles,'persistent_category_patterns':persistent,
        'automatic_expansion_supported':regression_ok and bool(passing) and not persistent,
        'production_changed':False,'model_training_changed':False,
        'decision':'Candidate inventory only; review per-environment gates and residuals before operational publication.'}
    atomic_json(out,result)
    print(json.dumps({k:v for k,v in result.items() if k not in ('sets','residuals','thresholds')},separators=(',',':')),flush=True)
    if not regression_ok:raise SystemExit('Reference-set regression changed; Phase 2 report invalid')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--set',choices=SETS);p.add_argument('--directory',type=Path,default=ROOT/'generated/traditional-phase2')
    p.add_argument('--frozen',type=Path,default=ROOT/'generated/frozen-v7');p.add_argument('--summarize',type=Path,nargs='+')
    p.add_argument('--out',type=Path,default=ROOT/'generated/traditional-phase2/report.json');a=p.parse_args()
    if a.summarize:summarize(a.summarize,a.out)
    elif a.set:measure(a.set,a.directory/a.set,a.frozen)
    else:p.error('Choose --set or --summarize')

if __name__=='__main__':main()
