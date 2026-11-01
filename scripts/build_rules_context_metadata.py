#!/usr/bin/env python3
"""Pin card rules metadata for offline context research; not display data.

Keeps the printed fields rules_mana_context reads, plus raw canonical faces,
keyed by every importer alias of the chosen printing. It does not fill in
bonus-sheet cards absent from the set search or resolve unsupported modes;
those stay unknown downstream. Writes deterministic gzip bytes so a rerun
against unchanged Scryfall data reproduces the pinned checksum.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.parse
import zlib
from pathlib import Path

from fetch_card_metadata import aliases, choose_main_printing, request_json

FIELDS = ('card_faces', 'id', 'layout', 'mana_cost', 'name', 'oracle_text', 'produced_mana', 'type_line')


def search_cards(set_code):
    query = urllib.parse.quote(f'e:{set_code.lower()}')
    url = f'https://api.scryfall.com/cards/search?q={query}&unique=prints&order=set'
    while url:
        page = request_json(url)
        yield from page.get('data', [])
        url = page.get('next_page') if page.get('has_more') else None
        if url:
            time.sleep(0.2)


def select_records(cards, set_code):
    candidates = {}
    for card in cards:
        for name in aliases(card):
            candidates.setdefault(name, []).append(card)
    records = {}
    for name, options in candidates.items():
        chosen = choose_main_printing(options, name, set_code)
        if chosen:
            records[name] = {key: chosen[key] for key in FIELDS if key in chosen}
    return records


def encode(records):
    text = json.dumps(records, sort_keys=True, separators=(',', ':')) + '\n'
    # zlib's gzip wrapper writes a zero mtime, so equal data gives equal bytes.
    packer = zlib.compressobj(9, zlib.DEFLATED, 31)
    return packer.compress(text.encode('ascii')) + packer.flush()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--set', required=True, help='Scryfall set code')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    records = select_records(search_cards(args.set), args.set)
    if not records:
        raise SystemExit(f'Scryfall returned no cards for set {args.set}.')
    data = encode(records)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(data)
    print(f'{len(records)} aliases; sha256 {hashlib.sha256(data).hexdigest()}')


if __name__ == '__main__':
    main()
