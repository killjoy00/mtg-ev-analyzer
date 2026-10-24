"""Build the serving catalog from matched, anonymized 17Lands final-game decks.

The complete public archives remain research inputs. Only source hashes
represented in Pack One are bundled, including older stored corpus versions.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
from importlib.util import module_from_spec, spec_from_file_location

spec = spec_from_file_location('extract_trophy_decks', Path(__file__).with_name('extract-trophy-decks.py'))
extractor = module_from_spec(spec)
spec.loader.exec_module(extractor)

parser = argparse.ArgumentParser()
parser.add_argument('--decks', required=True)
parser.add_argument('--cards', required=True)
parser.add_argument('--sources', required=True, help='All stored source hashes for this set, including older corpus versions')
parser.add_argument('--output', required=True)
parser.add_argument('--set-id', default='fra')
parser.add_argument('--version')
parser.add_argument('--supplemental-cards', action='append', default=[])
args = parser.parse_args()
decks = json.loads(Path(args.decks).read_text())
source_rows = json.loads(Path(args.sources).read_text())
allowed_sources = {row['source_draft_hash'] for row in source_rows}
assert allowed_sources and all(re.fullmatch('[a-f0-9]{32}', source) for source in allowed_sources), 'Invalid source inventory'
assert re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*', args.set_id), 'Invalid set identity'
assert all(deck['set_id'] == args.set_id for deck in decks), 'Mixed set identities'
version = args.version or ('fra-2026-10-17-v1' if args.set_id == 'fra' else None)
assert version, 'Provide a version for this catalog'
metadata = {}
card_inputs = json.loads(Path(args.cards).read_text())
for path in args.supplemental_cards:
    card_inputs.extend(json.loads(Path(path).read_text()))
for card in card_inputs:
    metadata[card['name']] = card
    for face in card.get('card_faces', []):
        metadata[face['name']] = {**card, **face}
casefold_metadata = {name.casefold(): card for name, card in metadata.items()}
names = sorted({card['name'] for deck in decks for card in deck['deck'] + deck['sideboard']})
cards = []
for index, name in enumerate(names):
    card = metadata.get(name) or casefold_metadata[name.casefold()]
    front = card.get('card_faces', [card])[0]
    image = (card.get('image_uris') or front.get('image_uris') or {}).get('normal')
    assert image and image.startswith('https://cards.scryfall.io/'), name
    display = {'id': f'deck-{index}' if args.set_id == 'fra' else f'deck-{args.set_id}-{index}', 'name': name, 'image_url': image,
                  'mana_cost': card.get('mana_cost', front.get('mana_cost', '')),
                  'type_line': card.get('type_line', front.get('type_line', '')).split(' // ')[0],
                  'mana_value': card['cmc']}
    faces = card.get('card_faces', [])
    if len(faces) == 2 and all(face.get('image_uris', {}).get('normal') for face in faces):
        display['display_faces'] = [{'name': face['name'], 'role': 'front' if i == 0 else 'back',
                                    'image_url': face['image_uris']['normal'],
                                    'large_image_url': face['image_uris'].get('large', face['image_uris']['normal'])}
                                   for i, face in enumerate(faces)]
    elif card.get('layout') == 'meld':
        parts = card.get('all_parts', [])
        result = next((part for part in parts if part.get('component') == 'meld_result'), None)
        partner = next((part for part in parts if part.get('component') == 'meld_part' and part['name'] != card['name']), None)
        result_card = metadata.get(result['name']) if result else None
        result_image = result_card.get('image_uris', {}).get('normal') if result_card else None
        if partner and result_image:
            display['display_faces'] = [{'name': name, 'role': 'front', 'image_url': image},
                                       {'name': result['name'], 'role': 'meld_result', 'image_url': result_image,
                                        'partner_name': partner['name']}]
    cards.append(display)
card_index = {name: index for index, name in enumerate(names)}
catalog = {'version': version, 'set_id': args.set_id, 'sources': {}, 'cards': cards, 'decks': []}
for deck in sorted(decks, key=lambda d: (d['event_type'], d['draft_id'])):
    assert re.fullmatch('[a-f0-9]{32}', deck['draft_id']), 'Invalid public draft identity'
    def quantities(values):
        assert len({c['name'] for c in values}) == len(values)
        assert all(isinstance(c['count'], int) and 0 < c['count'] <= 250 for c in values)
        return [[card_index[c['name']], c['count']] for c in values]
    main = quantities(deck['deck'])
    assert sum(c[1] for c in main) == deck['deck_size'] >= 40
    entry = {'deck': main, 'sideboard': quantities(deck['sideboard']),
             'size': deck['deck_size'], 'event_type': deck['event_type'],
             'last_game_time': deck['last_game_time'], 'colors': deck['main_colors'],
             'splash_colors': deck['splash_colors'],
             'draft_url': 'https://www.17lands.com/draft/' + deck['draft_id']}
    index = len(catalog['decks'])
    catalog['decks'].append(entry)
    sources = [source for source in deck['source_hashes'] if source in allowed_sources]
    assert sources, 'Every bundled deck must have a stored source'
    for source in sources:
        assert source not in catalog['sources'], 'Ambiguous draft source'
        catalog['sources'][source] = index
raw = json.dumps(extractor.compact_catalog(catalog), separators=(',', ':'), sort_keys=True).encode()
compressor = "import{brotliCompressSync,constants}from'node:zlib';const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);process.stdout.write(brotliCompressSync(Buffer.concat(chunks),{params:{[constants.BROTLI_PARAM_QUALITY]:11}}));"
packed = subprocess.run(['node', '--input-type=module', '-e', compressor], input=raw,
                        stdout=subprocess.PIPE, check=True).stdout
encoded = base64.b64encode(packed).decode()
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text('// Generated by scripts/build-trophy-deck-catalog.py. See README.md for provenance.\n'
                  + 'export const sha256=' + json.dumps(hashlib.sha256(raw).hexdigest()) + ';\n'
                  + 'export const encoded=' + json.dumps(encoded) + ';\n')
print(json.dumps({'decks': len(decks), 'source_aliases': len(catalog['sources']),
                  'cards': len(cards), 'catalog_bytes': len(raw), 'module_bytes': output.stat().st_size}))
