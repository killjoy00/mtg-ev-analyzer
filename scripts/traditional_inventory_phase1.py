#!/usr/bin/env python3
"""Phase 1 inventory for possible Traditional trophy puzzle expansion.

Research-only. Downloads one public 17Lands TradDraft archive, applies the
existing Pack One strong-player/trophy qualification, and reports whether the
environment has at least 100 complete eight-decision Traditional trajectories.
Regular sets require P1P1-P1P8. Powered Cube requires P1P2-P1P9 with the real
inherited P1P1 card in the pool.

No database access, model changes, puzzle publication, or production writes.
"""
import argparse
from collections import Counter, defaultdict
import csv
import json
from pathlib import Path
import urllib.error

from build_replays import (
    DraftSkill, candidate_columns, pool_columns, parse_example,
    parse_games_lower_bound, parse_rate_bucket, select_strong_drafts,
)
from format_research import cohort
from import_all_trophies import archive, BASE, csv_bytes, rows, trajectory, atomic_json

MIN_TRAJECTORIES = 100
CUBE_ID = 'powered-cube'
CUBE_EXPANSION = 'Cube_-_Powered'

def expansion_for(sid):
    return CUBE_EXPANSION if sid == CUBE_ID else sid.upper()

def cube_cohort(path):
    event='TradDraft'; drafts={}; conflicts=set()
    with csv_bytes(path) as f:
        header=next(csv.reader([f.readline().decode('utf-8-sig')]))
        required={'draft_id','event_type','event_match_wins','event_match_losses',
                  'pack_number','pick_number','pick','user_n_games_bucket',
                  'user_game_win_rate_bucket'}
        if not required.issubset(header):
            raise ValueError('Equivalent outcome/skill fields unavailable: '+','.join(sorted(required-set(header))))
        modern=header[:9]==['expansion','event_type','draft_id','draft_time','rank',
                            'event_match_wins','event_match_losses','pack_number','pick_number'] \
            and header[-2:]==['user_n_games_bucket','user_game_win_rate_bucket']
        for line in f:
            if not line.strip(): continue
            if modern:
                item=dict(zip(header[:9],(v.decode().strip('"') for v in line.split(b',',9)[:9])))
                item.update(zip(header[-2:],(v.decode().strip().strip('"') for v in line.rsplit(b',',2)[-2:])))
            else:
                values=next(csv.reader([line.decode()]))
                if len(values)!=len(header): raise ValueError('Malformed archive row')
                item=dict(zip(header,values))
            if item['event_type']!=event: raise ValueError('Archive event identity mismatch')
            d={'wins':int(float(item['event_match_wins'] or -1)),
               'losses':int(float(item['event_match_losses'])) if item['event_match_losses'] else None,
               'games':parse_games_lower_bound(item['user_n_games_bucket']),
               'rate':parse_rate_bucket(item['user_game_win_rate_bucket'])}
            did=item['draft_id']
            if did in drafts and drafts[did]!=d: conflicts.add(did)
            else: drafts[did]=d

    skills={did:DraftSkill(d['rate'],d['games']) for did,d in drafts.items()
            if did not in conflicts and d['rate'] is not None and d['games'] is not None}
    _,cutoff,experienced=select_strong_drafts(skills,100,.15,None)
    cutoff=max(.6,cutoff)
    qualified={did for did,s in skills.items() if s.games_lower_bound>=100 and s.rate>=cutoff}
    def trophy(d): return d['wins']==3 and d['losses']==0
    wanted={did for did in qualified if trophy(drafts[did])}

    examples=defaultdict(list); pack=candidate_columns(header); pool=pool_columns(header)
    if not pack or not pool: raise ValueError('Missing candidate/pool columns')
    for row in rows(path,wanted):
        pack_number=int(float(row['pack_number']))
        pick_number=int(float(row['pick_number']))
        if pack_number!=0 or not 1<=pick_number<9: continue
        p=parse_example(row,pack,pool)
        if p: examples[p.draft_id].append(p)

    clean={}; excluded=Counter()
    for did in sorted(wanted):
        valid,prior,reason=trajectory(examples[did],9)
        if len(prior)!=1 or len(valid)!=8 or not valid or valid[0].raw_pick_number!=1:
            excluded[reason or 'missing_complete_p1p2_p1p9']+=1
        else:
            clean[did]=valid
    return clean,{
        'source_drafts':len(drafts),
        'experienced':experienced,
        'qualified_drafts':len(qualified),
        'qualified_trophies':len(wanted),
        'complete_trajectories':len(clean),
        'excluded':dict(excluded),
        'cutoff':cutoff,
        'source_conflicts':len(conflicts),
        'trophy_outcomes':dict(Counter(f"{d['wins']}-{d['losses']}" for d in drafts.values() if trophy(d))),
    }

def measure(sid,out):
    out=Path(out); out.parent.mkdir(parents=True,exist_ok=True)
    expansion=expansion_for(sid)
    url=f'{BASE}/draft_data/draft_data_public.{expansion}.TradDraft.csv.gz'
    source=out.parent/(sid+'.trad.csv.gz')
    result={'schema':1,'set':sid,'expansion':expansion,'source_event_type':'TradDraft',
            'playable_window':'P1P2-P1P9' if sid==CUBE_ID else 'P1P1-P1P8',
            'minimum_complete_trajectories':MIN_TRAJECTORIES,
            'archive_url':url,'production_changed':False}
    try:
        result['archive']=archive(url,source)
    except urllib.error.HTTPError as exc:
        if exc.code in (403,404):
            result.update({'archive_available':False,'classification':'DATA_UNAVAILABLE',
                           'reason':f'public TradDraft archive HTTP {exc.code}'})
            atomic_json(out,result); print(json.dumps(result),flush=True); return
        raise
    result['archive_available']=True
    try:
        _,report=(cube_cohort(source) if sid==CUBE_ID else cohort(source,'TradDraft'))
        result['cohort']=report
        result['classification']='TESTABLE' if report['complete_trajectories']>=MIN_TRAJECTORIES else 'UNDERPOWERED'
        if result['classification']=='UNDERPOWERED':
            result['reason']=f"only {report['complete_trajectories']} complete trajectories"
    except ValueError as exc:
        result.update({'classification':'SCHEMA_OR_WINDOW_UNAVAILABLE','reason':str(exc)})
    finally:
        if source.exists(): source.unlink()
        meta=source.with_suffix(source.suffix+'.json')
        if meta.exists(): meta.unlink()
    atomic_json(out,result); print(json.dumps(result),flush=True)

def summarize(paths,out_json,out_md):
    rows=[]
    for path in paths:
        rows.append(json.loads(Path(path).read_text()))
    order=json.loads(Path('data/selection-policy.json').read_text())
    sequence=order['regular_sets_newest_first']+order['selectable_only_sets']+[CUBE_ID,'stx']
    rank={sid:i for i,sid in enumerate(sequence)}
    rows.sort(key=lambda r:(rank.get(r['set'],999),r['set']))
    counts=Counter(r['classification'] for r in rows)
    total=sum((r.get('cohort') or {}).get('complete_trajectories',0) for r in rows if r['classification']=='TESTABLE')
    report={'schema':1,'minimum_complete_trajectories':MIN_TRAJECTORIES,'sets':rows,
            'classification_counts':dict(counts),'testable_complete_trajectories':total,
            'production_changed':False}
    atomic_json(out_json,report)
    lines=[
        '# Traditional inventory Phase 1',
        '',
        'Research-only availability/cohort inventory. No model, database, corpus, or serving changes.',
        '',
        '| Environment | Window | Trad archive | Qualified 3-0 | Complete trajectories | Cutoff | Classification |',
        '| --- | --- | --- | ---: | ---: | ---: | --- |',
    ]
    for r in rows:
        c=r.get('cohort') or {}
        lines.append(f"| {r['set'].upper()} | {r['playable_window']} | {'yes' if r.get('archive_available') else 'no'} | "
                     f"{c.get('qualified_trophies','—')} | {c.get('complete_trajectories','—')} | "
                     f"{c.get('cutoff','—') if c.get('cutoff') is None else format(c.get('cutoff'),'.3f')} | {r['classification']} |")
    lines += ['',f"Testable complete Traditional trajectories: **{total:,}**.",
              '', 'Classification counts: '+json.dumps(dict(counts),sort_keys=True)+'.']
    Path(out_md).parent.mkdir(parents=True,exist_ok=True)
    Path(out_md).write_text('\n'.join(lines)+'\n')
    print('\n'.join(lines),flush=True)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--set')
    p.add_argument('--out',type=Path)
    p.add_argument('--summarize',nargs='*',type=Path)
    p.add_argument('--out-json',type=Path,default=Path('generated/traditional-inventory/report.json'))
    p.add_argument('--out-md',type=Path,default=Path('generated/traditional-inventory/report.md'))
    args=p.parse_args()
    if args.summarize is not None:
        summarize(args.summarize,args.out_json,args.out_md); return
    if not args.set or not args.out: p.error('Use --set and --out, or --summarize.')
    measure(args.set,args.out)

if __name__=='__main__': main()
