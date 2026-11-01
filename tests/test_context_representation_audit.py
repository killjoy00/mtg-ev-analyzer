"""Synthetic witnesses for known frozen-v5 limitations; no customer fixtures.

Tests of old behavior are diagnostic contracts, not endorsements. A separately
versioned replacement must pass improved expectations before promotion.
"""
import csv
import gzip
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from audit_context_representation import (audit_fits, audit_splash_sensitivity, scan_deck_colours,
                                          summarize_copy_observations)
from build_replays import CountStore, OutOfFoldModel, PickExample
from deck_fit import commitment, observe_examples
from eval_model import VARIANTS, VariantModel
from build_rules_context_metadata import encode, select_records
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


    def test_fixing_land_with_one_inferred_color_is_counted(self):
        land = lambda *colors: {'layout': 'normal', 'mana_cost': '', 'type_line': 'Land',
                                'produced_mana': list(colors)}
        metadata = {'Partial': land('W', 'U'), 'Flexible': land('W', 'U'), 'Full': land('W', 'U'),
                    'Thin': land('W', 'U'), 'Island': land('U')}
        fit = {'holdout_fold': 0, 'cards': {name: {'colours': color} for name, color in
               [('Partial', 'U'), ('Flexible', 'C'), ('Full', 'UW'), ('Thin', '?'), ('Island', 'U')]},
               'by_stage': {}, 'by_commitment': {}, 'play_rate': .5}
        fold = audit_fits([fit], metadata)['folds'][0]
        self.assertEqual(fold['fixing_lands'], 4)
        self.assertEqual(fold['fixing_land_partial_affinity'], 1)
        self.assertEqual(fold['fixing_land_flexible_affinity'], 1)
        self.assertEqual(fold['fixing_land_unknown_affinity'], 1)
        self.assertEqual(fold['lands_with_colored_affinity'], 3)
        self.assertEqual(fold['known_simple_colored_spells'], 0)

    def test_splash_colors_restore_a_dropped_printed_color(self):
        # 26 UR decks and 4 U decks splashing R: R misses the 90% main-color bar.
        rows = [(f'd{i}', 'UR', '') for i in range(26)] + [(f's{i}', 'U', 'R') for i in range(4)]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'games.csv.gz'
            with gzip.open(path, 'wt', newline='') as handle:
                writer = csv.writer(handle)
                writer.writerow(['draft_id', 'main_colors', 'splash_colors', 'deck_Gold', 'deck_Other'])
                writer.writerows([*row, 1, 0] for row in rows)
            ids = {row[0] for row in rows}
            played, main, both, games = scan_deck_colours(path, ids)
        self.assertEqual((main['s0'], both['s0']), ('U', 'UR'))
        self.assertEqual(games, {'games': 30, 'games_with_splash': 4})
        fit = {'holdout_fold': 0, 'cards': {'Gold': {'colours': 'U'}}}
        metadata = {'Gold': simple_card('{1}{U}{R}')}
        self.assertEqual(audit_fits([fit], metadata)['folds'][0]['required_color_omitted'], 1)
        result = audit_splash_sensitivity([fit], [ids], played, main, both, metadata)
        self.assertEqual(result['folds'][0]['required_color_omitted'], 0)
        self.assertEqual(result['folds'][0]['known_simple_colored_spells'], 1)
        # The recount refuses to run if it no longer matches the production fit.
        with self.assertRaises(ValueError):
            audit_splash_sensitivity([{**fit, 'cards': {'Gold': {'colours': 'UR'}}}],
                                     [ids], played, main, both, metadata)

    def test_rules_metadata_snapshot_is_deterministic_and_keyed_by_alias(self):
        def printing(card_id, set_code, promo=False, **fields):
            return {'id': card_id, 'name': 'Gold', 'set': set_code, 'lang': 'en', 'promo': promo,
                    'layout': 'normal', 'mana_cost': '{1}{U}{R}', 'type_line': 'Instant',
                    'image_uris': {'normal': f'https://example.test/{card_id}.jpg'},
                    'prices': {'usd': '1.00'}, **fields}
        records = select_records([printing('promo', 'fra', promo=True), printing('base', 'fra')], 'fra')
        self.assertEqual(records, {'Gold': {'id': 'base', 'layout': 'normal', 'mana_cost': '{1}{U}{R}',
                                            'name': 'Gold', 'type_line': 'Instant'}})
        self.assertEqual(encode(records), encode(json.loads(json.dumps(records))))
        self.assertEqual(json.loads(gzip.decompress(encode(records))), records)


if __name__ == '__main__':
    unittest.main()
