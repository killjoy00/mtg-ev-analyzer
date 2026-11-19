"""Synthetic checks for the challenger definitions; no archive or player data."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_replays import CountStore, PickExample
from compare_context_challengers import (award_shift, explicit_colours, score, served, summary,
                                        matched_colours, pairwise_contrasts, contrast_verdict, compare)


def card(cost, type_line='Creature', **fields):
    return {'layout': 'normal', 'mana_cost': cost, 'type_line': type_line, **fields}


class ChallengerTests(unittest.TestCase):
    def test_matched_coverage_preserves_known_empty_and_unknown_metadata(self):
        names = ['Known', 'Flexible', 'Thin', 'Absent', 'Hybrid']
        inferred = {'Known': frozenset('U'), 'Flexible': frozenset(), 'Thin': None,
                    'Hybrid': frozenset('W')}
        metadata = {name: card('{R}') for name in names}
        metadata['Hybrid'] = card('{W/U}')
        result = matched_colours(names, inferred, metadata)
        self.assertEqual(result['Known'], frozenset('R'))
        self.assertEqual(result['Flexible'], frozenset('R'))
        self.assertIsNone(result['Thin'])
        self.assertIsNone(result['Absent'])
        self.assertEqual(result['Hybrid'], frozenset('W'))
        self.assertEqual({n for n, v in result.items() if v is not None},
                         {n for n, v in inferred.items() if v is not None})

    def test_six_pairs_have_candidate_minus_baseline_direction(self):
        names = ['splash', 'explicit', 'explicit-fixing', 'explicit-matched']
        scored = {name: ([('d', 4-i, .5, 1)], [[.6, .4]]) for i, name in enumerate(names)}
        results = pairwise_contrasts(scored, 20)
        self.assertEqual(len(results), 6)
        self.assertEqual(results['explicit-minus-splash']['log_loss_delta'], -1)
        self.assertEqual(results['explicit-matched-minus-splash']['log_loss_ci95'], [-3, -3])

    def test_frozen_rule_requires_four_sets_and_top_one_guardrail(self):
        win = {'log_loss_ci95': [-.2, -.1], 'top1_ci95': [-.01, .01]}
        tie = {'log_loss_ci95': [-.1, 0], 'top1_ci95': [-.01, .01]}
        self.assertEqual(contrast_verdict([win]*4+[tie]), 'candidate beats baseline')
        self.assertEqual(contrast_verdict([win]*3+[tie]*2), 'inconclusive')
        self.assertEqual(contrast_verdict([win]*4), 'incomplete')
        self.assertEqual(contrast_verdict([win]*4+[{**tie,'top1_ci95':[-.02,-.01]}]), 'inconclusive')
        reverse = {'log_loss_ci95': [.1, .2], 'top1_ci95': [-.01, .01]}
        self.assertEqual(contrast_verdict([reverse]*5), 'baseline beats candidate')
        self.assertEqual(contrast_verdict([reverse]*4+[{**reverse,'top1_ci95':[.01,.02]}]), 'inconclusive')

    def test_pairwise_cannot_open_reserved_test_even_programmatically(self):
        with self.assertRaisesRegex(ValueError, 'test is reserved'):
            compare(None, None, None, 'test', 20, pairwise=True)

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
