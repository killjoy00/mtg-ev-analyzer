import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import puzzle_quality_v2 as q
from test_puzzle_quality import SCIENTIFIC, fixture

if SCIENTIFIC:
    import puzzle_quality_compare as comparison


def example():
    puzzle, table, _ = fixture()
    protocol = json.loads(q.PROTOCOL.read_text())
    puzzle.update(corpus_version=protocol['corpus_version'], model_version=protocol['model_version'])
    return puzzle, table, protocol


class StrengthSelectionTests(unittest.TestCase):
    def test_weak_close_pack_and_lone_bomb_fail(self):
        puzzle, table, protocol = example()
        for c in table['cards'].values():
            c['C_adjusted_z'] = -1.
        self.assertFalse(q.assess(puzzle, table, protocol)['eligible'])
        table['cards']['a']['C_adjusted_z'] = 4.
        self.assertFalse(q.assess(puzzle, table, protocol)['eligible'])
        table['cards']['b']['C_adjusted_z'] = 2.
        for card, p in zip(puzzle['candidates'], [.98, .01, .01]):
            card['model_probability'] = p
        self.assertFalse(q.assess(puzzle, table, protocol)['eligible'])

    def test_strength_of_weaker_pair_member_controls_score(self):
        puzzle, table, protocol = example()
        table['cards']['a']['C_adjusted_z'] = .8
        table['cards']['b']['C_adjusted_z'] = .2
        low = q.assess(puzzle, table, protocol)
        table['cards']['b']['C_adjusted_z'] = .6
        high = q.assess(puzzle, table, protocol)
        self.assertTrue(low['eligible'] and high['eligible'])
        self.assertGreater(high['quality_score'], low['quality_score'])
        table['cards']['b']['C_adjusted_z'] = 4.
        self.assertEqual(q.assess(puzzle, table, protocol)['quality_score'], .8)

    def test_target_cannot_borrow_strength_from_two_other_cards(self):
        puzzle, table, protocol = example()
        table['cards']['a']['C_adjusted_z'] = -1.
        for card in puzzle['candidates']:
            card['model_probability'] = 1/3
        result = q.assess(puzzle, table, protocol)
        self.assertEqual(result['credible_choices'], 2)
        self.assertIn('historical_target_needs_review', result['reasons'])
        self.assertIsNone(result['quality_score'])

    def test_third_option_does_not_earn_bonus(self):
        puzzle, table, protocol = example()
        two = q.assess(puzzle, table, protocol)
        puzzle['candidates'][2]['model_probability'] = .3
        three = q.assess(puzzle, table, protocol)
        self.assertEqual((two['credible_choices'], three['credible_choices']), (2, 3))
        self.assertEqual(two['quality_score'], three['quality_score'])
        self.assertAlmostEqual(two['pair']['context_support_floor'], three['pair']['context_support_floor'])

    def test_behavior_future_deck_and_predictions_cannot_change_selection(self):
        puzzle, table, protocol = example()
        before = q.assess(puzzle, table, protocol)
        puzzle.update(choices=[{'id': 'a', 'n': 9999}], observed_split=[1, 0, 0],
                      predicted_share=[1, 0, 0], final_deck=['a'], final_wins=7,
                      confidence=1, response_count=9999)
        after = q.assess(puzzle, table, protocol)
        self.assertEqual(before, after)
        first = q.choice_warnings(puzzle, [.001, .998, .001], protocol)
        second = q.choice_warnings(puzzle, [.45, .4, .15], protocol)
        self.assertTrue(first['warnings']); self.assertFalse(second['warnings'])
        self.assertEqual(q.select_portfolio([before], .2), q.select_portfolio([after], .2))

    def test_choice_sidecar_rejects_malformed_probabilities(self):
        puzzle, _, protocol = example()
        for p in ([1, 0], [float('nan'), .5, .5], [-1, 1, 1], [.5, .5, .5]):
            with self.assertRaises(ValueError):
                q.choice_warnings(puzzle, p, protocol)

    def test_committed_pool_can_disqualify_strong_off_colour_option(self):
        puzzle, table, protocol = example()
        self.assertTrue(q.assess(puzzle, table, protocol)['eligible'])
        puzzle['prior_picks'] = [puzzle['candidates'][0]] * 8
        puzzle['pick_number'] = 9
        result = q.assess(puzzle, table, protocol)
        self.assertFalse(result['eligible'])
        self.assertIn('poor_colour_fit', result['cards'][1]['review_reasons'])

    def test_hybrid_payment_is_an_alternative_not_both_colours(self):
        red = {'mana_cost': '{R}', 'type_line': 'Creature'}
        hybrid = {'mana_cost': '{2}{R/G}{R/G}', 'type_line': 'Creature'}
        fits, knowns, unknown, _ = q.pool_fit([hybrid], [red] * 8)
        self.assertEqual((fits, knowns, unknown), ([1.], [True], 0))
        self.assertEqual(q.mana_options({'mana_cost': '{R/P}'}), ([], False))
        self.assertEqual(q.mana_options({'mana_cost': '{2/R}'}), ([], False))
        self.assertEqual(q.mana_options({'mana_cost': '{2}{C}'}), ([], False))

    def test_prior_land_does_not_poison_all_context_or_invent_fixing(self):
        puzzle, table, protocol = example()
        land = {'name': 'Unspecified land', 'type_line': 'Land', 'mana_cost': None}
        puzzle['prior_picks'] = [land]
        puzzle['pick_number'] = 2
        result = q.assess(puzzle, table, protocol)
        self.assertTrue(result['eligible'])
        self.assertIn('prior_land_fixing_not_modeled', result['warnings'])
        puzzle['candidates'][1].update(land)
        result = q.assess(puzzle, table, protocol)
        self.assertFalse(result['eligible'])
        self.assertIn('uncertain_colour_fit', result['cards'][1]['review_reasons'])

    def test_unknown_nonland_prior_cost_remains_review(self):
        puzzle, table, protocol = example()
        puzzle['prior_picks'] = [{'mana_cost': None, 'type_line': 'Creature'}]
        puzzle['pick_number'] = 2
        result = q.assess(puzzle, table, protocol)
        self.assertIn('incomplete_pool_colour_evidence', result['reasons'])

    def test_thin_and_missing_strength_are_not_declared_weak(self):
        puzzle, table, protocol = example()
        del table['cards']['a']
        table['cards']['b']['deck_games'] = 10
        result = q.assess(puzzle, table, protocol)
        self.assertIn('unknown_strength', result['cards'][0]['review_reasons'])
        self.assertNotIn('below_strength_floor', result['cards'][0]['review_reasons'])
        self.assertIn('thin_strength_evidence', result['cards'][1]['review_reasons'])
        self.assertFalse(result['eligible'])

    def test_gih_disagreement_does_not_silently_replace_adjusted_strength(self):
        puzzle, table, protocol = example()
        before = q.assess(puzzle, table, protocol)
        table['cards']['a']['A_gih_z'] = -2.
        after = q.assess(puzzle, table, protocol)
        self.assertEqual(before['quality_score'], after['quality_score'])
        self.assertIn('credible_card_strength_estimators_disagree', after['warnings'])

    def test_source_exclusion_versions_and_removals_are_enforced(self):
        puzzle, table, protocol = example()
        artifact = {'version': protocol['version'], 'use': protocol['use'], 'protocol': protocol,
                    'excluded_sources': {'example': ['source']}}
        result = q.score_artifact([puzzle], {'example': table}, artifact, {'example'})
        self.assertFalse(result['puzzles'][0]['eligible'])
        self.assertEqual(result['portfolio']['selected_puzzle_ids'], [])
        changed = dict(puzzle, source_draft_hash='not-excluded')
        with self.assertRaises(ValueError): q.score_artifact([changed], {'example': table}, artifact, set())
        changed = dict(puzzle, model_version='unsupported')
        with self.assertRaises(ValueError): q.score_artifact([changed], {'example': table}, artifact, set())

    def test_invalid_trajectory_and_format_fail_closed(self):
        puzzle, table, protocol = example()
        with self.assertRaises(ValueError): q.assess(dict(puzzle, pick_number=2), table, protocol)
        with self.assertRaises(ValueError): q.assess(dict(puzzle, source_event_type='TradDraft'), table, protocol)

    def test_portfolio_ranks_strength_before_context_and_preserves_sources(self):
        rows = [{'puzzle_id': str(i), 'set_id': 'x', 'pick_number': 1,
                 'source_draft_hash': 'same' if i in (1, 2) else str(i), 'eligible': True,
                 'quality_score': float(i), 'pair': {'context_support_floor': 1/(i+1)}} for i in range(3)]
        result = q.select_portfolio(rows, 1.)
        self.assertEqual(result['selected_puzzle_ids'], ['2', '0'])
        self.assertEqual(result['strata'][0]['shortfall'], 1)
        self.assertEqual(q.select_portfolio(rows, 1., {('x', 1): 0})['selected_puzzle_ids'], [])
        with self.assertRaises(ValueError): q.select_portfolio(rows + [rows[0]], .2)

    def test_matched_comparison_equalizes_each_stratum_without_repeating_drafts(self):
        rows = [{'puzzle_id': str(i), 'set_id': 'x', 'pick_number': i//3+1,
                 'source_draft_hash': str(i % 3), 'eligible': True, 'quality_score': float(i)} for i in range(6)]
        right = copy.deepcopy(rows)
        right[2]['eligible'] = False
        right[3]['eligible'] = False
        a, b = q.matched_portfolios(rows, right, .67)
        self.assertEqual([s['selected'] for s in a['strata']], [s['selected'] for s in b['strata']])
        for portfolio in (a, b):
            selected = [r for r in rows if r['puzzle_id'] in portfolio['selected_puzzle_ids']]
            self.assertEqual(len(selected), len({r['source_draft_hash'] for r in selected}))


@unittest.skipUnless(SCIENTIFIC, 'optional research dependencies not installed')
class ComparisonTests(unittest.TestCase):
    def test_later_evidence_requires_both_cards_and_distinct_drafts(self):
        puzzle, table, protocol = example()
        row = q.assess(puzzle, table, protocol)
        evidence = {'example': {c: {'gih_z': z, 'hand_games': 1000, 'hand_drafts': 100} for c, z in [('a', 2.), ('b', .5)]}}
        self.assertEqual(comparison.later_pair(row, evidence, protocol), .5)
        evidence['example']['b']['hand_drafts'] = 2
        self.assertIsNone(comparison.later_pair(row, evidence, protocol))
        self.assertEqual(q.assess(puzzle, table, protocol), row)

    def test_zero_choices_with_few_answers_is_not_proof_of_rejection(self):
        self.assertGreater(comparison.wilson(0, 30)[1], .05)
        self.assertLess(comparison.wilson(0, 1000)[1], .05)
        self.assertLess(comparison.wilson(30, 30)[0], .9)
        self.assertGreater(comparison.wilson(1000, 1000)[0], .9)


if __name__ == '__main__':
    unittest.main()
