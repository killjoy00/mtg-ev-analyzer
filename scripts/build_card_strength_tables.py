#!/usr/bin/env python3
"""Build per-set card strength tables from official 17Lands game data.

Strength is the shrunk game-in-hand (GIH) win rate minus the set's average game
win rate, in percentage points: 400 pseudo-games pull a card toward the set
average (scripts/card_outcomes.py). Puzzle selection uses it to tell a decision
between strong cards from one between filler. It is an observational summary,
not a causal estimate of a card's effect.

Each table records the archive it came from (URL, ETag, Last-Modified, bytes,
SHA-256). 17Lands refreshes archives in place, so a rebuild can differ; the
recorded hash says exactly which data produced the committed table.

  python scripts/build_card_strength_tables.py                 # every set
  python scripts/build_card_strength_tables.py --sets fra hob  # some sets

The sets are those with a Premier Draft game archive in
corpus/trophy-decks/coverage.json: the same archives the trophy decklists came
from. Archives are downloaded to a temporary directory and deleted after use.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
import urllib.parse
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))

from card_outcomes import PRIOR_GAMES, summarise, tally  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'corpus' / 'card-strength'
COVERAGE = ROOT / 'corpus' / 'trophy-decks' / 'coverage.json'
STRENGTH_VERSION = 'gih-shrunk-400-v1'
SCHEMA_VERSION = 1
# Basic lands are left out, as in the card-strength benchmark
# (scripts/card_strength_benchmark.py): every deck plays them.
BASICS = frozenset({'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes',
                    'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp',
                    'Snow-Covered Mountain', 'Snow-Covered Forest'})


def check_source(row: dict) -> None:
    if not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*', row.get('set_id', '')):
        raise ValueError('Invalid set id')
    url = urllib.parse.urlparse(row.get('url', ''))
    if url.scheme != 'https' or url.netloc != '17lands-public.s3.amazonaws.com' \
            or not url.path.startswith('/analysis_data/game_data/') or not url.path.endswith('.PremierDraft.csv.gz'):
        raise ValueError('Expected an official public 17Lands PremierDraft game archive: ' + row.get('url', ''))


def download(row: dict, directory: Path) -> dict:
    target = directory / (row['set_id'] + '.games.csv.gz')
    request = urllib.request.Request(row['url'], headers={'User-Agent': 'PackOneCardStrength/1.0'})
    digest, size = hashlib.sha256(), 0
    with urllib.request.urlopen(request, timeout=60) as response, open(target, 'wb') as handle:
        etag, modified = response.headers.get('etag'), response.headers.get('last-modified')
        for block in iter(lambda: response.read(1024 * 1024), b''):
            size += len(block)
            digest.update(block)
            handle.write(block)
    return {'path': target, 'etag': etag, 'last_modified': modified, 'bytes': size, 'sha256': digest.hexdigest()}


def render(table: dict) -> str:
    """JSON with one card per line, so a rebuild reviews as a readable diff."""
    head = json.dumps({k: v for k, v in table.items() if k != 'cards'}, indent=1, ensure_ascii=False)
    rows = ',\n'.join(f'  {json.dumps(name, ensure_ascii=False)}: {json.dumps(value)}'
                       for name, value in table['cards'].items())
    text = head[:-2] + ',\n "cards": {\n' + rows + '\n }\n}\n'
    if json.loads(text) != table:
        raise AssertionError('Strength table did not round-trip')
    return text


def build(row: dict, directory: str) -> dict:
    check_source(row)
    archive = download(row, Path(directory))
    try:
        per_fold, rows, wins = tally(archive['path'])
        summary = summarise(per_fold[0], rows[0], wins[0])
    finally:
        archive['path'].unlink(missing_ok=True)
    baseline = summary['baseline_win_rate']
    cards = {name: [round(100 * (card['gih_wr_shrunk'] - baseline), 2), card['gih_games']]
             for name, card in sorted(summary['cards'].items()) if name not in BASICS}
    table = {
        'schema_version': SCHEMA_VERSION,
        'strength_version': STRENGTH_VERSION,
        'set_id': row['set_id'],
        'measure': 'Shrunk game-in-hand win rate minus the set average, in percentage points; '
                   '[points, in-hand games] per card.',
        'prior_games': PRIOR_GAMES,
        'source': {'provider': '17Lands', 'license': 'CC BY 4.0', 'url': row['url'],
                   'etag': archive['etag'], 'last_modified': archive['last_modified'],
                   'bytes': archive['bytes'], 'sha256': archive['sha256']},
        'game_rows': summary['game_rows'],
        'baseline_win_rate': baseline,
        'cards': cards,
    }
    (OUTPUT / (row['set_id'] + '.json')).write_text(render(table), encoding='utf-8')
    return {'set_id': row['set_id'], 'cards': len(cards), 'game_rows': summary['game_rows'], 'sha256': archive['sha256']}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--sets', nargs='*', help='set ids (default: every set with a Premier Draft archive)')
    parser.add_argument('--workers', type=int, default=3)
    args = parser.parse_args(argv)
    archives = json.loads(COVERAGE.read_text(encoding='utf-8'))['archives']
    sources = [{'set_id': a['set_id'], 'url': a['archive_url']} for a in archives if a['event_type'] == 'PremierDraft']
    for row in sources:
        check_source(row)
    chosen = [row for row in sources if not args.sets or row['set_id'] in args.sets]
    unknown = set(args.sets or []) - {row['set_id'] for row in sources}
    if unknown:
        raise SystemExit('No Premier Draft archive for: ' + ', '.join(sorted(unknown)))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='card-strength-') as directory, \
            ProcessPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(build, row, directory): row['set_id'] for row in chosen}
        for future in as_completed(futures):
            print(json.dumps(future.result()), flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
