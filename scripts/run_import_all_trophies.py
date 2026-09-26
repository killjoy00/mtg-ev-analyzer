#!/usr/bin/env python3
"""Run the full trophy importer with retryable I/O and serializable worker results.

Completed sets are checkpointed independently of their disposable raw archives.
A time budget stops new work early enough to save those checkpoints before the
CI job limit. Worker exceptions are converted to plain strings before crossing the
ProcessPool boundary, avoiding multiprocessing failures from exceptions (such
as urllib HTTPError) that retain unpickleable response streams.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor, wait, FIRST_COMPLETED
import json
from pathlib import Path
import time
import urllib.error

import import_all_trophies as importer
from corpus_promotion_provenance import builder_metadata


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


def run_set_safely(sid, output_dir, refresh, expansion, discard_source_archives=False):
    """Return only pickle-safe data from a worker, including on failure."""
    importer.request = resilient_request
    try:
        return {'ok': True, 'result': importer.build_set(sid, output_dir, refresh, expansion)}
    except Exception as exc:
        return {'ok': False, 'error': _error_text(exc)}
    finally:
        if discard_source_archives:
            # Keep manifests, source hashes, ledgers and puzzles. Raw public
            # objects can be downloaded again if an input signature changes.
            for name in ['draft.csv.gz', 'games.csv.gz', 'draft.csv.gz.part', 'games.csv.gz.part']:
                (Path(output_dir)/sid/name).unlink(missing_ok=True)


def run_jobs(executor, ids, sources, args, started):
    """Bound both active work and queued work so a CI timeout is resumable."""
    waiting = list(ids)
    running = {}
    results, errors = [], {}
    while waiting or running:
        while waiting and len(running) < args.workers:
            if args.max_seconds and time.monotonic() - started >= args.max_seconds:
                break
            sid = waiting.pop(0)
            future = executor.submit(run_set_safely, sid, args.output, args.refresh,
                                     sources[sid], args.discard_source_archives)
            running[future] = sid
        if not running:
            errors.update({sid: 'Time budget reached; rerun to resume this environment' for sid in waiting})
            break
        finished, _ = wait(running, return_when=FIRST_COMPLETED)
        for future in finished:
            sid = running.pop(future)
            try:
                outcome = future.result()
            except Exception as exc:
                outcome = {'ok': False, 'error': _error_text(exc)}
            if outcome['ok']:
                results.append(outcome['result'])
            else:
                errors[sid] = outcome['error']
                print(json.dumps({'set': sid, 'error': errors[sid]}), flush=True)
    return results, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sets', default='all')
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--output', default='generated/trophy-import')
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--max-seconds', type=int, default=0,
                        help='stop scheduling new environments after this build budget; 0 is unlimited')
    parser.add_argument('--discard-source-archives', action='store_true',
                        help='retain verified checkpoints but remove disposable source downloads')
    args = parser.parse_args()
    if args.workers < 1 or args.max_seconds < 0:
        parser.error('workers must be positive and max-seconds nonnegative')
    started = time.monotonic()
    if args.discard_source_archives:
        # Older caches may contain every source download. Bound disk usage
        # before starting any workers, including after a cancelled prior run.
        for name in ['draft.csv.gz', 'games.csv.gz', 'draft.csv.gz.part', 'games.csv.gz.part']:
            for archive in Path(args.output).glob('*/'+name):
                archive.unlink()

    # Discovery gets the same bounded retry behavior as per-environment work.
    importer.request = resilient_request
    sources, discovery = importer.discover()
    importer.atomic_json(Path(args.output) / 'discovery.json', discovery)
    ids = list(sources) if args.sets == 'all' else args.sets.split(',')
    if any(sid not in sources for sid in ids):
        raise ValueError('Requested set has no official Premier archive')
    ids = list(dict.fromkeys(ids))

    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        results, errors = run_jobs(executor, ids, sources, args, started)

    report = {
        'import_version': importer.IMPORT_VERSION,
        'corpus_version': importer.VERSION,
        'builder': builder_metadata(),
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
