#!/usr/bin/env python3
"""Build whole-Cube Scryfall rules metadata for OFFLINE research only.

This is a one-time public-metadata acquisition step. Its checksum-pinned output
can be used offline; the scoring experiment never calls Scryfall.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import time
from urllib.request import Request, urlopen

from build_rules_context_metadata import FIELDS, encode
from fetch_card_metadata import USER_AGENT, aliases
from offline_context_model import read_json_or_jsonl

COLLECTION_URL = 'https://api.scryfall.com/cards/collection'
BATCH = 75


def corpus_names(path):
    names = set()
    for puzzle in read_json_or_jsonl(path):
        for card in (puzzle.get('candidates') or []) + (puzzle.get('prior_picks') or []):
            if isinstance(card, dict) and isinstance(card.get('name'), str) and card['name']:
                names.add(card['name'])
    return sorted(names)


def fetch_batch(names, opener=urlopen):
    if len(names) > BATCH:
        raise ValueError('Scryfall maximum collection request is 75 identifiers')
    data = json.dumps({'identifiers': [{'name': name} for name in names]}).encode('utf-8')
    request = Request(COLLECTION_URL, data=data, method='POST',
                      headers={'User-Agent': USER_AGENT, 'Accept': 'application/json',
                               'Content-Type': 'application/json'})
    with opener(request, timeout=45) as response:
        result = json.load(response)
    if not isinstance(result.get('data'), list):
        raise ValueError('Invalid Scryfall collection response')
    return result['data']


def resolve_records(names, fetcher=fetch_batch):
    """Map cards by explicit original 17Lands names, not fuzzy guesses."""
    records = {}
    for start in range(0, len(names), BATCH):
        chunk = names[start:start+BATCH]
        wanted = set(chunk)
        for card in fetcher(chunk):
            available = set(aliases(card)) | {card.get('name')}
            for name in wanted & available:
                records[name] = {key: card[key] for key in FIELDS if key in card}
        if start + BATCH < len(names):
            time.sleep(0.2)
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True, help='Frozen public Cube corpus')
    parser.add_argument('--output', type=Path, required=True, help='Compressed canonical rules metadata')
    parser.add_argument('--min-coverage', type=float, default=.95)
    args = parser.parse_args()
    names = corpus_names(args.input)
    if not names:
        parser.error('No card names in corpus')
    records = resolve_records(names)
    coverage = len(records) / len(names)
    if coverage < args.min_coverage:
        parser.error(f'Insufficient Scryfall coverage: {len(records)}/{len(names)}')
    blob = encode(records)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(blob)
    print(f'Public Cube rules: {len(records)}/{len(names)} known cards; '
          f'sha256 {hashlib.sha256(blob).hexdigest()}; missing {len(names)-len(records)}')


if __name__ == '__main__':
    main()
