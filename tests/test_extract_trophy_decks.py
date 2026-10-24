import base64
import csv
import gzip
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('extract_trophy_decks', Path(__file__).parents[1] / 'scripts/extract-trophy-decks.py')
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


class FinalDeckExtractionTests(unittest.TestCase):
    def test_serving_catalog_retains_current_and_historical_sources_without_unused_aliases(self):
        builder = Path(__file__).parents[1] / 'scripts/build-trophy-deck-catalog.py'
        current, historical, unused = extractor.source_aliases('fra', 'PremierDraft', '0' * 32)
        deck = {'set_id': 'fra', 'draft_id': '0' * 32, 'event_type': 'PremierDraft',
                'deck': [{'name': 'Forest', 'count': 40}], 'sideboard': [{'name': 'Forest', 'count': 1}],
                'deck_size': 40, 'last_game_time': None, 'main_colors': ['G'], 'splash_colors': [],
                'source_hashes': [current, historical, unused]}
        card = {'name': 'Forest', 'cmc': 0, 'mana_cost': '', 'type_line': 'Basic Land — Forest',
                'image_uris': {'normal': 'https://cards.scryfall.io/normal/fixture.jpg'}}
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name, value in [('decks', [deck]), ('cards', [card]),
                                ('sources', [{'source_draft_hash': source} for source in [current, historical]])]:
                (root / (name + '.json')).write_text(json.dumps(value))
            output = root / 'catalog.mjs'
            command = [sys.executable, str(builder), '--decks', str(root / 'decks.json'),
                       '--cards', str(root / 'cards.json'), '--sources', str(root / 'sources.json'),
                       '--output', str(output)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            text = output.read_text()
            encoded = json.loads(re.search(r'export const encoded=(.*);', text).group(1))
            decoded = subprocess.run(['node', '--input-type=module', '-e', "import{decodeTrophyDeckCatalog}from'./worker/trophy-decks.mjs';import fs from'node:fs';process.stdout.write(JSON.stringify(decodeTrophyDeckCatalog(fs.readFileSync(0,'utf8'))))"],
                                     input=encoded.encode(), capture_output=True, check=True)
            catalog = json.loads(decoded.stdout)
            self.assertEqual(catalog['sources'], {current: 0, historical: 0})
            self.assertEqual(catalog['decks'][0]['deck'], [[0, 40]])
            self.assertEqual(catalog['decks'][0]['sideboard'], [[0, 1]])
            self.assertEqual(catalog['decks'][0]['draft_url'], 'https://www.17lands.com/draft/' + deck['draft_id'])
            self.assertNotIn(deck['draft_id'], text)
            output.unlink()
            (root / 'sources.json').write_text(json.dumps([{'source_draft_hash': 'd' * 32}]))
            rejected = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertIn('Every bundled deck must have a stored source', rejected.stderr)
            self.assertFalse(output.exists())

    def run_extract(self, rows, set_id='hob', event='PremierDraft', draft_id='sample', with_time=True):
        inventory = [{'set_id': set_id, 'event_type': event, 'source_draft_hash': source}
                     for source in extractor.source_aliases(set_id, event, draft_id)]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'games.csv.gz'
            with gzip.open(path, 'wt', newline='') as output:
                writer = csv.writer(output)
                header = ['draft_id', 'game_time', 'match_number', 'game_number', 'build_index',
                          'deck_Forest', 'deck_Card A', 'deck_Card B', 'sideboard_Card B']
                writer.writerow(header if with_time else header[:1] + header[2:])
                writer.writerows(rows if with_time else [row[:1] + row[2:] for row in rows])
            return extractor.extract(path, inventory, set_id, event)

    def test_last_observed_game_is_exact_and_does_not_combine_builds(self):
        decks, report = self.run_extract([
            ['sample', '2026-01-02 12:00', 1, 1, 0, 17, 21, 2, 1],
            ['sample', '2026-01-01 12:00', 7, 3, 9, 17, 23, 0, 3],
            ['unrelated', '2026-02-01 12:00', 1, 1, 0, 17, 0, 23, 0],
        ])
        self.assertEqual(len(decks), 1)
        self.assertEqual(decks[0]['deck'], [{'name': 'Forest', 'count': 17},
                                          {'name': 'Card A', 'count': 21}, {'name': 'Card B', 'count': 2}])
        self.assertEqual(decks[0]['sideboard'], [{'name': 'Card B', 'count': 1}])
        self.assertEqual(report['matched_sources'], 3)
        self.assertEqual(report['game_rows'], 3)

    def test_match_game_and_build_break_ties_in_that_order(self):
        rows = [['sample', '2026-01-02 12:00', 1, 1, 0, 17, 23, 0, 3],
                ['sample', '2026-01-02 12:00', 1, 2, 0, 17, 22, 1, 2],
                ['sample', '2026-01-02 12:00', 1, 2, 1, 17, 21, 2, 1]]
        decks, _ = self.run_extract(rows)
        self.assertEqual(decks[0]['build_index'], 1)
        self.assertEqual(decks[0]['deck'][-1]['count'], 2)

    def test_conflicting_final_sideboards_are_rejected(self):
        rows = [['sample', '2026-01-02 12:00', 1, 1, 0, 17, 23, 0, count] for count in [1, 2]]
        decks, report = self.run_extract(rows)
        self.assertFalse(decks)
        self.assertEqual(report['rejected'][0]['reason'], 'ambiguous_last_game')
        self.assertEqual(len(report['missing_source_hashes']), 3)

    def test_older_archives_use_match_and_game_order_without_inventing_a_time(self):
        decks, report = self.run_extract([
            ['sample', '', 3, 2, 1, 17, 21, 2, 1],
            ['sample', '', 2, 3, 4, 17, 23, 0, 3],
        ], with_time=False)
        self.assertEqual(decks[0]['deck'][-1], {'name': 'Card B', 'count': 2})
        self.assertEqual(decks[0]['build_index'], 1)
        self.assertIsNone(decks[0]['last_game_time'])
        self.assertEqual(report['ordering'], 'event_sequence')

    def test_powered_cube_aliases_and_traditional_formats(self):
        decks, report = self.run_extract([
            ['sample', '2026-01-02 12:00', 3, 2, 1, 17, 23, 0, 3],
        ], set_id='powered-cube', event='TradDraft')
        self.assertEqual(report['matched_sources'], 4)
        self.assertEqual(decks[0]['event_type'], 'TradDraft')
        inventory = [{'set_id': 'hob', 'corpus_version': 'traditional-premier-v5-phase2-v1',
                      'source_draft_hash': 'a' * 32}]
        self.assertFalse(extractor.wanted_sources(inventory, 'hob', 'PremierDraft'))
        self.assertEqual(extractor.wanted_sources(inventory, 'hob', 'TradDraft'), {'a' * 32})

    def test_absent_sources_and_short_decks_never_get_a_substitute(self):
        decks, report = self.run_extract([
            ['unrelated', '2026-01-02 12:00', 1, 1, 0, 17, 23, 0, 0],
            ['sample', '2026-01-02 12:00', 1, 1, 0, 17, 1, 0, 0],
        ])
        self.assertFalse(decks)
        self.assertEqual(report['matched_sources'], 0)
        self.assertEqual(report['rejected'][0]['reason'], 'deck_below_40_cards')

    def test_invalid_quantities_fail_before_a_deck_can_be_published(self):
        for value in ['1.5', '-1', 'NaN', '251']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.run_extract([['sample', '2026-01-02 12:00', 1, 1, 0, 17, 23, 0, value]])

    def test_name_variants_reuse_existing_verified_card_records(self):
        root = Path(__file__).parents[1]
        variants = json.loads((root / 'corpus/trophy-decks/card-name-variants.json').read_text())
        wanted = {card['name']: card for card in variants}
        found = set()
        for path in (root / 'corpus/draft-run').glob('*.gz'):
            with gzip.open(path, 'rt') as source:
                for puzzle in json.load(source):
                    for card in puzzle.get('candidates', []) + puzzle.get('prior_picks', []):
                        variant = wanted.get(card.get('name'))
                        if variant and (variant['mana_cost'] == card['mana_cost'].split(' // ')[0]
                                        and variant['type_line'] == card['type_line'].split(' // ')[0]
                                        and variant['image_uris']['normal'] == card['image_url']):
                            found.add(card['name'])
        self.assertEqual(found, set(wanted))
        self.assertEqual(wanted['A-Monster Manual']['cmc'], 4)
        self.assertEqual(wanted['Luis, Pompous Pillager']['cmc'], 2)


if __name__ == '__main__':
    unittest.main()
