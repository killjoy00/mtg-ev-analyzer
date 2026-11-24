#!/usr/bin/env python3
"""Fetch only the reviewed, pinned public 17Lands FRA inputs and return aggregates.
No credentials, private player data, or individual draft records are read.
The scheduler invokes this on reviewed main, caches only the aggregate in its
private database and never prints the aggregate or subprocess diagnostics.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request
from pack_one_lab_picks import ROOT, PINS, build_report, private_output

URLS = {
    'draft': 'https://17lands-public.s3.amazonaws.com/analysis_data/draft_data/draft_data_public.FRA.PremierDraft.csv.gz',
    'game': 'https://17lands-public.s3.amazonaws.com/analysis_data/game_data/game_data_public.FRA.PremierDraft.csv.gz',
}
MAX_COMPRESSED_BYTES = 500 * 1024 * 1024

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('lab-source-redirect')

def fetch_pinned(kind, destination, opener=None):
    url = URLS[kind]
    opener = opener or urllib.request.build_opener(NoRedirect())
    h = hashlib.sha256()
    size = 0
    request = urllib.request.Request(url, headers={'User-Agent': 'PackOneLab/1.0'})
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

def authorized_actions():
    return (os.getenv('GITHUB_REF') == 'refs/heads/main'
            and os.getenv('GITHUB_REPOSITORY') == 'killjoy00/mtg-ev-analyzer'
            and os.getenv('PACK1_LAB_REVIEW_ENABLED') == 'true'
            and os.getenv('GITHUB_WORKFLOW') == 'Pack One Lab private editorial review')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,required=True)
    args = parser.parse_args()
    if os.getenv('GITHUB_ACTIONS') and not authorized_actions():
        raise ValueError('lab-untrusted-ref')
    output = private_output(args.out)
    meta = ROOT / 'research/data/fra-rules-context-2026-10-29.json.gz'
    with tempfile.TemporaryDirectory(prefix='pack-one-lab-public-archives-') as temp:
        draft,game = Path(temp)/'draft.csv.gz',Path(temp)/'game.csv.gz'
        fetch_pinned('draft',draft)
        fetch_pinned('game',game)
        result = build_report(draft,game,meta)
    fd = os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as handle:
        json.dump(result,handle,separators=(',',':'));handle.write('\n')
    print('Lab: pinned public source research completed.')

if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Lab archive preparation stopped; verify private paths and source checksums.')
