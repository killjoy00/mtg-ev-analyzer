#!/usr/bin/env python3
"""Reproducible v5 structural audit and blinded public-puzzle review sample."""
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path

from decision_context import PickState, card_features, diagnostic_flags

ROOT = Path(__file__).resolve().parents[1]
SETS = ('blb', 'dsk', 'neo', 'eoe', 'woe')
SEED = 'decision-context-v1-review'


def digest(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def stable(value):
    return hashlib.sha256(f'{SEED}:{value}'.encode()).hexdigest()


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False)+'\n')


def load_public(root=ROOT):
    puzzles, metadata, sources = [], {}, {}
    for sid in SETS:
        path = root / f'corpus/draft-run/{sid}.json.gz'
        sources[str(path.relative_to(root))] = digest(path)
        rows = json.loads(gzip.open(path, 'rt').read())
        metadata[sid] = {}
        for p in rows:
            if p['model_version'] != 'strong-player-colour-stage-v5':
                raise ValueError('Audit requires v5 puzzles only')
            for c in p['candidates'] + p['prior_picks']:
                # Current public metadata is display-only, and has no oracle text.
                metadata[sid][c['name']] = {k:c[k] for k in ('name','mana_cost','type_line','rarity') if k in c}
        puzzles.extend(rows)
    return puzzles, metadata, sources


def state_of(p):
    pool = Counter(c['name'] for c in p['prior_picks'])
    return PickState(p['set_id'], p['pick_number'], tuple(c['name'] for c in p['candidates']), tuple(sorted(pool.items())))


def build(puzzles, metadata):
    eligible, exclusions = [], Counter()
    for p in puzzles:
        if not 1 <= p['pick_number'] <= 8: continue
        try:
            state = state_of(p)
        except ValueError:
            exclusions['invalid_prefix_or_actions'] += 1
            continue
        eligible.append((p, state, diagnostic_flags(state, metadata[p['set_id']])))
    chosen, used = [], set()
    for sid in SETS:
        rows = [r for r in eligible if r[0]['set_id']==sid]
        # Equal pick-position coverage; never treat this as production weighting.
        for pick in range(1,9):
            candidates = sorted((r for r in rows if r[1].pick==pick), key=lambda r:stable('representative:'+r[0]['puzzle_id']))
            count = 0
            for r in candidates:
                source = (sid,r[0]['source_draft_hash'])
                if source in used: continue
                chosen.append(('representative',r));used.add(source);count+=1
                if count==3:break
            if count < 3: raise ValueError(f'{sid} pick {pick}: insufficient independent sources')
        candidates = sorted((r for r in rows if r[1].pick>=4 and r[2]),key=lambda r:stable('targeted:'+r[0]['puzzle_id']))
        count = 0
        for r in candidates:
            source = (sid,r[0]['source_draft_hash'])
            if source in used:continue
            chosen.append(('targeted',r));used.add(source);count+=1
            if count==24:break
        if count < 24: raise ValueError(f'{sid}: insufficient targeted sources')
    chosen.sort(key=lambda r:stable('presentation:'+r[1][0]['puzzle_id']))
    blind, key = [], []
    for i,(arm,(p,state,flags)) in enumerate(chosen,1):
        item_id = f'context-{i:03d}'
        # Copy only fields explicitly allowed in the blinded artifact.
        allowed = ('name','mana_cost','type_line','rarity','image_url')
        clean = lambda c:{k:c[k] for k in allowed if k in c}
        cards = sorted(p['candidates'], key=lambda c:stable(item_id+':'+c['name']))
        blind.append({'id':item_id,'set':state.set_id,'pick':state.pick,
                      'pool':[clean(c) for c in p['prior_picks']], 'candidates':[clean(c) for c in cards]})
        leader = max(p['candidates'],key=lambda c:c['model_probability'])
        key.append({'id':item_id,'stratum':arm,'set':state.set_id,'pick':state.pick,
                    'puzzle_id':p['puzzle_id'],'source_draft_hash':p['source_draft_hash'],
                    'flags':flags,'v5_leader':leader['name'],
                    'historical_pick':next(c['name'] for c in p['candidates'] if c['id']==p['historical_pick_id']),
                    'v5_support':{c['name']:c['model_probability'] for c in p['candidates']}})
    summary = {'scope':'public_trophy_diagnostic_only','sample_count':len(blind),
               'unique_sources':len(used),'eligible_puzzles':len(eligible),'exclusions':dict(exclusions),
               'strata':{arm:{'count':sum(r['stratum']==arm for r in key),
                             'flags':dict(Counter(f for r in key if r['stratum']==arm for f in r['flags'])),
                             'v5_historical_disagreements':sum(r['v5_leader']!=r['historical_pick'] for r in key if r['stratum']==arm)}
                         for arm in ('representative','targeted')},
               'metadata':{sid:{'cards':len(m),'without_oracle_text':sum(card_features(c)['text_missing'] for c in m.values())} for sid,m in metadata.items()},
               'interpretation':'Flags and disagreement are hypotheses, not model errors. Trophy sample cannot measure outcome improvement.'}
    return blind,key,summary


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,default=ROOT/'research/decision-context-v1')
    args=parser.parse_args()
    puzzles,metadata,sources=load_public()
    blind,key,summary=build(puzzles,metadata)
    summary['source_sha256']=sources
    summary['protocol_sha256']=digest(ROOT/'research/DECISION-CONTEXT-V1.md')
    for name,records in [('review-blind',blind),('review-key',key)]:
        raw=json.dumps(records,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
        args.out.mkdir(parents=True,exist_ok=True)
        (args.out/(name+'.json.gz')).write_bytes(gzip.compress(raw,mtime=0))
    write(args.out/'audit.json',summary)
    print(json.dumps(summary,indent=2))


if __name__=='__main__':main()
