import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import puzzle_quality as q

SCIENTIFIC = all(importlib.util.find_spec(x) for x in ('numpy', 'scipy', 'pandas', 'sklearn'))
if SCIENTIFIC:
    import numpy as np
    import puzzle_quality_experiment as experiment


def fixture():
    puzzle = {'puzzle_id': 'example', 'set_id': 'example', 'source_draft_hash': 'source',
              'pick_number': 1, 'prior_picks': [], 'historical_pick_id': 'a', 'removed': False,
              'candidates': [{'id': c, 'name': c, 'mana_cost': cost,
                              'model_probability': p, 'type_line': 'Creature'}
                             for c, cost, p in [('a', '{2}{R}', .45), ('b', '{2}{G}', .4), ('c', '{3}{U}', .15)]]}
    table = {'set': 'example', 'cards': {c: {'deck_games': 500, 'C_adjusted_z': 1., 'A_gih_z': .8} for c in 'abc'}}
    protocol = json.loads((q.ROOT / 'research/puzzle-quality-v1.json').read_text())
    return puzzle, table, protocol


class QualityInferenceTests(unittest.TestCase):
    def test_observations_identities_and_target_do_not_enter_features(self):
        puzzle, table, _ = fixture()
        before = q.prepare_context(puzzle, table)
        puzzle.update(choices=[{'id': 'b', 'n': 999}], observed_split=[0, 1, 0],
                      n=999, puzzle_id='different', historical_pick_id='b', final_deck=['b'])
        after = q.prepare_context(puzzle, table)
        self.assertEqual(before, after)

    def test_weak_close_pack_is_rejected(self):
        puzzle, table, protocol = fixture()
        for c in table['cards'].values(): c['C_adjusted_z'] = -1.
        result = q.assess(puzzle, q.prepare_context(puzzle, table), [.45, .4, .15], protocol)
        self.assertFalse(result['eligible'])
        self.assertIn('fewer_than_two_credible_choices', result['reasons'])

    def test_strong_close_pack_can_qualify(self):
        puzzle, table, protocol = fixture()
        result = q.assess(puzzle, q.prepare_context(puzzle, table), [.45, .4, .15], protocol)
        self.assertTrue(result['eligible'])
        self.assertGreater(result['quality_score'], 0)

    def test_unknown_strength_is_not_low_strength_or_promotion(self):
        puzzle, table, protocol = fixture()
        table['cards'] = {}
        prepared = q.prepare_context(puzzle, table)
        self.assertTrue(all(c['strength_z'] is None for c in prepared['cards']))
        result = q.assess(puzzle, prepared, [.45, .4, .15], protocol)
        self.assertFalse(result['eligible'])
        self.assertIn('unknown_strength', result['cards'][0]['review_reasons'])

    def test_colour_commitment_grows_with_prior_picks(self):
        puzzle, table, _ = fixture()
        first = q.prepare_context(puzzle, table)
        self.assertEqual([r[2] for r in first['features']], [0, 0, 0])
        puzzle['prior_picks'] = [puzzle['candidates'][0]] * 8
        puzzle['pick_number'] = 9
        later = q.prepare_context(puzzle, table)
        self.assertEqual([r[2] for r in later['features']], [1, -1, -1])

    def test_ambiguous_cost_is_explicitly_unknown(self):
        self.assertEqual(q.card_colours({'mana_cost': '{2}{R/G}'}), (set(), False))
        self.assertEqual(q.card_colours({'mana_cost': '{4}'}), (set(), True))

    def test_removed_target_never_qualifies(self):
        puzzle, table, protocol = fixture(); puzzle['removed'] = True
        result = q.assess(puzzle, q.prepare_context(puzzle, table), [.45, .4, .15], protocol)
        self.assertFalse(result['eligible']); self.assertIn('admin_removed', result['reasons'])

    def test_bad_trajectory_and_mismatched_strength_fail(self):
        puzzle, table, _ = fixture();puzzle['pick_number'] = 2
        with self.assertRaises(ValueError): q.prepare_context(puzzle, table)
        puzzle['pick_number'] = 1;table['set'] = 'wrong'
        with self.assertRaises(ValueError): q.prepare_context(puzzle, table)

    def test_portfolio_never_repeats_source_or_backfills_failures(self):
        rows = [{'puzzle_id': str(i), 'set_id': 'x', 'pick_number': i + 1,
                 'source_draft_hash': 'one-source', 'eligible': True, 'quality_score': 1.} for i in range(3)]
        result = q.select_portfolio(rows, .2)
        self.assertEqual(len(result['selected_puzzle_ids']), 1)
        self.assertEqual(sum(r['shortfall'] for r in result['strata']), 2)


@unittest.skipUnless(SCIENTIFIC, 'optional research dependencies not installed')
class QualityExperimentTests(unittest.TestCase):
    def test_source_exclusion_precedes_training_budget(self):
        chosen = experiment.independent_training_ids(np.arange(4), np.array(['a', 'b', 'c', 'd']), {'a', 'c'})
        np.testing.assert_array_equal(chosen[:2], [1, 3])
        self.assertEqual(experiment.source_hash('FRA', 'test'), experiment.source_hash('fra', 'test'))

    def test_target_answers_cannot_change_fitted_model(self):
        rows, prepared = [], []
        for sid in ['a', 'b', 'holdout']:
            for i in range(4):
                rows.append({'set_id': sid, 'source': f'{sid}-{i}', 'n': 10, 'counts': np.array([7., 3.])})
                prepared.append({'features': [[-1., 1., .5, 0.], [-2., -1., -.5, 0.]]})
        before = experiment.fit_without_target(rows, prepared, 'holdout', 'adjusted_fit', .02)
        for row in rows:
            if row['set_id'] == 'holdout': row['counts'] = np.array([0., 10.])
        after = experiment.fit_without_target(rows, prepared, 'holdout', 'adjusted_fit', .02)
        np.testing.assert_array_equal(before, after)

    def test_source_and_set_balancing_limits_repeated_puzzles(self):
        rows = [{'set_id': 'a', 'source': 'one'}] * 4 + [{'set_id': 'a', 'source': 'two'}, {'set_id': 'b', 'source': 'three'}]
        w = experiment.weights(rows)
        self.assertAlmostEqual(w[:5].sum(), .5)
        self.assertAlmostEqual(w[:4].sum(), w[4])


if __name__ == '__main__': unittest.main()
