#!/usr/bin/env python3
"""Read-only loss-aware audit of every included source in the frozen v7 corpus."""
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
from import_all_trophies import archive, atomic_json, digest, scan_metadata

def prepare(directory,out):
    catalog=json.loads((directory/'catalog.json').read_text())
    if not catalog['complete'] or catalog.get('errors'):raise ValueError('Incomplete frozen artifact')
    for manifest in catalog['sets']:
        sid=manifest['id'];ledger=directory/sid/'trophies.jsonl.gz'
        if digest(ledger)!=manifest['ledger_file_sha256']:raise ValueError('Incorrect source ledger')
        with gzip.open(ledger,'rt') as f:included=[json.loads(line) for line in f if line.strip()]
        included=[r for r in included if r['status']=='included']
        if len(included)!=manifest['included_trophies']:raise ValueError('Included source accounting mismatch')
        atomic_json(out/(sid+'.json'),{'set':sid,'corpus_version':manifest['corpus_version'],
            'archive':manifest['source_archive'],'input_signature':manifest['input_signature'],
            'sources':[{'draft_id':r['draft_id'],'source_draft_hash':r['source_draft_hash'],'puzzles':r['puzzles']} for r in included]})

def dispositions(sid,sources,drafts,conflicts):
    approved=Counter();excluded=[];seen=set()
    for source in sources:
        did=source['draft_id'];expected=hashlib.sha256(f'{sid}|{did}'.encode()).hexdigest()[:32]
        if did in seen or source['source_draft_hash']!=expected:raise ValueError('Invalid source identity')
        seen.add(did);d=drafts.get(did);reason=None
        if not d:reason='source_missing_from_pinned_archive'
        elif did in conflicts:reason='inconsistent_source_metadata'
        elif d['wins']!=7:reason='not_a_premier_trophy'
        elif d.get('losses') is None:reason='trophy_losses_unverified'
        elif d['losses'] not in (0,1,2):reason='invalid_premier_trophy_outcome'
        if reason:excluded.append({'source_draft_hash':expected,'reason':reason,'puzzles':source['puzzles'],'wins':d['wins'] if d else None,'losses':d.get('losses') if d else None})
        else:approved[f"7-{d['losses']}"]+=1
    return dict(approved_outcomes=dict(approved),approved_sources=sum(approved.values()),
        included_sources=len(sources),blocked_sources=excluded,
        exclusions_by_reason=dict(Counter(r['reason'] for r in excluded)),
        excluded_decisions=sum(r['puzzles'] for r in excluded))

def measure(inputs,out):
    spec=json.loads(inputs.read_text());sid=spec['set'];out.mkdir(parents=True,exist_ok=True)
    path=out/(sid+'.csv.gz');source=archive(spec['archive']['url'],path)
    if any(source.get(k)!=spec['archive'].get(k) for k in ('sha256','compressed_bytes')):raise ValueError('Pinned source changed')
    drafts,header,rows,conflicts=scan_metadata(path)
    result={'schema':1,'set':sid,'corpus_version':spec['corpus_version'],'source_archive':source,
        'input_signature':spec['input_signature'],'loss_field_available':'event_match_losses' in header,
        'archive_rows':rows,'archive_drafts':len(drafts),'production_changed':False,
        **dispositions(sid,spec['sources'],drafts,conflicts)}
    atomic_json(out/(sid+'.json'),result);path.unlink()
    print(json.dumps({k:v for k,v in result.items() if k not in ('blocked_sources','source_archive')}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--prepare',type=Path);p.add_argument('--input',type=Path);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    if a.prepare:prepare(a.prepare,a.out)
    elif a.input:measure(a.input,a.out)
    else:p.error('Use --prepare or --input')
