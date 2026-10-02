#!/usr/bin/env python3
"""Check availability of the authorized candidate sources without refreshing pins.

HEAD is an availability check, not SHA-256 verification. Every actual build must
also compare the downloaded bytes against the retained production SHA-256.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PINS = ROOT / 'research/v5-build-source-pins.json'


def probe(item):
    sid, kind, pin = item
    result = {'id': sid, 'kind': kind, 'pinned': pin}
    try:
        request = urllib.request.Request(pin['url'], method='HEAD')
        with urllib.request.urlopen(request, timeout=45) as response:
            actual = {'etag': response.headers.get('ETag'),
                      'last_modified': response.headers.get('Last-Modified'),
                      'compressed_bytes': int(response.headers.get('Content-Length', '0'))}
        result.update(actual=actual, metadata_matches=all(
            actual[field] == pin[field] for field in actual))
    except Exception as exc:
        result.update(metadata_matches=False, error=f'{type(exc).__name__}: {exc}')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='generated/v5-source-availability.json')
    parser.add_argument('--report-only', action='store_true')
    args = parser.parse_args()
    pins = json.loads(PINS.read_text())
    if len(pins['sets']) != 32 or len({row['id'] for row in pins['sets']}) != 32:
        raise ValueError('Expected exactly the 32 production environments')
    items = [(row['id'], kind, row[kind]) for row in pins['sets']
             for kind in ('source_archive', 'skill_source')]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(probe, items))
    report = {'baseline_commit': pins['baseline_commit'], 'objects': results,
              'complete': all(row['metadata_matches'] for row in results)}
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2) + '\n')
    changed = [(row['id'], row['kind']) for row in results if not row['metadata_matches']]
    print(json.dumps({'objects': len(results), 'metadata_matches': len(results)-len(changed),
                      'unavailable_pins': changed}))
    if changed and not args.report_only:
        raise SystemExit('Candidate source objects changed; record new exact candidate pins before rebuilding.')


if __name__ == '__main__':
    main()
