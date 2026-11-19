#!/usr/bin/env python3
"""Resolve missing trophy card images to deterministic main art, without scoring edits."""
import json
from pathlib import Path
import time

from fetch_card_metadata import fetch_named, metadata_for_alias

root = Path(__file__).resolve().parents[1]
missing = json.loads((root / 'generated/review/all-set-missing-images.json').read_text())
path = root / 'corpus/draft-run/card-images.json'
images = json.loads(path.read_text())
names = sorted(set(missing.values()))
resolved = {}
unresolved = []
for name in names:
    card = fetch_named(name)
    metadata = metadata_for_alias(card, name) if card else {}
    if metadata.get('image_url'):
        resolved[name] = {key: value for key, value in metadata.items() if key != 'name'}
    else:
        unresolved.append(name)
    time.sleep(.15)
if unresolved:
    print('Unresolved names:', json.dumps(unresolved), flush=True)
for card_id, name in missing.items():
    if name in resolved:
        images[card_id] = resolved[name]
path.write_text(json.dumps(images, indent=2, sort_keys=True) + '\n')
print('Resolved', sum(name in resolved for name in missing.values()), 'of', len(missing), 'card IDs')
if unresolved:
    raise SystemExit('Some exact card images remain unresolved.')
