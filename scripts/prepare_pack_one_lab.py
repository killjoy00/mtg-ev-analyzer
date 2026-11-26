#!/usr/bin/env python3
"""Fetch reviewed, pinned public 17Lands FRA inputs and return aggregates.
Never reads credentials, account data or private player data. Diagnostics
are fixed reason codes, not exception messages, source rows or paths.
"""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import tempfile
import time
import urllib.error
import urllib.request
from pack_one_lab_picks import ROOT, PINS, build_report, private_output, checked

URLS = {
    'draft': 'https://17lands-public.s3.amazonaws.com/analysis_data/draft_data/draft_data_public.FRA.PremierDraft.csv.gz',
    'game': 'https://17lands-public.s3.amazonaws.com/analysis_data/game_data/game_data_public.FRA.PremierDraft.csv.gz',
}
MAX_COMPRESSED_BYTES = 500 * 1024 * 1024
# Reviewed source identities from research/v6-build-source-pins.json.
SOURCE_BYTES = {'draft': 86041756, 'game': 24570968}
USER_AGENT = 'PackOne-Trophy-Import/2.0 (https://github.com/killjoy00/mtg-ev-analyzer)'
RETRY_HTTP = {408, 429, 500, 502, 503, 504}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('lab-source-redirect')

class SourceFailure(ValueError):
    def __init__(self, code, retryable=False):
        super().__init__(code)
        self.retryable = retryable

def fetch_pinned(kind, destination, opener=None):
    url = URLS[kind]
    opener = opener or urllib.request.build_opener(NoRedirect())
    h = hashlib.sha256()
    size = 0
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with opener.open(request, timeout=60) as source, open(destination, 'xb') as target:
        if source.geturl() != url:
            raise ValueError('lab-source-redirect')
        while True:
            chunk = source.read(1024*1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_COMPRESSED_BYTES:
                raise ValueError('lab-source-too-large')
            h.update(chunk)
            target.write(chunk)
    if h.hexdigest() != PINS[kind]:
        raise ValueError('lab-source-hash-mismatch')

def fetch_with_retry(kind, destination, *, fetch=fetch_pinned, sleep=time.sleep):
    # A changed/missing archive is not an invitation to silently accept new data.
    # Only transient transport/server errors are retried, with new partial files.
    for attempt in range(3):
        try:
            fetch(kind,destination)
            if destination.stat().st_size != SOURCE_BYTES[kind]:
                raise SourceFailure('lab-source-size-mismatch')
            return
        except urllib.error.HTTPError as error:
            failure=SourceFailure('lab-source-http-'+str(error.code) if 100<=error.code<=599 else 'lab-source-http',error.code in RETRY_HTTP)
        except (urllib.error.URLError,TimeoutError,ConnectionError,http.client.IncompleteRead):
            failure=SourceFailure('lab-source-transport',True)
        except SourceFailure:
            raise
        except ValueError as error:
            known={'lab-source-hash-mismatch','lab-source-redirect','lab-source-too-large'}
            raise SourceFailure(str(error) if str(error) in known else 'lab-source-validation') from None
        destination.unlink(missing_ok=True)
        if not failure.retryable or attempt==2:
            raise failure from None
        sleep(2**attempt)

def authorized_actions():
    return (os.getenv('GITHUB_REF') == 'refs/heads/main'
            and os.getenv('GITHUB_REPOSITORY') == 'killjoy00/mtg-ev-analyzer'
            and os.getenv('PACK1_LAB_REVIEW_ENABLED') == 'true'
            and os.getenv('GITHUB_WORKFLOW') == 'Pack One Lab private editorial review')

def authorized_validation():
    return (os.getenv('GITHUB_EVENT_NAME') == 'pull_request'
            and os.getenv('GITHUB_REPOSITORY') == 'killjoy00/mtg-ev-analyzer'
            and os.getenv('GITHUB_WORKFLOW') == 'Pack One Lab archive validation')

def prepare(args):
    if os.getenv('GITHUB_ACTIONS') and not (authorized_validation() if args.verify_only else authorized_actions()):
        raise SourceFailure('lab-untrusted-ref')
    try:
        output = private_output(args.out)
    except (OSError,ValueError):
        raise SourceFailure('lab-private-output-required') from None
    meta = ROOT / 'research/data/fra-rules-context-2026-10-29.json.gz'
    try:
        checked(meta,PINS['metadata'])
    except (OSError,ValueError):
        raise SourceFailure('lab-metadata-unavailable-or-hash-mismatch') from None
    with tempfile.TemporaryDirectory(prefix='pack-one-lab-public-archives-') as temp:
        draft,game = Path(temp)/'draft.csv.gz',Path(temp)/'game.csv.gz'
        for kind,destination in [('draft',draft),('game',game)]:
            try:
                fetch_with_retry(kind,destination)
            except SourceFailure as error:
                raise SourceFailure('lab-'+kind+'-'+str(error).removeprefix('lab-')) from None
        try:
            result = build_report(draft,game,meta)
        except Exception:
            raise SourceFailure('lab-archive-analysis-contract') from None
    fd = os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as handle:
        json.dump(result,handle,separators=(',',':'));handle.write('\n')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--verify-only',action='store_true',help='Public-source validation only, never a production review run')
    args = parser.parse_args()
    prepare(args)
    print('Lab: pinned public source research completed.')

if __name__ == '__main__':
    try:
        main()
    except SourceFailure as error:
        # All SourceFailure values are generated by this module from known codes.
        raise SystemExit('Lab archive preparation stopped: '+str(error)) from None
    except Exception:
        raise SystemExit('Lab archive preparation stopped: lab-unexpected-runtime-error') from None
