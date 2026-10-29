"""Synthetic witnesses for known frozen-v5 limitations; no customer fixtures.

Tests of old behavior are diagnostic contracts, not endorsements. A separately
versioned replacement must pass improved expectations before promotion.
"""
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from audit_context_representation import audit_fits, summarize_copy_observations
from build_replays import CountStore, OutOfFoldModel, PickExample
from deck_fit import commitment, observe_examples
from eval_model import VARIANTS, VariantModel
from rules_mana_context import card_mana_context


def simple_card(cost, **fields):
    return {'layout': 'normal', 'mana_cost': cost, 'type_line': 'Creature', **fields}


class ContextAuditTests(unittest.TestCase):
    def test_zero_cell_exposes_frozen_builder_harness_divergence(self):
        fit = {'cards': {'Blue': {'colours': 'U'}, 'Red': {'colours': 'R'}},
               'by_stage': {'s3-5': {'0': 0.0, '*': .5}},
               'by_commitment': {'0': .3}, 'play_rate': .5}
        counts = CountStore.empty()
        production = OutOfFoldModel(counts, CountStore.empty(), fit)
        harness = VariantModel(counts, VARIANTS['v3-colour-and-pair'], fit=fit)
        self.assertEqual(production.fit_shift('Blue', {'Red': 4}), 0)
        self.assertAlmostEqual(harness.fit_shift('Blue', {'Red': 4}), math.log(1e-6 / (1-1e-6)))
        # Missing really is absent evidence, and correctly falls back.
        fit['by_stage']['s3-5']['0'] = None
        self.assertAlmostEqual(production.fit_shift('Blue', {'Red': 4}),
                               harness.fit_shift('Blue', {'Red': 4}))

    def test_fixing_colors_are_invisible_to_old_commitment(self):
        colors = {'Black': frozenset('B'), 'BG land': frozenset(), 'RW land': frozenset()}
        self.assertEqual(commitment({'Black': 4}, colors, 'BG land'), 4)
        self.assertEqual(commitment({'Black': 4}, colors, 'RW land'), 4)
        self.assertEqual(commitment({'BG land': 4}, colors, 'Black'), 0)
        self.assertEqual(commitment({'RW land': 4}, colors, 'Black'), 0)
        land = simple_card('', type_line='Land', produced_mana=['B', 'G'])
        self.assertEqual(card_mana_context(land)['produced_mana'], ['B', 'G'])

    def test_one_supported_color_and_pip_intensity_are_collapsed(self):
        colors = {'Black': frozenset('B'), 'Gold': frozenset('BR'), 'Triple': frozenset('B')}
        pool = {'Black': 4}
        self.assertEqual(commitment(pool, colors, 'Gold'), commitment(pool, colors, 'Black'))
        self.assertEqual(commitment(pool, colors, 'Triple'), commitment(pool, colors, 'Black'))
        self.assertEqual(card_mana_context(simple_card('{B}{B}{B}'))['cast']['colored_pips'], {'B': 3})

    def test_three_copies_one_in_deck_gives_three_positive_name_labels(self):
        examples = [('draft', PickExample('draft', 0, i, 'Repeat', ['Repeat'], {'Repeat': i}))
                    for i in range(3)]
        _, by_card, _ = observe_examples(examples, {'draft': {'Repeat'}}, {'Repeat': frozenset('B')})
        self.assertEqual(by_card['Repeat'], [1, 1, 1])
        result = summarize_copy_observations({'draft': {'Repeat': 3}}, {'draft': {'Repeat': 1}})
        self.assertEqual(result['groups_with_fewer_observed_deck_copies'], 1)
        self.assertEqual(result['copies_above_maximum_observed_deck_count'], 2)

    def test_missing_games_and_fully_used_copies_are_not_counted_as_copy_gaps(self):
        result = summarize_copy_observations({'missing': {'X': 3}, 'seen': {'X': 2, 'Cut': 3}},
                                             {'seen': {'X': 2}})
        self.assertEqual(result['drafts_with_game_observations'], 1)
        self.assertEqual(result['repeated_card_draft_groups'], 2)
        self.assertEqual(result['repeated_groups_ever_played'], 1)
        self.assertEqual(result['groups_with_fewer_observed_deck_copies'], 0)

    def test_metadata_unknowns_are_separate_from_affinity_discrepancies(self):
        metadata = {'Gold': simple_card('{B}{R}'), 'Flexible': simple_card('{U}'),
                    'Unknown': simple_card('{W}'), 'Modal': simple_card('{R}', layout='adventure')}
        fit = {'holdout_fold': 0, 'cards': {name: {'colours': color} for name, color in
               [('Gold', 'B'), ('Flexible', 'C'), ('Unknown', '?'), ('Modal', 'C'), ('Missing', 'C')]},
               'by_stage': {'s3-5': {'0': 0.0, '*': .5}}, 'by_commitment': {'0': None}, 'play_rate': .5}
        result = audit_fits([fit, {**fit, 'holdout_fold': 1}], metadata)
        self.assertEqual(result['distinct_cards_with_required_color_omitted'], 2)
        fold = result['folds'][0]
        self.assertEqual(fold['unsupported_or_missing_metadata'], 2)
        self.assertEqual(fold['known_simple_colored_spells'], 3)
        self.assertEqual(fold['unknown_affinity'], 1)
        self.assertEqual(fold['required_color_omitted'], 2)
        self.assertEqual(fold['zero_stage_cells'], 1)
        self.assertEqual(fold['zero_marginal_cells'], 0)


if __name__ == '__main__':
    unittest.main()
