import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_cube_rules_metadata import BATCH, fetch_batch, resolve_records


class CubeRulesMetadataTests(unittest.TestCase):
    def test_batch_limit_rejects_overlarge_scryfall_calls(self):
        with self.assertRaisesRegex(ValueError, '75'):
            fetch_batch(['Card %d' % i for i in range(BATCH + 1)],
                        opener=lambda request, timeout: None)

    def test_explicit_aliases_and_unknowns_fail_closed(self):
        def offline_cards(batch):
            return [
                {'name': 'Island', 'layout': 'normal',
                 'type_line': 'Basic Land — Island', 'produced_mana': ['U']},
                {'name': 'Forest', 'layout': 'normal',
                 'type_line': 'Basic Land — Forest', 'produced_mana': ['G']},
            ]
        names = ['Forest', 'Island', 'Nonexistent card']
        records = resolve_records(names, fetcher=offline_cards)
        self.assertEqual(sorted(records), ['Forest', 'Island'])
        self.assertEqual(records['Island']['produced_mana'], ['U'])
        self.assertNotIn('Nonexistent card', records)


if __name__ == '__main__':
    unittest.main()
