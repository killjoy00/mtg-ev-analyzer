#!/usr/bin/env python3
"""Restore existing v6 source archives for offline pool-aware research.

Read-only R2 access, no upstream download, upload, corpus or workflow mutation.
Uses the existing v6 pins and runner R2 credentials. Source bytes are checked
before a research manifest can be written. Dates must be chosen separately.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PINS = ROOT / 'research/v6-build-source-pins.json'
PREFIXES = ('v6-build', 'v5-build')


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()


def verified(path, pin):
    return (path.is_file() and path.stat().st_size == pin['compressed_bytes']
            and sha256(path) == pin['sha256'])


def restore(pin, directory, *, fetch=None):
    """Reuse a verified local copy or recover exact bytes using read-only GET."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    digest = pin['sha256']
    if len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
        raise ValueError('invalid source digest')
    destination = directory / (digest + '.csv.gz')
    if verified(destination, pin):
        return destination, 'local'
    if fetch is None:
        endpoint, bucket = os.environ.get('R2_ENDPOINT'), os.environ.get('R2_BUCKET')
        if not endpoint or not bucket:
            raise RuntimeError('existing runner R2_ENDPOINT/R2_BUCKET required')

        def fetch(key, path):
            return subprocess.run(['aws', 's3', 'cp', 's3://'+bucket+'/'+key,
                                   str(path), '--endpoint-url', endpoint,
                                   '--only-show-errors', '--no-progress'],
                                  check=False).returncode == 0

    with tempfile.TemporaryDirectory(dir=directory) as tmp:
        candidate = Path(tmp) / 'source.csv.gz'
        for prefix in PREFIXES:
            candidate.unlink(missing_ok=True)
            key = f'{prefix}/sources/{digest}.csv.gz'
            if fetch(key, candidate) and verified(candidate, pin):
                candidate.replace(destination)
                return destination, prefix
    raise RuntimeError('retained R2 source unavailable or checksum mismatch; no download fallback')


def time_extent(path, column):
    """Aggregate archive timestamp range only; no draft choices or game outcomes."""
    with gzip.open(path, 'rt', encoding='utf8', newline='') as f:
        reader = csv.reader(f)
        header = next(reader)
        at = header.index(column)
        lo = hi = None
        count = 0
        missing = 0
        for row in reader:
            if len(row) != len(header):
                raise ValueError('malformed archive row')
            raw = row[at]
            if not raw:
                missing += 1
                continue
            from pool_aware_archive import time_utc
            dt = time_utc(raw)
            lo = dt if lo is None else min(lo, dt)
            hi = dt if hi is None else max(hi, dt)
            count += 1
    if not count:
        raise ValueError('archive has no usable timestamps')
    return {'first_utc':lo.isoformat(), 'last_utc':hi.isoformat(),
            'rows_with_time':count, 'rows_without_time':missing}


def prepare(set_id, directory, metadata, windows=None, interactions=None, inspect=False, purge_days=7):
    pins = json.loads(PINS.read_text(encoding='utf8'))['sets']
    row = next((s for s in pins if s['id'] == set_id), None)
    if row is None:
        raise ValueError('unknown v6 environment')
    if not metadata.is_file():
        raise ValueError('pinned rules metadata required')
    sources = {}
    origins = {}
    for name, pin in [('draft',row['source_archive']),('games',row['skill_source'])]:
        path, origin = restore(pin,directory)
        sources[name] = {'path':str(path.resolve()),'origin':pin['url'],'sha256':pin['sha256']}
        origins[name] = origin
    report = {'set':set_id,'sources':{name:{'sha256':entry['sha256'],
              'restored_from':origins[name]} for name,entry in sources.items()}}
    if inspect:
        report['time_ranges'] = {
            name:time_extent(Path(sources[name]['path']), column)
            for name,column in [('draft','draft_time'),('games','game_time')]}
    if windows is not None:
        if interactions is None:
            interactions = directory/'empty-interactions.json'
            if not interactions.exists():
                interactions.write_text('{"schema":1,"edges":[]}\n',encoding='utf8')
            if json.loads(interactions.read_text()) != {'schema':1,'edges':[]}:
                raise ValueError('unexpected nonempty default registry')
        sources['metadata'] = {'path':str(metadata.resolve()),
            'origin':'pinned repository rules metadata','sha256':sha256(metadata)}
        sources['interactions'] = {'path':str(interactions.resolve()),
            'origin':'provided rules-review registry' if interactions.name != 'empty-interactions.json' else 'empty registry; synergy inactive',
            'sha256':sha256(interactions)}
        manifest = {'schema':1,'set':set_id,'mode':'PremierDraft',
                    'windows':json.loads(windows.read_text(encoding='utf8')),
                    'purge_days':purge_days,
                    'sources':sources}
        path = directory/'manifest.json'
        # Reuse the existing manifest's chronological and checksum guards.
        from pool_aware_archive import load_manifest
        with tempfile.TemporaryDirectory(dir=directory) as temp:
            trial = Path(temp)/'manifest.json'
            trial.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
            load_manifest(trial)
            trial.replace(path)
        report['manifest'] = str(path)
    return report


def self_test():
    data = b'synthetic compressed source placeholder'
    pin = {'sha256':hashlib.sha256(data).hexdigest(),'compressed_bytes':len(data)}
    calls = []
    def fake(key,path):
        calls.append(key)
        path.write_bytes(data if key.startswith('v5-build/') else b'invalid')
        return True
    with tempfile.TemporaryDirectory() as tmp:
        path, origin = restore(pin,tmp,fetch=fake)
        assert origin == 'v5-build' and verified(path,pin) and len(calls)==2
        again, origin = restore(pin,tmp,fetch=fake)
        assert again == path and origin == 'local' and len(calls)==2
        path.write_bytes(b'bad')
        try:
            restore(pin,tmp,fetch=lambda key,path:False)
        except RuntimeError:
            pass
        else:
            raise AssertionError('accepted unverifiable archive')
        assert not verified(path,pin)
    print('Synthetic restore contracts passed; no remote write or download.')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--self-test',action='store_true')
    p.add_argument('--set')
    p.add_argument('--metadata',type=Path)
    p.add_argument('--windows',type=Path)
    p.add_argument('--interactions',type=Path)
    p.add_argument('--purge-days',type=int,choices=(0,7),default=7)
    p.add_argument('--inspect-times',action='store_true')
    a=p.parse_args()
    if a.self_test:
        self_test()
        return
    if not a.set or not a.metadata:
        p.error('--set and --metadata required')
    if a.set not in {row['id'] for row in json.loads(PINS.read_text())['sets']}:
        p.error('unknown pinned environment')
    directory=ROOT/'raw-data'/'pool-refit'/a.set
    report=prepare(a.set,directory,a.metadata,a.windows,a.interactions,a.inspect_times,a.purge_days)
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    main()
