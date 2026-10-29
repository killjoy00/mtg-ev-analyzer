"""Synthetic checks for the challenger definitions; no archive or player data."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_replays import CountStore, PickExample
from compare_context_challengers import award_shift, explicit_colours, score, served, summary


def card(cost, type_line='Creature', **fields):
    return {'layout': 'normal', 'mana_cost': cost, 'type_line': type_line, **fields}


class ChallengerTests(unittest.TestCase):
    def test_explicit_colors_replace_only_complete_metadata(self):
        metadata = {
            'Splashed': card('{4}{R}{R}'), 'Gold': card('{1}{U}{R}'), 'Artifact': card('{3}', 'Artifact'),
            'Dual': card('', 'Land', produced_mana=['W', 'U']), 'Wastes': card('', 'Land', produced_mana=['C']),
            'Unread land': card('', 'Land'), 'Hybrid': card('{W/U}'),
        }
        inferred = {'Splashed': frozenset(), 'Gold': frozenset('U'), 'Dual': frozenset('U'),
                    'Unread land': frozenset('G'), 'Hybrid': frozenset('W'), 'Thin': None}
        names = [*metadata, 'Thin', 'Absent']
        plain = explicit_colours(names, inferred, metadata)
        self.assertEqual(plain['Splashed'], frozenset('R'))
        self.assertEqual(plain['Gold'], frozenset('UR'))
        self.assertEqual(plain['Artifact'], frozenset())
        self.assertEqual(plain['Dual'], frozenset())
        self.assertEqual(plain['Hybrid'], frozenset('W'))
        self.assertIsNone(plain['Thin'])
        self.assertNotIn('Absent', plain)
        fixing = explicit_colours(names, inferred, metadata, fixing=True)
        self.assertEqual(fixing['Dual'], frozenset('WU'))
        self.assertEqual(fixing['Wastes'], frozenset())
        # Unknown produced mana is not evidence that a land makes none.
        self.assertEqual(fixing['Unread land'], frozenset('G'))
        self.assertEqual(fixing['Splashed'], plain['Splashed'])

    def test_served_slice_is_pack_one_picks_one_to_eleven(self):
        class FakeCache:
            meta = {'pack_offset': 1, 'pick_offset': 1}
        examples = [PickExample('d', pack, pick, 'A', ['A'], {})
                    for pack, pick in [(0, 0), (0, 10), (0, 11), (1, 0)]]
        self.assertEqual([(x.raw_pack_number, x.raw_pick_number) for x in served(FakeCache, examples)],
                         [(0, 0), (0, 10)])

    def test_score_and_award_shift_compare_the_same_packs(self):
        class Fixed:
            def __init__(self, values):
                self.values = values

            def card_tendency(self, name, pack, pick, pool):
                return self.values[name]
        examples = [PickExample('d1', 0, 0, 'A', ['A', 'B'], {}), PickExample('d2', 0, 0, 'B', ['A', 'B'], {})]
        base_rows, base = score(Fixed({'A': .6, 'B': .4}), examples)
        rows, other = score(Fixed({'A': .4, 'B': .6}), examples)
        self.assertEqual(summary(base_rows)['top1'], .5)
        self.assertEqual(award_shift(base, other), {'leader_change_rate': 1.0,
                                                    'mean_abs_award_change': 32.0})
        self.assertEqual(award_shift(base, base)['mean_abs_award_change'], 0)


if __name__ == '__main__':
    unittest.main()
