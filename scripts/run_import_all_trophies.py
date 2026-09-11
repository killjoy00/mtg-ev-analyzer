#!/usr/bin/env python3
"""Run the full trophy importer with retryable I/O and serializable worker results.

This runner deliberately leaves import_all_trophies.py unchanged so successful
all-premier-trophies-v1 checkpoints keep the exact input signature that produced
them. Worker exceptions are converted to plain strings before crossing the
ProcessPool boundary, avoiding multiprocessing failures from exceptions (such
as urllib HTTPError) that retain unpickleable response streams.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import json
from pathlib import Path
import time
import urllib.error

import import_all_trophies as importer


_TRANSIENT_HTTP = {408, 425, 429, 500, 502, 503, 504}
_RAW_REQUEST = importer.request


def _error_text(exc):
    try:
        message = str(exc)
    except Exception:
        message = '<unprintable exception>'
    return f'{type(exc).__name__}: {message}'


def resilient_request(url, method='GET'):
    """Retry transient source failures without changing caller-visible 4xx semantics."""
    for attempt in range(4):
        try:
            return _RAW_REQUEST(url, method)
        except urllib.error.HTTPError as exc:
            code = exc.code
            reason = str(getattr(exc, 'reason', '') or '')
            retry_after = exc.headers.get('Retry-After') if exc.headers else None
            try:
                exc.close()
            except Exception:
                pass
            if code not in _TRANSIENT_HTTP:
                # resolve_images intentionally treats an exact Scryfall 404 as an
                # unresolved image rather than a fatal import. Preserve that API.
                raise
            if attempt == 3:
                raise RuntimeError(f'HTTP {code} for {url}: {reason}') from None
            try:
                delay = float(retry_after) if retry_after is not None else 2 ** attempt
            except (TypeError, ValueError):
                delay = 2 ** attempt
            time.sleep(max(1, min(delay, 30)))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            if attempt == 3:
                raise RuntimeError(f'I/O request failed for {url}: {_error_text(exc)}') from None
            time.sleep(2 ** attempt)


def run_set_safely(sid, output_dir, refresh, expansion):
    """Return only pickle-safe data from a worker, including on failure."""
    importer.request = resilient_request
    try:
        return {'ok': True, 'result': importer.build_set(sid, output_dir, refresh, expansion)}
    except Exception as exc:
        return {'ok': False, 'error': _error_text(exc)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sets', default='all')
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--output', default='generated/trophy-import')
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()

    # Discovery gets the same bounded retry behavior as per-environment work.
    importer.request = resilient_request
    sources, discovery = importer.discover()
    importer.atomic_json(Path(args.output) / 'discovery.json', discovery)
    ids = list(sources) if args.sets == 'all' else args.sets.split(',')
    if any(sid not in sources for sid in ids):
        raise ValueError('Requested set has no official Premier archive')
    ids = list(dict.fromkeys(ids))

    results = []
    errors = {}
    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        jobs = {
            executor.submit(run_set_safely, sid, args.output, args.refresh, sources[sid]): sid
            for sid in ids
        }
        for future in as_completed(jobs):
            sid = jobs[future]
            try:
                outcome = future.result()
            except Exception as exc:
                # Process startup/termination failures are uncommon, but keep the
                # catalog actionable instead of losing all successful checkpoints.
                errors[sid] = _error_text(exc)
                print(json.dumps({'set': sid, 'error': errors[sid]}), flush=True)
                continue
            if outcome['ok']:
                results.append(outcome['result'])
            else:
                errors[sid] = outcome['error']
                print(json.dumps({'set': sid, 'error': outcome['error']}), flush=True)

    report = {
        'import_version': importer.IMPORT_VERSION,
        'corpus_version': importer.VERSION,
        'requested_sets': ids,
        'sets': sorted(results, key=lambda s: s['id']),
        'errors': errors,
        'complete': not errors and len(results) == len(ids),
    }
    importer.atomic_json(Path(args.output) / 'catalog.json', report)
    if errors:
        raise SystemExit('Import incomplete; successful sets checkpointed. See catalog.json.')


if __name__ == '__main__':
    main()
