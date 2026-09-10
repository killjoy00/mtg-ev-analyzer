#!/usr/bin/env python3
"""Reconcile auditable, held-out static replays with complete trophy trajectories.

Input matches come from analytics/draft_run_source_audit.sql. The fingerprint
checks every available card AND actual choice at every P1P1..P1P11. No model
probability from the unversioned historical Neon importer is trusted.
"""
import argparse
import gzip
import hashlib
import json
from collections import Counter
from pathlib import Path

VERSION = 'elite-trophy-verified-v5'


def fingerprint(picks):
    text = '|'.join(f"{p['pick_number']}:{p['historical_pick_id']}:" + ','.join(sorted(c['id'] for c in p['candidates'])) for p in picks)
    return hashlib.md5(text.encode()).hexdigest()


def build(matches, root=Path('.')):
    by_set = {}
    for m in matches:
        by_set.setdefault(m['set_id'], {})[m['draft_id']] = m
    catalog = {'corpus_version': VERSION, 'model_version': 'strong-player-pool-context-v2', 'holdout': '5-fold by draft_id', 'sets': []}
    for set_id, wanted in sorted(by_set.items()):
        manifest = json.loads((root / 'data' / set_id / 'manifest.json').read_text())
        assert manifest['model']['holdout'] == catalog['holdout']
        assert manifest['cohort']['minimum_games_bucket_lower_bound'] >= 100
        assert manifest['cohort']['win_rate_cutoff'] >= .6
        rows = []
        for file in sorted((root / 'data' / set_id / 'shards').glob('*.json')):
            for r in json.loads(file.read_text())['replays']:
                m = wanted.get(r['draft_id'])
                if not m:
                    continue
                picks = sorted((p for p in r['picks'] if p['pack_number'] == 1 and p['pick_number'] <= 11), key=lambda p: p['pick_number'])
                assert [p['pick_number'] for p in picks] == list(range(1, 12))
                assert fingerprint(picks) == m['fingerprint']
                assert int(m['wins']) == 7 and int(m['games']) >= 100 and float(m['win_rate']) >= .6
                prior = []
                for p in picks:
                    historical = next(c for c in p['candidates'] if c['id'] == p['historical_pick_id'])
                    # Verify the actual model context, not merely its length.
                    expected = Counter(c['name'] for c in prior)
                    assert dict(expected) == p['pool'], (set_id,r['draft_id'],p['pick_number'],'pool mismatch')
                    cards = p['candidates']
                    if len(cards) >= 4 and len({c['id'] for c in cards}) == len(cards):
                        rows.append({
                            'puzzle_id': hashlib.sha256(f"{VERSION}|{set_id}|{r['draft_id']}|{p['pick_number']}".encode()).hexdigest()[:32],
                            'set_id':set_id, 'source_draft_hash':m['source_draft_hash'],
                            'source_fingerprint':m['fingerprint'], 'corpus_version':VERSION,
                            'pick_number':p['pick_number'], 'historical_pick_id':p['historical_pick_id'],
                            'prior_picks':list(prior), 'candidates':cards,
                            'event_match_wins':7, 'player_games_lower_bound':int(m['games']),
                            'player_win_rate_bucket':float(m['win_rate']),
                        })
                    prior.append({k:v for k,v in historical.items() if k != 'model_probability'})
        output = root / 'corpus' / 'draft-run' / f'{set_id}.json.gz'
        output.parent.mkdir(parents=True,exist_ok=True)
        output.write_bytes(gzip.compress(json.dumps(rows,separators=(',',':')).encode(),mtime=0))
        catalog['sets'].append({'id':set_id,'name':manifest['name'],'puzzles':len(rows),'trophy_drafts':len(wanted),'source_date':manifest['source']['data_date'],'sha256':hashlib.sha256(output.read_bytes()).hexdigest()})
    (root / 'corpus' / 'draft-run' / 'catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
    return catalog


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--matches',required=True)
    args = parser.parse_args()
    print(json.dumps(build(json.loads(Path(args.matches).read_text())),indent=2))
