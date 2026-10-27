import csv
import gzip
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import build_card_strength_tables as tables

ROOT = Path(__file__).resolve().parents[1]
OFFICIAL = 'https://17lands-public.s3.amazonaws.com/analysis_data/game_data/game_data_public.HOB.PremierDraft.csv.gz'


class CardStrengthTableTests(unittest.TestCase):
    def test_only_official_premier_game_archives_are_accepted(self):
        tables.check_source({'set_id': 'hob', 'url': OFFICIAL})
        tables.check_source({'set_id': 'powered-cube', 'url': OFFICIAL.replace('HOB', 'Cube_-_Powered')})
        for row in ({'set_id': 'hob', 'url': OFFICIAL.replace('https', 'http')},
                    {'set_id': 'hob', 'url': OFFICIAL.replace('PremierDraft', 'TradDraft')},
                    {'set_id': 'hob', 'url': OFFICIAL.replace('17lands-public.s3', 'example.s3')},
                    {'set_id': 'hob', 'url': OFFICIAL.replace('game_data/', 'draft_data/')},
                    {'set_id': '../hob', 'url': OFFICIAL}):
            with self.assertRaises(ValueError):
                tables.check_source(row)

    def test_committed_tables_are_in_rendered_form(self):
        for path in sorted((ROOT / 'corpus/card-strength').glob('*.json')):
            text = path.read_text(encoding='utf-8')
            self.assertEqual(tables.render(json.loads(text)), text, path.name)

    def test_build_writes_points_over_the_set_average_without_basics(self):
        header = ['draft_id', 'won', 'deck_Hero', 'opening_hand_Hero', 'drawn_Hero',
                  'deck_Filler', 'opening_hand_Filler', 'drawn_Filler',
                  'deck_Forest', 'opening_hand_Forest', 'drawn_Forest']
        rows = []
        # Hero is in hand for 300 games and wins 240; Filler for 300, wins 120.
        for i in range(600):
            hero = i < 300
            won = (i < 240) or (300 <= i < 420)
            rows.append([f'd{i}', 'True' if won else 'False',
                         '1', '1' if hero else '0', '0', '1', '0' if hero else '1', '0', '8', '1', '0'])
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'games.csv.gz'
            with gzip.open(archive, 'wt', newline='') as handle:
                writer = csv.writer(handle)
                writer.writerow(header)
                writer.writerows(rows)
            data = archive.read_bytes()
            fake = {'path': archive, 'etag': '"e"', 'last_modified': 'x', 'bytes': len(data),
                    'sha256': hashlib.sha256(data).hexdigest()}
            with patch.object(tables, 'download', return_value=fake), patch.object(tables, 'OUTPUT', Path(directory)):
                result = tables.build({'set_id': 'hob', 'url': OFFICIAL}, directory)
            table = json.loads((Path(directory) / 'hob.json').read_text())
        self.assertEqual(result['game_rows'], 600)
        self.assertEqual(table['baseline_win_rate'], 0.6)
        self.assertEqual(sorted(table['cards']), ['Filler', 'Hero'])
        # (240 + 400 * 0.6) / 700 - 0.6 = +8.57 points; (120 + 240) / 700 - 0.6 = -8.57.
        self.assertEqual(table['cards']['Hero'], [8.57, 300])
        self.assertEqual(table['cards']['Filler'], [-8.57, 300])
        self.assertEqual(table['source']['sha256'], fake['sha256'])
        self.assertEqual(table['strength_version'], tables.STRENGTH_VERSION)


if __name__ == '__main__':
    unittest.main()
