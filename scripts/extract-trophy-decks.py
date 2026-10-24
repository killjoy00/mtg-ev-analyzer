"""Extract one exact last-game deck per matched Pack One draft source.

Inputs are the licensed 17Lands game CSV and a metadata-only source inventory.
The normalized output is a private build input, not a browser asset. The serving
catalog retains only the canonical public draft URL alongside the deck context.
"""
import argparse
import csv
import gzip
import hashlib
import json
from pathlib import Path
import re
import time


def source_aliases(set_id, event_type, draft_id, expansion=None):
    expansion = expansion or ('Cube_-_Powered' if set_id == 'powered-cube' else set_id.upper())
    values = [f'{set_id}|{draft_id}', f'{set_id}|{event_type}|{draft_id}',
              f'pack-one|{expansion}|{draft_id}']
    if expansion != expansion.upper():
        values.append(f'pack-one|{expansion.upper()}|{draft_id}')
    return sorted({hashlib.sha256(value.encode()).hexdigest()[:32] for value in values})


def wanted_sources(rows, set_id, event_type):
    wanted = set()
    for row in rows:
        if row['set_id'] != set_id:
            continue
        version = row.get('corpus_version')
        source_event = row.get('event_type') or (
            'TradDraft' if version and version.startswith('traditional-') else
            'PremierDraft' if version else None)
        if source_event and source_event != event_type:
            continue
        source = row['source_draft_hash']
        if not re.fullmatch('[a-f0-9]{32}', source):
            raise ValueError('Source inventory contains an invalid hash')
        wanted.add(source)
    return wanted


def quantities(row, columns):
    result = []
    for index, name in columns:
        value = row[index]
        if value in ('', '0', '0.0'):
            continue
        number = float(value)
        if not number.is_integer() or not 0 < number <= 250:
            raise ValueError('Deck contains an invalid card quantity')
        result.append({'name': name, 'count': int(number)})
    return result


def extract(games, inventory, set_id, event_type, expansion=None):
    if not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*', set_id):
        raise ValueError('Invalid set identity')
    if event_type not in ('PremierDraft', 'TradDraft'):
        raise ValueError('Unsupported draft format')
    wanted = wanted_sources(inventory, set_id, event_type)
    final, matches = {}, {}
    row_count = matched_games = 0
    started = time.monotonic()
    with gzip.open(games, 'rt', newline='', encoding='utf-8-sig') as source:
        reader = csv.reader(source)
        header = next(reader)
        ix = {key: index for index, key in enumerate(header)}
        for required in ('draft_id', 'match_number', 'game_number'):
            if required not in ix:
                raise ValueError('Game archive is missing ' + required)
        main_columns = [(i, key[5:]) for i, key in enumerate(header) if key.startswith('deck_')]
        side_columns = [(i, key[10:]) for i, key in enumerate(header) if key.startswith('sideboard_')]
        if not main_columns:
            raise ValueError('Game archive has no deck columns')
        for row in reader:
            row_count += 1
            draft_id = row[ix['draft_id']]
            if draft_id not in matches:
                aliases = source_aliases(set_id, event_type, draft_id, expansion)
                matches[draft_id] = aliases if wanted.intersection(aliases) else None
            aliases = matches[draft_id]
            if not aliases:
                continue
            matched_games += 1
            value = lambda key, default='': row[ix[key]] if key in ix else default
            sequence = (int(value('match_number') or 0), int(value('game_number') or 0),
                        int(value('build_index', '0') or 0))
            timestamp = value('game_time') if 'game_time' in ix else None
            order = (timestamp, *sequence) if timestamp is not None else sequence
            if timestamp == '':
                raise ValueError('Matched game has no timestamp')
            previous = final.get(draft_id)
            if previous and order < previous['order']:
                continue
            main, side = quantities(row, main_columns), quantities(row, side_columns)
            if previous and order == previous['order']:
                if main != previous['deck'] or side != previous['sideboard']:
                    previous['ambiguous'] = True
                continue
            final[draft_id] = {
                'set_id': set_id, 'event_type': event_type, 'draft_id': draft_id,
                'source_hashes': aliases, 'last_game_time': timestamp,
                'build_index': sequence[2], 'order': order, 'deck': main, 'sideboard': side,
                'deck_size': sum(card['count'] for card in main),
                'main_colors': value('main_colors'), 'splash_colors': value('splash_colors'),
                'ambiguous': False,
            }
    valid, observed, rejected = [], set(), []
    for draft_id, deck in sorted(final.items()):
        reason = 'ambiguous_last_game' if deck['ambiguous'] else (
            'deck_below_40_cards' if deck['deck_size'] < 40 else None)
        if reason:
            rejected.append({'source_hashes': sorted(wanted.intersection(deck['source_hashes'])),
                             'reason': reason})
            continue
        observed.update(deck['source_hashes'])
        del deck['ambiguous']
        valid.append(deck)
    digest = hashlib.sha256()
    with open(games, 'rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    report = {
        'set_id': set_id, 'event_type': event_type, 'game_rows': row_count,
        'matched_game_rows': matched_games, 'wanted_sources': len(wanted),
        'matched_sources': len(wanted.intersection(observed)), 'decks': len(valid),
        'missing_source_hashes': sorted(wanted - observed), 'rejected': rejected,
        'archive_sha256': digest.hexdigest(), 'archive_bytes': Path(games).stat().st_size,
        'seconds': round(time.monotonic() - started, 2),
        'ordering': 'game_time_then_event_sequence' if 'game_time' in ix else 'event_sequence',
        'definition': 'One exact main deck and sideboard from the last recorded game. '
                      'Not a guaranteed submitted event-final deck.',
    }
    return valid, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--games', required=True, type=Path)
    parser.add_argument('--sources', required=True, type=Path)
    parser.add_argument('--set-id', required=True)
    parser.add_argument('--event', required=True, choices=['PremierDraft', 'TradDraft'])
    parser.add_argument('--expansion')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args()
    decks, report = extract(args.games, json.loads(args.sources.read_text()),
                            args.set_id, args.event, args.expansion)
    for target in [args.output, args.report]:
        target.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + '.tmp')
    with gzip.open(temporary, 'wt', encoding='utf-8') as output:
        for deck in decks:
            output.write(json.dumps(deck, separators=(',', ':')) + '\n')
    temporary.replace(args.output)
    args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items()
                      if key not in ('missing_source_hashes', 'rejected')}))


if __name__ == '__main__':
    main()
