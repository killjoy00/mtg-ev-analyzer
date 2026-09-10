#!/usr/bin/env python3
"""Resolve missing trophy card images by exact Scryfall name, without scoring edits."""
import json
from pathlib import Path
import time
import urllib.request

root = Path(__file__).resolve().parents[1]
missing = json.loads((root / 'generated/review/all-set-missing-images.json').read_text())
path = root / 'corpus/draft-run/card-images.json'
images = json.loads(path.read_text())
names = sorted(set(missing.values()))
resolved = {}
for offset in range(0, len(names), 75):
    payload = json.dumps({'identifiers': [{'name': name} for name in names[offset:offset+75]]}).encode()
    request = urllib.request.Request('https://api.scryfall.com/cards/collection', data=payload,
        headers={'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'PackOne-CardMetadata/1.0'})
    with urllib.request.urlopen(request, timeout=60) as response:
        result = json.load(response)
    for card in result['data']:
        faces = card.get('card_faces') or []
        candidates = [card, *faces]
        image = next((c.get('image_uris', {}).get('normal') for c in candidates if c.get('image_uris', {}).get('normal')), None)
        if image:
            metadata = {'image_url': image}
            for key in ['mana_cost', 'rarity', 'type_line']:
                if card.get(key):
                    metadata[key] = card[key]
            resolved[card['name']] = metadata
            for face in faces:
                resolved[face['name']] = {**metadata, **({'image_url': face['image_uris']['normal']} if face.get('image_uris', {}).get('normal') else {})}
    if result.get('not_found'):
        print('Unresolved names:', json.dumps(result['not_found']), flush=True)
    time.sleep(.15)
for card_id, name in missing.items():
    if name in resolved:
        images[card_id] = resolved[name]
path.write_text(json.dumps(images, indent=2, sort_keys=True) + '\n')
print('Resolved', sum(name in resolved for name in missing.values()), 'of', len(missing), 'card IDs')
if any(name not in resolved for name in missing.values()):
    raise SystemExit('Some exact card images remain unresolved.')
