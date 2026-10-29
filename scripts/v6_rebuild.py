#!/usr/bin/env python3
"""Checkpointed v6 rebuild of the 31 production v9 environments from their exact inputs.

Mirrors the v5 rebuild: each environment runs in its own checkout, source bytes
and completed phases are content-addressed in R2, and the corpus is assembled
only after every environment passes provenance, training and file checks.
FRA has no replay environment in v9, so it rebuilds trophies and Traditional only.
"""
import argparse
import csv
from contextlib import ExitStack
import email.utils
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
from unittest.mock import patch

from model_training import V6_MODEL, V6_CORPUS, validate_training_manifest
from set_policy import corpus_version, set_corpus_version

ROOT = Path(__file__).resolve().parents[1]
PINS = ROOT / 'research/v6-build-source-pins.json'
TRADITIONAL_PINS = ROOT / 'research/v6-traditional-source-pins.json'
BUILD = ROOT / 'generated/v6-build'
SOURCES = ROOT / 'generated/v6-sources'
ENVIRONMENTS = 31
REPLAY_ENVIRONMENTS = 30


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, sort_keys=True, indent=2)+'\n')


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()


def run(*command):
    subprocess.run([str(x) for x in command], cwd=ROOT, check=True)


def pins():
    rows = read(PINS)['sets']
    by_id = {p['id']: p for p in rows}
    if len(by_id) != ENVIRONMENTS or len(rows) != ENVIRONMENTS or \
            sum(bool(p['replay']) for p in rows) != REPLAY_ENVIRONMENTS:
        raise ValueError('Expected the 31 production v9 environments, 30 with replays')
    return by_id


def identity():
    # Any build dependency or source change invalidates every phase checkpoint.
    files = sorted((ROOT/'scripts').glob('*.py')) + [PINS, TRADITIONAL_PINS,
        ROOT/'model-versions.json', ROOT/'data/catalog.json',
        ROOT/'corpus/draft-run/card-images.json']
    return hashlib.sha256(json.dumps({str(p.relative_to(ROOT)):sha(p) for p in files},
        sort_keys=True).encode()).hexdigest()


def r2(local, key, upload=False, optional=False, prefix='v6-build'):
    endpoint, bucket = os.environ.get('R2_ENDPOINT'), os.environ.get('R2_BUCKET')
    if not endpoint or not bucket:
        if optional:
            return False
        raise ValueError('Durable rebuild requires explicit R2 credentials')
    remote = f's3://{bucket}/{prefix}/{key}'
    command = ['aws','s3','cp',str(local) if upload else remote,
               remote if upload else str(local),'--endpoint-url',endpoint,'--only-show-errors']
    result = subprocess.run(command, cwd=ROOT)
    if result.returncode and not optional:
        raise ValueError(f'R2 checkpoint failed: {key}')
    return result.returncode == 0


def source(source_pin):
    """Persist exact compressed bytes before starting any expensive computation."""
    from import_all_trophies import archive
    path = SOURCES/f'{source_pin["sha256"]}.csv.gz'
    path.parent.mkdir(parents=True, exist_ok=True)
    key = f'sources/{source_pin["sha256"]}.csv.gz'
    # The v5 rebuild retained most of these exact objects; they are re-verified below.
    for prefix in ('v6-build', 'v5-build'):
        if not path.exists():
            r2(path, key, optional=True, prefix=prefix)
    if path.exists() and (sha(path) != source_pin['sha256'] or
            path.stat().st_size != source_pin['compressed_bytes']):
        path.unlink()
    if not path.exists():
        actual = archive(source_pin['url'], path)
        if actual != source_pin:
            raise ValueError(f'Archive no longer matches authorized pin: {source_pin["url"]}')
    if sha(path) != source_pin['sha256']:
        raise ValueError('Source byte verification failed')
    r2(path, key, upload=True)
    return path


def copy_source(pin, destination):
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SOURCES/f'{pin["sha256"]}.csv.gz', destination)
    return email.utils.parsedate_to_datetime(pin['last_modified']).date().isoformat()


def phase_files(directory):
    return {str(p.relative_to(directory)):sha(p) for p in sorted(directory.rglob('*'))
            if p.is_file() and p.name != 'checkpoint.json'}


def restore(directory, key, build_id):
    bundle = BUILD/f'{key.replace("/", "-")}.tgz'
    if not r2(bundle, f'{build_id}/{key}.tgz', optional=True):
        return False
    directory.mkdir(parents=True, exist_ok=True)
    with tarfile.open(bundle) as archive:
        archive.extractall(directory, filter='data')
    checkpoint = read(directory/'checkpoint.json')
    if checkpoint != {'identity':build_id,'files':phase_files(directory)}:
        raise ValueError(f'Corrupt or stale checkpoint: {key}')
    return True


def checkpoint(directory, key, build_id):
    write(directory/'checkpoint.json', {'identity':build_id,'files':phase_files(directory)})
    bundle = BUILD/f'{key.replace("/", "-")}.tgz'
    with tarfile.open(bundle,'w:gz') as archive:
        for p in sorted(directory.iterdir()):
            archive.add(p, arcname=p.name)
    r2(bundle, f'{build_id}/{key}.tgz', upload=True)


def frozen_source(pin):
    """Serve only the exact pinned bytes to builders that would download."""
    def chosen(url):
        return pin['skill_source'] if '/game_data/' in url else pin['source_archive']
    return chosen


def replay(sid, pin, directory):
    directory.mkdir(parents=True, exist_ok=True)
    import import_sets as regular
    import backfill_legacy_sets as legacy
    import import_powered_cube as cube
    import build_powered_cube_v3 as measured_cube
    chosen = frozen_source(pin)
    date = email.utils.parsedate_to_datetime(pin['source_archive']['last_modified']).date().isoformat()
    common = ['--model-version',V6_MODEL,'--max-output-drafts','300',
        '--minimum-replays','100','--minimum-picks','30','--folds','5','--shard-size','2']
    with ExitStack() as stack:
        stack.enter_context(patch.object(regular,'download_dataset',
            side_effect=lambda remote,dest:copy_source(chosen(remote.url),dest)))
        stack.enter_context(patch.object(regular,'download_game_archive',
            side_effect=lambda code,fmt,dest:copy_source(pin['skill_source'],dest)))
        stack.enter_context(patch.object(legacy,'download_dataset',
            side_effect=lambda remote,dest:copy_source(chosen(remote.url),dest)))
        stack.enter_context(patch.object(cube,'download_archive',
            side_effect=lambda dest:copy_source(pin['source_archive'],dest)))
        stack.enter_context(patch.object(cube,'download_game_archive',
            side_effect=lambda dest:copy_source(pin['skill_source'],dest)))
        if sid == 'powered-cube':
            measured_cube.main(['--model-version',V6_MODEL,'--shard-size','2',
                '--max-output-candidates','1200','--target-replays','300',
                '--minimum-replays','100','--minimum-first-visible-candidates','14',
                '--max-path-bytes','8000000'])
        else:
            remote = regular.RemoteDataset(sid.upper(),'PremierDraft','',date,pin['source_archive']['url'])
            regular.build_one(remote,regular.parse_args(common+['--max-path-bytes','4000000']))
    manifest = read(ROOT/'data'/sid/'manifest.json')
    validate_training_manifest(manifest, V6_MODEL)
    manifest['v6_source_provenance'] = {k:pin[k] for k in ('source_archive','skill_source')}
    manifest['build_identity'] = os.environ['V6_BUILD_ID']
    write(ROOT/'data'/sid/'manifest.json',manifest)
    # Re-read the selected replays' trophy and trajectory proof from exact pinned bytes.
    import extract_trophy_evidence as evidence
    from import_all_trophies import csv_bytes
    def frozen_stream(url,wanted,consume):
        selected = chosen(url)
        if url != selected['url']:
            raise ValueError('Unexpected evidence source URL')
        matched,count = set(),0
        with csv_bytes(SOURCES/f'{selected["sha256"]}.csv.gz') as handle:
            header=next(csv.reader([handle.readline().decode('utf-8-sig')]))
            draft_col=header.index('draft_id')
            for line in handle:
                if not line.strip():
                    continue
                count+=1
                prefix=line.split(b',',draft_col+1)
                if len(prefix)<=draft_col or prefix[draft_col].decode().strip('"') not in wanted:
                    continue
                row=dict(zip(header,next(csv.reader([line.decode()]))))
                if row['draft_id'] not in wanted:
                    raise ValueError('Unexpected pinned CSV identity layout')
                matched.add(row['draft_id']);consume(row)
        return {**selected,'rows_scanned':count,'matched_replays':len(matched)}
    with patch.object(evidence,'stream',side_effect=frozen_stream):
        evidence.extract(sid,refresh=True)
    shutil.copyfile(ROOT/'corpus/draft-run/evidence'/f'{sid}.json.gz',directory/'evidence.json.gz')
    shutil.copytree(ROOT/'data'/sid,directory/'data',dirs_exist_ok=True)
    entry = next(row for row in read(ROOT/'data/catalog.json')['sets'] if row['id']==sid)
    write(directory/'catalog-entry.json',entry)


def traditional_pin(sid):
    return next((p for p in read(TRADITIONAL_PINS)['sets'] if p['set_id']==sid), None)


def environment(sid):
    build_id = os.environ.get('V6_BUILD_ID')
    if not build_id or len(build_id) != 64:
        raise ValueError('Missing reviewed build identity')
    all_pins = pins()
    if sid not in all_pins:
        raise ValueError('Expected one of the 31 pinned production environments')
    pin = all_pins[sid]
    destination = BUILD/sid
    destination.mkdir(parents=True,exist_ok=True)
    if corpus_version() != V6_CORPUS:
        set_corpus_version(V6_CORPUS)
    source(pin['source_archive']); source(pin['skill_source'])
    replay_dir = destination/'replay'
    replay_training = None
    if pin['replay']:
        if not restore(replay_dir,f'{sid}/replay',build_id):
            replay(sid,pin,replay_dir)
            checkpoint(replay_dir,f'{sid}/replay',build_id)
        else:
            shutil.copytree(replay_dir/'data',ROOT/'data'/sid,dirs_exist_ok=True)
        replay_training = read(replay_dir/'data/manifest.json')
        validate_training_manifest(replay_training, V6_MODEL)
        replay_training = replay_training['cohort']
    # Import only after declaring the distinct v10 identity; no v5 probability is reused.
    import import_all_trophies as trophies
    if trophies.VERSION != V6_CORPUS or trophies.CONTEXT_MODEL_VERSION != V6_MODEL:
        raise ValueError('Importer has stale model identity')
    trophy_dir = destination/'trophies'
    if not restore(trophy_dir,f'{sid}/trophies',build_id):
        chosen = frozen_source(pin)
        def frozen_archive(url,path,refresh=False):
            selected = chosen(url)
            if url != selected['url']:
                raise ValueError('Unexpected archive substitution')
            copy_source(selected,path)
            return dict(selected)
        with patch.object(trophies,'archive',side_effect=frozen_archive):
            trophies.build_set(sid,trophy_dir,discovered_expansion='Cube_-_Powered' if sid=='powered-cube' else sid.upper(),source_pin=pin)
        # Raw archives are retained content-addressed in R2; keep output bundles compact.
        for raw in (trophy_dir/sid).glob('*.csv.gz'):
            raw.unlink()
        checkpoint(trophy_dir,f'{sid}/trophies',build_id)
    info = read(trophy_dir/sid/'manifest.json')
    validate_training_manifest(info, V6_MODEL)
    trophies.verify_source_pin(sid,info['source_archive'],info['skill_source'],pin)
    if info['training_drafts'] != pin['training_drafts'] or info['qualified_trophies'] != pin['qualified_trophies']:
        raise ValueError(f'{sid}: unchanged v9 inputs produced a different cohort')
    component_pin = traditional_pin(sid)
    if component_pin:
        traditional_dir = destination/'traditional'
        source(component_pin['source_archive'])
        if not restore(traditional_dir,f'{sid}/traditional',build_id):
            from v6_traditional import rescore
            rescore(sid,info,component_pin,traditional_dir)
            checkpoint(traditional_dir,f'{sid}/traditional',build_id)
    write(destination/'summary.json',{'id':sid,'build_identity':build_id,
        'source_status':pin['status'],'full_import':info,'replay_training':replay_training})
    print(json.dumps({'set':sid,'complete':True,'qualified':info['qualified_training_drafts'],
        'trained':info['training_drafts'],'puzzles':info['total_puzzles']}),flush=True)


def assemble():
    all_pins = pins()
    registry = read(ROOT/'data/catalog.json')
    if {p for p in all_pins if all_pins[p]['replay']} != {row['id'] for row in registry['sets']}:
        raise ValueError('Replay environments differ from the served catalog')
    summaries = []
    output = ROOT/'generated/v6-trophy-import'
    build_id = os.environ['V6_BUILD_ID']
    from import_all_trophies import verify_source_pin
    for sid, pin in all_pins.items():
        directory = BUILD/sid
        summary = read(directory/'summary.json')
        if summary['build_identity'] != build_id:
            raise ValueError(f'{sid}: stale environment')
        for phase in ('replay','trophies') if pin['replay'] else ('trophies',):
            checkpoint_data = read(directory/phase/'checkpoint.json')
            if checkpoint_data != {'identity':build_id,'files':phase_files(directory/phase)}:
                raise ValueError(f'{sid}/{phase}: file-integrity check failed')
        info = summary['full_import']
        validate_training_manifest(info, V6_MODEL)
        verify_source_pin(sid,info['source_archive'],info['skill_source'],pin)
        if pin['replay']:
            shutil.copytree(directory/'replay/data',ROOT/'data'/sid,dirs_exist_ok=True)
            shutil.copyfile(directory/'replay/evidence.json.gz',ROOT/'corpus/draft-run/evidence'/f'{sid}.json.gz')
            entry = read(directory/'replay/catalog-entry.json')
            registry['sets'] = [entry if row['id']==sid else row for row in registry['sets']]
        shutil.copytree(directory/'trophies'/sid,output/sid,dirs_exist_ok=True)
        summaries.append(info)
    write(ROOT/'data/catalog.json',registry)
    write(output/'catalog.json',{'import_version':'all-premier-trophies-v1',
        'corpus_version':V6_CORPUS,'requested_sets':sorted(all_pins),
        'sets':sorted(summaries,key=lambda x:x['id']),'errors':{},'complete':True})
    if corpus_version()!=V6_CORPUS:
        set_corpus_version(V6_CORPUS)
    run(sys.executable,'scripts/build_verified_trophy_corpus.py')
    from v6_traditional import consolidate
    consolidate(BUILD, ROOT/'generated/v6-traditional')
    write(ROOT/'generated/v6-rebuild-accounting.json',{
        'model_version':V6_MODEL,'corpus_version':V6_CORPUS,'build_identity':build_id,
        'environments':ENVIRONMENTS,'replay_environments':REPLAY_ENVIRONMENTS,
        'total_qualified':sum(p['qualified_training_drafts'] for p in summaries),
        'total_trained':sum(p['training_drafts'] for p in summaries),
        'sets':[{k:p[k] for k in ('id','qualified_drafts','qualified_training_drafts',
            'training_drafts','training_picks','training_mode','training_cap',
            'source_archive','skill_source','input_signature','source_snapshot_id','holdout')}
            for p in sorted(summaries,key=lambda x:x['id'])]})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['identity','environment','assemble'])
    parser.add_argument('--set')
    args = parser.parse_args()
    if args.action=='identity':
        print(identity())
    elif args.action=='environment':
        environment(args.set)
    else:
        assemble()
