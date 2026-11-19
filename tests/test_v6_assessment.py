"""Synthetic checks for the v6 assessment and pooled report; no archive data."""
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from assess_v6_colour_model import (TEMPERATURE_GRID, award_shift, draft_deltas, score, served,
                                    summary, temperature_losses)
from build_replays import PickExample
from model_training import V5_MODEL, V6_MODEL
from report_v6_colour_model import best_temperature, pooled_bootstrap, summarize, verdict


class Fixed:
    def __init__(self, values):
        self.values = values

    def card_tendency(self, name, pack, pick, pool):
        return self.values[name]


class AssessmentTests(unittest.TestCase):
    def test_served_slice_is_pack_one_picks_one_to_eleven(self):
        class FakeCache:
            meta = {'pack_offset': 1, 'pick_offset': 1}
        examples = [PickExample('d', p, k, 'A', ['A'], {}) for p, k in [(0, 0), (0, 10), (0, 11), (1, 0)]]
        self.assertEqual([(x.raw_pack_number, x.raw_pick_number) for x in served(FakeCache, examples)],
                         [(0, 0), (0, 10)])

    def test_scores_deltas_and_point_shift_use_identical_decisions(self):
        examples = [PickExample('d1', 0, 0, 'A', ['A', 'B'], {}), PickExample('d1', 0, 1, 'B', ['A', 'B'], {}),
                    PickExample('d2', 0, 0, 'B', ['A', 'B'], {})]
        base_rows, base = score(Fixed({'A': .6, 'B': .4}), examples)
        rows, other = score(Fixed({'A': .4, 'B': .6}), examples)
        self.assertEqual(summary(base_rows)['top1'], round(1 / 3, 6))
        self.assertEqual(award_shift(base, other), {'leader_change_rate': 1.0, 'mean_abs_award_change': 32.0})
        deltas = draft_deltas(base_rows, rows)
        self.assertEqual(deltas['d1'][2:], [0, 2])
        self.assertAlmostEqual(deltas['d2'][0], -math.log(.6) + math.log(.4))
        with self.assertRaises(ValueError):
            draft_deltas(base_rows, rows[::-1])

    def test_display_exponents_are_scored_on_the_chosen_card(self):
        result = temperature_losses(Fixed({'A': .6, 'B': .4}), [PickExample('d', 0, 0, 'A', ['A', 'B'], {})])
        self.assertEqual(result['decisions'], 1)
        self.assertEqual(set(result['summed_log_loss']), {f'{t:g}' for t in TEMPERATURE_GRID})
        self.assertAlmostEqual(result['summed_log_loss']['1'], -math.log(.6), places=6)
        # Sharpening helps when the chosen card already leads.
        self.assertLess(result['summed_log_loss']['3'], result['summed_log_loss']['1'])


class ReportTests(unittest.TestCase):
    def report(self, set_id, decisions, loss_ci, top1_ci, losses):
        arm = {'served_slice': {'decisions': decisions},
               'validation_calibration': {'decisions': 10, 'summed_log_loss': losses}}
        return {'set': set_id, 'split': 'test', 'arms': {V5_MODEL: arm, V6_MODEL: arm},
                'v6_minus_v5': {'log_loss_delta': loss_ci[0], 'log_loss_ci95': loss_ci, 'top1_ci95': top1_ci}}

    def test_pooled_bootstrap_weights_drafts_by_decisions(self):
        cells = [[-1.0, -.5, 1, 2], [0.0, 0.0, 0, 2]] * 50
        result = pooled_bootstrap(cells, draws=200)
        self.assertEqual((result['drafts'], result['decisions']), (100, 200))
        self.assertAlmostEqual(result['log_loss_delta'], -.25)
        low, high = result['log_loss_ci95']
        self.assertLess(low, -.25)
        self.assertLess(-.25, high)
        self.assertLess(high, 0)

    def test_verdict_needs_a_better_log_loss_and_no_top1_loss(self):
        self.assertEqual(verdict({'log_loss_ci95': [-.02, -.01], 'top1_ci95': [-.001, .002]}), 'v6 passes')
        self.assertEqual(verdict({'log_loss_ci95': [-.02, 0.0], 'top1_ci95': [0, .01]}), 'v6 does not pass')
        self.assertEqual(verdict({'log_loss_ci95': [-.02, -.01], 'top1_ci95': [-.01, -.001]}), 'v6 does not pass')

    def test_display_exponent_is_pooled_across_sets(self):
        grid = {f'{t:g}': 5.0 for t in TEMPERATURE_GRID}
        # Set a alone prefers 2; pooled with b, 1.75 wins (7 against 4).
        reports = [self.report('a', 1, [0, 0], [0, 0], {**grid, '2': 1.0, '1.75': 2.0}),
                   self.report('b', 1, [0, 0], [0, 0], {**grid, '2': 6.0, '1.75': 2.0})]
        result = best_temperature(reports, V6_MODEL)
        self.assertEqual(result['exponent'], 1.75)
        self.assertEqual(result['decisions'], 20)

    def test_summary_refuses_deltas_that_do_not_match_a_report(self):
        grid = {f'{t:g}': 1.0 for t in TEMPERATURE_GRID}
        reports = [self.report('hob', 3, [-.01, -.001], [0, .01], grid)]
        deltas = [{'set': 'hob', 'drafts': {'d1': [-.1, 0, 1, 2], 'd2': [0, 0, 0, 1]}}]
        result = summarize(reports, deltas)
        self.assertEqual(result['pooled_v6_minus_v5']['decisions'], 3)
        self.assertEqual(result['sets_with_log_loss_ci_below_zero'], 1)
        with self.assertRaises(ValueError):
            summarize(reports, [{'set': 'hob', 'drafts': {'d1': [0, 0, 0, 1]}}])


if __name__ == '__main__':
    unittest.main()
