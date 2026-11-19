#!/usr/bin/env python3
"""Build printing-specific face overlays for existing puzzles and saved answers.

Searches all Scryfall double-faced/meld printings, then retains exact image IDs
present in the local corpus, supplemental image map and optional serving export.
Never rewrites puzzle evidence. The optional inventory is a JSON card/puzzle tree.
"""
import argparse
import gzip
import json
import re
import time
from pathlib import Path
from urllib.parse import urlencode, urlsplit

try:
    from fetch_card_metadata import request_json, aliases
    from card_faces import display_faces, safe_image
except ModuleNotFoundError:
    from scripts.fetch_card_metadata import request_json, aliases
    from scripts.card_faces import display_faces, safe_image

ROOT = Path(__file__).resolve().parents[1]
IMAGE_ID = re.compile(r'/([a-f0-9]{8}-[a-f0-9-]{27})\.(?:jpg|png|webp)$')


def inventory_ids(value):
    result = set()
    if isinstance(value, dict):
        url = safe_image(value.get('image_url'))
        match = IMAGE_ID.search(urlsplit(url).path) if url else None
        if match:
            result.add(match.group(1))
        for child in value.values():
            result.update(inventory_ids(child))
    elif isinstance(value, list):
        for child in value:
            result.update(inventory_ids(child))
    return result


def build_registry(cards, wanted):
    by_id = {card['id']: card for card in cards}
    records = {}
    unresolved = []
    for sid in sorted(wanted & by_id.keys()):
        card = by_id[sid]
        if card.get('layout') in {'art_series', 'double_faced_token'}:
            continue
        faces = display_faces(card, by_id.get)
        # A meld result itself is already a complete image, not another front.
        if card.get('layout') == 'meld' and any(p.get('component') == 'meld_result' and p.get('id') == sid for p in card.get('all_parts', [])):
            continue
        if not faces:
            unresolved.append({'scryfall_id': sid, 'name': card.get('name'), 'layout': card.get('layout')})
            continue
        records[sid] = {'names': sorted(set(aliases(card))), 'layout': card.get('layout'), 'display_faces': faces}
    if unresolved:
        raise ValueError('Incomplete face metadata: ' + json.dumps(unresolved))
    return {'schema_version': 1, 'printings': records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', action='append', default=[], help='Additional JSON or JSON.gz serving inventory')
    parser.add_argument('--scryfall-cache', type=Path, help='Reuse/save downloaded Scryfall printings for reproducibility')
    parser.add_argument('--output', type=Path, default=ROOT / 'corpus/card-face-metadata.json')
    args = parser.parse_args()
    paths = list((ROOT / 'corpus/draft-run').glob('*.json.gz')) + [ROOT / 'corpus/draft-run/card-images.json'] + [Path(p) for p in args.inventory]
    wanted = set()
    for path in paths:
        payload = gzip.decompress(path.read_bytes()) if path.suffix == '.gz' else path.read_bytes()
        wanted.update(inventory_ids(json.loads(payload)))
    if args.scryfall_cache and args.scryfall_cache.exists():
        cards = json.loads(args.scryfall_cache.read_text())
    else:
        cards = []
        url = 'https://api.scryfall.com/cards/search?' + urlencode({'q':'is:dfc or layout:meld', 'unique':'prints', 'include_extras':'true', 'include_variations':'true'})
        while url:
            page = request_json(url)
            cards.extend(page['data'])
            url = page.get('next_page') if page.get('has_more') else None
            if url:
                time.sleep(.15)
        if args.scryfall_cache:
            args.scryfall_cache.parent.mkdir(parents=True, exist_ok=True)
            args.scryfall_cache.write_text(json.dumps(cards))
    registry = build_registry(cards, wanted)
    args.output.write_text(json.dumps(registry, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({'inventory_printings':len(wanted), 'double_face_printings':len(registry['printings']), 'unresolved_double_faces':0}))


if __name__ == '__main__':
    main()
