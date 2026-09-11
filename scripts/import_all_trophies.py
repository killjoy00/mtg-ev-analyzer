#!/usr/bin/env python3
"""Enumerate every official Premier Draft trophy, independently of replay samples.

Outputs immutable additional v6 puzzles and a disposition for EVERY source trophy.
Model training is bounded, broad-elite, and five-fold held out; trophy output is not.
Raw archives/checkpoints stay under generated/. The loader never changes old puzzles.
"""
import argparse
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from contextlib import contextmanager
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
import time
import urllib.request
import urllib.error
import urllib.parse

from build_replays import (CountStore, OutOfFoldModel, DraftSkill, stable_fold,
    select_strong_drafts, parse_example, candidate_columns, pool_columns,
    render_replay, parse_rate_bucket, parse_games_lower_bound, slugify)
from backfill_legacy_sets import arena_rank_proxy, arena_rank_tier, _game_order
from fetch_card_metadata import compact_card, aliases

ROOT = Path(__file__).resolve().parents[1]
VERSION = 'elite-trophy-verified-v6'
IMPORT_VERSION = 'all-premier-trophies-v1'
SOURCE_PAGE = 'https://www.17lands.com/public_datasets'
BASE = 'https://17lands-public.s3.amazonaws.com/analysis_data'
USER_AGENT = 'PackOne-Trophy-Import/2.0 (https://github.com/killjoy00/mtg-ev-analyzer)'


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024*1024), b''): h.update(chunk)
    return h.hexdigest()


def atomic_json(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.tmp'); temp.write_bytes(encoded(value)); temp.replace(path)


def request(url, method='GET'):
    if not (url.startswith(BASE + '/') or url.startswith('https://17lands.cdn.prismic.io/api/v2') or url.startswith('https://www.17lands.com/') or url.startswith('https://api.scryfall.com/')):
        raise ValueError('Unapproved source host')
    return urllib.request.urlopen(urllib.request.Request(url, method=method, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json,*/*'}), timeout=90)


def premier_sources(document):
    result = {}; unavailable = []
    for row in document['results'][0]['data']['datasets']:
        if ''.join(x.get('text','') for x in row['format']) != 'PremierDraft': continue
        label = ''.join(x.get('text','') for x in row['expansion'])
        links = [s['data']['url'] for x in row['draft_data'] for s in x.get('spans',[]) if s.get('type')=='hyperlink']
        if not links:
            unavailable.append({'expansion':label,'reason':'no_public_draft_archive'}); continue
        if len(set(links)) != 1: raise ValueError('Ambiguous Premier archive')
        match = re.fullmatch(re.escape(BASE) + r'/draft_data/draft_data_public\.([\w-]+)\.PremierDraft\.csv\.gz',links[0])
        if not match: raise ValueError('Unexpected Premier archive URL')
        expansion = match[1]; sid = 'powered-cube' if expansion=='Cube_-_Powered' else expansion.lower()
        if sid in result and result[sid]!=expansion: raise ValueError('Duplicate environment identity')
        result[sid]=expansion
    if not result: raise ValueError('No Premier archives discovered')
    return result, unavailable


def discover():
    endpoint='https://17lands.cdn.prismic.io/api/v2'
    with request(endpoint) as r: index=json.load(r)
    ref=next(x['ref'] for x in index['refs'] if x.get('isMasterRef'))
    with request(endpoint+'/documents/search?'+urllib.parse.urlencode({'ref':ref,'q':'[[at(document.type,"public-data")]]','pageSize':100})) as r: document=json.load(r)
    if document['total_results_size']!=1: raise ValueError('Public dataset document changed')
    sources,unavailable=premier_sources(document)
    return sources, {'page':SOURCE_PAGE,'cms_ref':ref,'document_updated':document['results'][0]['last_publication_date'],'unavailable':unavailable,'archives':sources}


def archive(url, path, refresh=False):
    """Validate cached bytes; resume completed archives only, never partial downloads."""
    path = Path(path); meta_path = path.with_suffix(path.suffix + '.json')
    with request(url, 'HEAD') as r:
        remote = {'url': url, 'etag': r.headers.get('ETag'), 'last_modified': r.headers.get('Last-Modified'), 'compressed_bytes': int(r.headers.get('Content-Length', 0))}
    if not refresh and path.exists() and meta_path.exists():
        old = json.loads(meta_path.read_text())
        if all(old.get(k) == remote[k] for k in remote) and path.stat().st_size == remote['compressed_bytes'] and digest(path) == old['sha256']:
            return old
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + '.part')
    for attempt in range(3):
        try:
            with request(url) as r, temp.open('wb') as out:
                if r.headers.get('ETag') != remote['etag']: raise ValueError('Archive changed during download')
                for chunk in iter(lambda: r.read(1024*1024), b''): out.write(chunk)
            if remote['compressed_bytes'] and temp.stat().st_size != remote['compressed_bytes']: raise ValueError('Truncated archive')
            remote['sha256'] = digest(temp); temp.replace(path); atomic_json(meta_path, remote)
            return remote
        except Exception:
            if attempt == 2: raise
            time.sleep(1 + attempt)


@contextmanager
def csv_bytes(path):
    # Some old .csv.gz files actually contain a tar archive. Do not parse its header as CSV.
    with gzip.open(path, 'rb') as gz:
        tarred = gz.peek(512)[257:262] == b'ustar'
    if tarred:
        with tarfile.open(path, mode='r|gz') as tar:
            for member in tar:
                if member.isfile() and member.name.endswith('.csv'):
                    yield tar.extractfile(member)
                    return
            raise ValueError('No CSV in legacy archive')
    else:
        with gzip.open(path, 'rb') as handle: yield handle


def rows(path, wanted=None):
    """Skip unneeded draft IDs before parsing wide card columns."""
    with csv_bytes(path) as f:
        header = next(csv.reader([f.readline().decode('utf-8-sig')]))
        index = header.index('draft_id')
        for line in f:
            if not line.strip(): continue
            if wanted is not None:
                prefix = line.split(b',', index+1)
                if prefix[index].strip(b'"').decode() not in wanted: continue
            values = next(csv.reader([line.decode()]))
            if len(values) != len(header): raise ValueError('Malformed archive row')
            row = dict(zip(header, values))
            if wanted is not None and row['draft_id'] not in wanted: raise ValueError('Unsupported draft ID prefix')
            yield row


def scan_metadata(path):
    """Read all draft IDs, outcome and skill; no output/replay/training cap here."""
    drafts = {}; count = 0; conflicts = set()
    with csv_bytes(path) as f:
        header = next(csv.reader([f.readline().decode('utf-8-sig')]))
        modern = header[:9] == ['expansion','event_type','draft_id','draft_time','rank','event_match_wins','event_match_losses','pack_number','pick_number'] and header[-2:] == ['user_n_games_bucket','user_game_win_rate_bucket']
        for line in f:
            if not line.strip(): continue
            count += 1
            if modern:
                prefix = line.split(b',', 9); tail = line.rsplit(b',', 2)
                row = dict(zip(header[:9], (x.decode().strip('"') for x in prefix[:9])))
                row.update(zip(header[-2:], (x.decode().strip().strip('"') for x in tail[-2:])))
            else:
                values = next(csv.reader([line.decode()]))
                if len(values) != len(header): raise ValueError('Malformed source row')
                row = dict(zip(header, values))
            if row.get('event_type') != 'PremierDraft': raise ValueError('Non-Premier draft in archive')
            did = row['draft_id']
            item = {'wins': int(float(row['event_match_wins'] or -1)),
                    'games': parse_games_lower_bound(row.get('user_n_games_bucket')),
                    'rate': parse_rate_bucket(row.get('user_game_win_rate_bucket'))}
            if did in drafts and drafts[did] != item: conflicts.add(did)
            else: drafts[did] = item
    return drafts, header, count, conflicts


def legacy_skills(path, wanted):
    earliest = {}
    for i, row in enumerate(rows(path, wanted)):
        order = _game_order(row, i)
        did = row['draft_id']
        if did not in earliest or order < earliest[did][0]:
            earliest[did] = (order, {'rank': arena_rank_tier(row.get('rank')), 'games': parse_games_lower_bound(row.get('user_n_games_bucket'))})
    return {did: value for did, (_, value) in earliest.items()}


def eligible_trophies(drafts, cutoff, legacy=False, conflicts=()):
    result = {}; rejected = {}
    for did, d in drafts.items():
        if d['wins'] != 7: continue
        if did in conflicts: rejected[did] = 'inconsistent_source_metadata'
        elif (d.get('games') or 0) < 100: rejected[did] = 'experience_unverified_or_below_100'
        elif legacy and d.get('rank') not in ('diamond','mythic'): rejected[did] = 'rank_unverified_or_below_diamond'
        elif not legacy and (d.get('rate') is None or d['rate'] < cutoff): rejected[did] = 'win_rate_unverified_or_below_cutoff'
        else: result[did] = d
    return result, rejected


def collect(path, training_ids, output_ids, header):
    all_counts = CountStore.empty(); folds = [CountStore.empty() for _ in range(5)]
    output = defaultdict(list); invalid = Counter(); picks = 0
    pack_cols, pool_cols = candidate_columns(header), pool_columns(header)
    if not pack_cols or not pool_cols: raise ValueError('Missing pack or pool columns')
    for row in rows(path, training_ids | output_ids):
        did = row['draft_id']; example = parse_example(row, pack_cols, pool_cols)
        if example is None:
            if did in output_ids: invalid[did] += 1
            continue
        if did in training_ids:
            all_counts.observe(example); folds[stable_fold(did, 5)].observe(example); picks += 1
        if did in output_ids and example.raw_pack_number == 0 and example.raw_pick_number <= 11:
            output[did].append(example)
    return all_counts, folds, output, invalid, picks


def trajectory(examples, last_pick):
    """Return only a contiguous, source-verified prefix; never invent a missing card."""
    ordered = sorted(examples, key=lambda p:p.raw_pick_number)
    if not ordered: return [], [], 'missing_opening_trajectory'
    first = ordered[0].raw_pick_number
    if first not in (0,1): return [], [], 'missing_opening_trajectory'
    prior = []
    if first == 1:
        initial = ordered[0].pool
        if sum(initial.values()) != 1: return [], [], 'invalid_initial_pool'
        prior = [next(iter(initial))]
    initial = list(prior); valid = []; reason = None
    for p in ordered:
        if p.raw_pick_number >= last_pick: break
        if p.raw_pick_number != len(prior): reason = 'trajectory_gap_or_duplicate'; break
        if dict(Counter(prior)) != p.pool: reason = 'trajectory_pool_mismatch'; break
        if p.historical_pick not in p.candidates or len(p.candidates) != len(set(p.candidates)):
            reason = 'invalid_candidates'; break
        valid.append(p); prior.append(p.historical_pick)
    if len(prior) < last_pick and reason is None: reason = 'incomplete_later_trajectory'
    return valid, initial, reason


def metadata(root):
    supplemental = json.loads((root/'corpus/draft-run/card-images.json').read_text())
    result = {}
    for path in sorted((root/'data').glob('*/shards/*.json')):
        for replay in json.loads(path.read_text()).get('replays', []):
            for pick in replay['picks']:
                for c in pick['candidates']:
                    c = {**supplemental.get(c['id'], {}), **c}
                    if c.get('image_url','').startswith('https://'):
                        result[c['name']] = {k:v for k,v in c.items() if k in ('image_url','mana_cost','rarity','type_line')}
    return result


def resolve_images(names, known, cache_path):
    import urllib.parse
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    known = {**known, **{k:v for k,v in cache.items() if v}}
    for name in sorted(names - known.keys() - cache.keys()):
        # Exact identities only. A fuzzy card with a similar name is not a substitute.
        time.sleep(.15)
        try:
            with request('https://api.scryfall.com/cards/named?exact='+urllib.parse.quote(name)) as r: card = json.load(r)
            value = compact_card(card) if name in set(aliases(card)) else None
            if value and value.get('image_url','').startswith('https://'): known[name] = value; cache[name] = value
            else: cache[name] = None
        except urllib.error.HTTPError as e:
            if e.code != 404: raise
            cache[name] = None
        atomic_json(cache_path, cache)
    return known


def write_gzip_jsonl(path, values):
    with path.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0, filename='') as f:
        for value in values: f.write(encoded(value)+b'\n')


def build_set(sid, output_dir, refresh=False, discovered_expansion=None):
    started = time.monotonic(); root = ROOT; directory = Path(output_dir)/sid; directory.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((root/'corpus/draft-run/catalog.json').read_text())
    base_entry = next((s for s in catalog['sets'] if s['id']==sid), None)
    manifest_path = root/'data'/sid/'manifest.json'
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    expansion = discovered_expansion or manifest.get('source',{}).get('archive_expansion') or sid.upper()
    url = f'{BASE}/draft_data/draft_data_public.{expansion}.PremierDraft.csv.gz'
    path = directory/'draft.csv.gz'; source = archive(url, path, refresh)
    with csv_bytes(path) as f: header=next(csv.reader([f.readline().decode('utf-8-sig')]))
    legacy = 'user_game_win_rate_bucket' not in header or 'user_n_games_bucket' not in header
    skill_source = archive(f'{BASE}/game_data/game_data_public.{expansion}.PremierDraft.csv.gz', directory/'games.csv.gz', refresh) if legacy else None
    signature = hashlib.sha256(encoded({'source':source, 'skill_source':skill_source, 'importer':digest(__file__), 'model':digest(root/'scripts/build_replays.py'), 'legacy_model':digest(root/'scripts/backfill_legacy_sets.py'), 'images':digest(root/'corpus/draft-run/card-images.json'), 'baseline':base_entry, 'manifest':manifest})).hexdigest()
    completed = directory/'manifest.json'
    if not refresh and completed.exists():
        old = json.loads(completed.read_text())
        if old.get('input_signature') == signature and all((directory/old[k]).exists() and digest(directory/old[k]) == old[k+'_sha256'] for k in ['puzzle_file','ledger_file']):
            print(f'{sid}: complete checkpoint reused', flush=True); return old
    drafts, header, source_rows, conflicts = scan_metadata(path)
    if legacy:
        game = directory/'games.csv.gz'
        skills = legacy_skills(game, set(drafts))
        for did, item in drafts.items(): item.update(skills.get(did, {}))
        training_skills = {did:DraftSkill(arena_rank_proxy(d.get('rank'),did),d['games']) for did,d in drafts.items() if d.get('rank') and d.get('games') is not None and did not in conflicts}
    else: training_skills = {did:DraftSkill(d['rate'],d['games']) for did,d in drafts.items() if d['rate'] is not None and d['games'] is not None and did not in conflicts}
    experienced = {did:s for did,s in training_skills.items() if s.games_lower_bound>=100}
    training = []; cutoff = None
    if len(experienced)>=5:
        training, calculated, _ = select_strong_drafts(training_skills,100,.15,5000)
        cutoff = None if legacy else max(.6,calculated,manifest.get('cohort',{}).get('win_rate_cutoff',0))
    qualified, rejected = eligible_trophies(drafts, cutoff or .6, legacy, conflicts)
    old_rows = json.loads(gzip.decompress((root/'corpus/draft-run'/f'{sid}.json.gz').read_bytes())) if base_entry else []
    old_by_id = {p['puzzle_id']:p for p in old_rows}
    old_sources = {p['source_draft_hash'] for p in old_rows}
    if qualified and len(training)<5: raise ValueError(f'{sid}: insufficient broad-elite training data')
    print(f'{sid}: {len(drafts)} drafts, {len(qualified)} qualifying trophies, {len(training)} training drafts',flush=True)
    additions=[]; dispositions=[]; reasons=Counter(); retained=set(); missing_names=set(); training_picks=0
    if qualified:
        all_counts, folds, output, invalid, training_picks = collect(path,set(training),set(qualified),header)
        all_names = {name for examples in output.values() for p in examples for name in list(p.candidates)+list(p.pool)}
        known = resolve_images(all_names, metadata(root), directory/'images.json')
        for did,d in sorted(qualified.items()):
            valid, prior, why = trajectory(output.get(did,[]),12 if sid=='powered-cube' else 11)
            source_hash=hashlib.sha256(f'{sid}|{did}'.encode()).hexdigest()[:32]
            model=OutOfFoldModel(all_counts,folds[stable_fold(did,5)])
            rendered=render_replay(did,valid,model,1,1,known)['picks']
            fingerprint=hashlib.sha256(encoded([{'pick':p.raw_pick_number,'choice':p.historical_pick,'pack':p.candidates,'pool':p.pool} for p in valid])).hexdigest()
            included=0; new=0; skipped=Counter()
            for p in rendered:
                n=p['pick_number'];pid=hashlib.sha256(f'{VERSION}|{sid}|{did}|{n}'.encode()).hexdigest()[:32]
                cards=p['candidates'];history=[{'id':slugify(name),'name':name,**known.get(name,{})} for name in prior]
                pick_name=next(c['name'] for c in cards if c['id']==p['historical_pick_id'])
                prior.append(pick_name)
                if pid in old_by_id:
                    old=old_by_id[pid]
                    if [c['name'] for c in old['prior_picks']]!=[c['name'] for c in history] or old['historical_pick_id']!=p['historical_pick_id'] or {c['name'] for c in old['candidates']}!={c['name'] for c in cards}: raise ValueError(f'{sid}: existing puzzle source changed')
                    included+=1;retained.add(pid);continue
                if len(cards)<4: skipped['fewer_than_four_candidates']+=1;continue
                absent=[c['name'] for c in cards+history if not c.get('image_url','').startswith('https://')]
                if absent: missing_names.update(absent);skipped['image_unresolved']+=1;continue
                if len({c['id'] for c in cards})!=len(cards): skipped['card_identity_collision']+=1;continue
                additions.append({'puzzle_id':pid,'set_id':sid,'source_draft_hash':source_hash,'source_fingerprint':fingerprint,'corpus_version':VERSION,'source_evidence':'official_archive_trajectory','skill_evidence':'earliest_game_arena_rank' if legacy else 'win_rate_bucket','player_rank_tier':d.get('rank') if legacy else None,'pick_number':n,'historical_pick_id':p['historical_pick_id'],'prior_picks':history,'candidates':cards,'event_match_wins':7,'player_games_lower_bound':d['games'],'player_win_rate_bucket':None if legacy else d['rate']})
                included+=1;new+=1
            status='included' if included else 'excluded'
            reason=why or ('invalid_source_pick' if invalid[did] else None)
            dispositions.append({'draft_id':did,'source_draft_hash':source_hash,'status':status,'qualified':True,'puzzles':included,'additional_puzzles':new,'trajectory_limit':reason,'excluded_decisions':dict(skipped),'source_fingerprint':fingerprint})
            if not included: reasons[reason or (next(iter(skipped)) if skipped else 'no_verified_decisions')]+=1
    for did,reason in sorted(rejected.items()):
        dispositions.append({'draft_id':did,'status':'excluded','qualified':False,'reason':reason});reasons[reason]+=1
    if base_entry and len(retained)!=len(old_rows): raise ValueError(f'{sid}: failed to reverify {len(old_rows)-len(retained)} existing decisions')
    trophy_count=sum(d['wins']==7 for d in drafts.values())
    if len(dispositions)!=trophy_count: raise ValueError('Incomplete trophy accounting')
    puzzle_file=directory/'puzzles.jsonl.gz';ledger_file=directory/'trophies.jsonl.gz'
    write_gzip_jsonl(puzzle_file,sorted(additions,key=lambda p:p['puzzle_id']));write_gzip_jsonl(ledger_file,sorted(dispositions,key=lambda d:d['draft_id']))
    info={'id':sid,'import_version':IMPORT_VERSION,'corpus_version':VERSION,'input_signature':signature,'source_archive':source,'skill_source':skill_source,'source_rows':source_rows,'source_drafts':len(drafts),'source_trophies':trophy_count,'qualified_trophies':len(qualified),'included_trophies':sum(d['status']=='included' for d in dispositions),'excluded_trophies':sum(d['status']=='excluded' for d in dispositions),'exclusion_reasons':dict(reasons),'missing_image_names':sorted(missing_names),'existing_puzzles_preserved':len(retained),'additional_puzzles':len(additions),'total_puzzles':len(retained)+len(additions),'training_drafts':len(training),'training_picks':training_picks,'model_version':'strong-player-pool-context-v2','holdout':'5-fold by draft_id','training_cohort':'broader elite players, independent of trophy outcome','win_rate_cutoff':cutoff,'minimum_games':100,'puzzle_file':puzzle_file.name,'puzzle_file_sha256':digest(puzzle_file),'ledger_file':ledger_file.name,'ledger_file_sha256':digest(ledger_file),'seconds':round(time.monotonic()-started)}
    atomic_json(completed,info);print(json.dumps(info),flush=True);return info


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sets',default='all');parser.add_argument('--workers',type=int,default=3)
    parser.add_argument('--output',default='generated/trophy-import');parser.add_argument('--refresh',action='store_true')
    args=parser.parse_args()
    sources,discovery=discover()
    atomic_json(Path(args.output)/'discovery.json',discovery)
    ids=list(sources) if args.sets=='all' else args.sets.split(',')
    if any(sid not in sources for sid in ids): raise ValueError('Requested set has no official Premier archive')
    ids=list(dict.fromkeys(ids));results=[];errors={}
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        jobs={executor.submit(build_set,sid,args.output,args.refresh,sources[sid]):sid for sid in ids}
        for future in as_completed(jobs):
            try:results.append(future.result())
            except Exception as exc:errors[jobs[future]]=str(exc);print(json.dumps({'set':jobs[future],'error':str(exc)}),flush=True)
    report={'import_version':IMPORT_VERSION,'corpus_version':VERSION,'requested_sets':ids,'sets':sorted(results,key=lambda s:s['id']),'errors':errors,'complete':not errors and len(results)==len(ids)}
    atomic_json(Path(args.output)/'catalog.json',report)
    if errors:raise SystemExit('Import incomplete; successful sets checkpointed. See catalog.json.')

if __name__=='__main__':main()
