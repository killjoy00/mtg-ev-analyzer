"""v6 changes only the colour policy; v4 and v5 must behave exactly as published."""
import csv
import math
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import model_training
from build_replays import (CountStore, FoldTrainingData, OutOfFoldModel, PickExample,
                           build_colour_tables_by_fold)
from deck_fit import scan_deck_observations
from eval_model import VARIANTS, VariantModel
from model_training import (V4_MODEL, V5_MODEL, V6_MODEL, V6_CORPUS, colour_policy,
                            training_cap, validate_training_manifest)


def write_games(path, rows, splash_column=True):
    header = ['draft_id', 'main_colors'] + (['splash_colors'] if splash_column else []) + ['deck_Gold', 'deck_Other']
    with path.open('w', newline='') as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        for draft_id, main, splash in rows:
            writer.writerow([draft_id, main] + ([splash] if splash_column else []) + [1, 0])


class V6PolicyTests(unittest.TestCase):
    def test_identity_and_policy(self):
        self.assertEqual(model_training.VERSIONS['v6']['model_version'], V6_MODEL)
        self.assertEqual(colour_policy(V6_MODEL), {'deck_colours': 'main+splash', 'zero_rates_are_data': True})
        for model in (V4_MODEL, V5_MODEL):
            self.assertEqual(colour_policy(model), {'deck_colours': 'main', 'zero_rates_are_data': False})
        served = f"export const DRAFT_RUN_CORPUS_VERSION = '{V6_CORPUS}';"
        with patch.object(Path, 'read_text', return_value=served):
            self.assertEqual(model_training.current_model_version(), V6_MODEL)

    def test_v6_is_uncapped_like_v5(self):
        for cap in (1, 5000, -1):
            with self.assertRaisesRegex(ValueError, 'cap is forbidden'):
                training_cap(V6_MODEL, cap)
        self.assertIsNone(training_cap(V6_MODEL, None))
        uncapped = {'model': {'model_version': V6_MODEL},
                    'cohort': {'training_mode': 'all-qualified', 'training_cap': None,
                               'training_drafts': 10, 'qualified_training_drafts': 10}}
        self.assertTrue(validate_training_manifest(uncapped, V6_MODEL))
        with self.assertRaisesRegex(ValueError, 'Mixed or stale'):
            validate_training_manifest({**uncapped, 'model': {'model_version': V5_MODEL}}, V6_MODEL)
        capped = {**uncapped, 'cohort': {**uncapped['cohort'], 'training_cap': 5000}}
        with self.assertRaisesRegex(ValueError, 'uncapped'):
            validate_training_manifest(capped, V6_MODEL)


class SplashScanTests(unittest.TestCase):
    def test_splash_colours_count_only_when_requested(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'games.csv'
            write_games(path, [('d1', 'WU', 'R'), ('d2', 'B', '')])
            _, main = scan_deck_observations(path)
            _, both = scan_deck_observations(path, deck_colours='main+splash')
            self.assertEqual(main, {'d1': 'WU', 'd2': 'B'})
            self.assertEqual(both, {'d1': 'WUR', 'd2': 'B'})
            write_games(path, [('d1', 'WU', 'R')], splash_column=False)
            self.assertEqual(scan_deck_observations(path)[1], {'d1': 'WU'})
            with self.assertRaisesRegex(ValueError, 'splash_colors'):
                scan_deck_observations(path, deck_colours='main+splash')
            with self.assertRaisesRegex(ValueError, 'unknown deck colour source'):
                scan_deck_observations(path, deck_colours='splash')

    def test_fold_tables_keep_a_splashed_colour_only_under_v6(self):
        # 26 UR decks and 4 U decks splashing R: R misses the 90% main-colour bar.
        rows = [(f'd{i}', 'UR', '') for i in range(26)] + [(f's{i}', 'U', 'R') for i in range(4)]
        ids = frozenset(row[0] for row in rows)
        examples = [(d, PickExample(d, 0, 0, 'Gold', ['Gold', 'Other'], {})) for d in sorted(ids)]
        fold = FoldTrainingData(0, ids, frozenset(), ids, CountStore.empty())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'games.csv'
            write_games(path, rows)
            v5 = build_colour_tables_by_fold(path, examples, [fold], 'tst')[0]
            v6 = build_colour_tables_by_fold(path, examples, [fold], 'tst', 'main+splash')[0]
        self.assertEqual(v5['cards']['Gold']['colours'], 'U')
        self.assertNotIn('deck_colours', v5)
        self.assertEqual(v6['cards']['Gold']['colours'], 'RU')
        self.assertEqual(v6['deck_colours'], 'main+splash')


class ZeroRateTests(unittest.TestCase):
    FIT = {'set_id': 'tst', 'split': 'train', 'play_rate': .5,
           'by_commitment': {'0': .3, '1-2': .45, '3-5': .6},
           'by_stage': {'s3-5': {'*': .5, '0': 0.0, '1-2': .4, '3-5': .7}},
           'cards': {'Blue': {'colours': 'U'}, 'Red': {'colours': 'R'}, 'Signal': {'colours': 'U'}}}

    def counts(self):
        counts = CountStore.empty()
        examples = [PickExample(f'd{i}', 0, 2 + i % 4, 'Blue' if i % 3 else 'Red', ['Blue', 'Red'],
                                {'Signal': 1 + i % 2} if i % 2 else {'Red': 1}) for i in range(40)]
        for example in examples:
            counts.observe(example)
        base = OutOfFoldModel(counts, CountStore.empty())
        for example in examples:
            counts.observe_expected(example, base.base_tendency)
        return counts

    def test_v5_keeps_reading_a_zero_cell_as_missing(self):
        v5 = OutOfFoldModel(CountStore.empty(), CountStore.empty(), self.FIT)
        v6 = OutOfFoldModel(CountStore.empty(), CountStore.empty(), self.FIT, zero_rates_are_data=True)
        self.assertEqual(v5.fit_shift('Blue', {'Red': 4}), 0)
        self.assertAlmostEqual(v6.fit_shift('Blue', {'Red': 4}), math.log(1e-6 / (1 - 1e-6)))

    def test_v6_production_matches_the_harness_including_zero_cells(self):
        counts = self.counts()
        production = OutOfFoldModel(counts, CountStore.empty(), self.FIT, zero_rates_are_data=True)
        harness = VariantModel(counts, VARIANTS['v3-colour-and-pair'], dict(counts.pair_expected), self.FIT)
        pools = [{}, {'Red': 4}, {'Signal': 1}, {'Signal': 2, 'Red': 1}, {'Signal': 3, 'Red': 2}]
        for card in ('Blue', 'Red'):
            for pick in (0, 3, 5):
                for pool in pools:
                    with self.subTest(card=card, pick=pick, pool=tuple(sorted(pool))):
                        self.assertAlmostEqual(production.card_tendency(card, 0, pick, pool),
                                               harness.card_tendency(card, 0, pick, pool), places=12)


if __name__ == '__main__':
    unittest.main()
