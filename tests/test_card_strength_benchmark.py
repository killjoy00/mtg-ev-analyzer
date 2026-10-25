"""Small scientific benchmark contracts; install research requirements to run."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
AVAILABLE = all(importlib.util.find_spec(m) for m in ('numpy', 'scipy', 'pandas', 'sklearn'))
if AVAILABLE:
    import numpy as np
    import pandas as pd
    from scipy import sparse
    import card_strength_benchmark as b
    from card_outcomes import summarise


@unittest.skipUnless(AVAILABLE, 'optional scientific research dependencies not installed')
class StrengthBenchmarkTests(unittest.TestCase):
    def test_same_source_draft_never_crosses_chronological_boundary(self):
        draft = np.repeat(np.arange(20), 2)
        times = np.arange(40, dtype=np.int64)
        # Draft 3 persists into the assessment period, so it must be purged.
        times[7] = 39
        protocol = {'train_fraction': .6, 'validation_fraction': .2,
                    'minimum_training_drafts': 1, 'minimum_validation_drafts': 1,
                    'minimum_test_drafts': 1}
        tr, va, te = b.partitions(draft, times, protocol)
        self.assertNotIn(3, tr)
        self.assertFalse(set(tr) & set(va) or set(va) & set(te) or set(tr) & set(te))
        self.assertLess(times[np.isin(draft, tr)].max(), times[np.isin(draft, va)].min())
        self.assertLess(times[np.isin(draft, va)].max(), times[np.isin(draft, te)].min())

    def test_unparseable_outcome_is_not_a_loss(self):
        value, valid = b.parse_bool(pd.Series(['True', '0', 'junk', None, 'false']))
        np.testing.assert_array_equal(valid, [True, True, False, False, True])
        np.testing.assert_array_equal(value[valid], [True, False, False])

    def test_outcome_estimators_match_existing_game_level_statistics(self):
        y = np.array([1, 1, 0, 0, 1, 0, 1, 0.])
        deck = sparse.csr_matrix(np.array([[1, 1, 0]] * 8, dtype=float))
        hand = sparse.csr_matrix([[1, 0, 0], [1, 0, 0], [0, 1, 0], [0, 1, 0],
                                 [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 0.]])
        norm, raw, nd, nh, base = b.estimate_strengths(deck, hand, np.zeros((8, 2)), y, 400, .1)
        stats = summarise({'Strong': {'gih_games': 4, 'gih_wins': 4, 'gnd_games': 4,
                                     'gnd_wins': 0, 'deck_games': 8, 'deck_wins': 4}}, 8, 4)['cards']['Strong']
        self.assertAlmostEqual(raw['A_gih'][0] + base, stats['gih_wr_shrunk'], places=5)
        self.assertAlmostEqual(raw['B_iwd'][0], stats['iwd_shrunk'], places=5)
        self.assertGreater(norm['A_gih'][0], norm['A_gih'][1])
        for name in b.MODELS:
            self.assertEqual(norm[name][2], 0)  # unobserved is explicitly neutral

    def test_strong_and_weak_packs_do_not_get_same_absolute_strength(self):
        scores = np.array([1.5, 1.4, -1.4, -1.5])
        packs = sparse.csr_matrix([[1, 1, 0, 0], [0, 0, 1, 1]])
        values = b.mean_strength(packs, scores)
        self.assertGreater(values[0], 1)
        self.assertLess(values[1], -1)

    def test_parser_accounts_for_invalid_and_duplicate_games(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows = []
            for i in range(5):
                rows.append({'draft_id': f'd{i}', 'game_time': f'2026-01-01 00:00:0{i}',
                             'won': 'True' if i % 2 else 'False', 'on_play': 'True', 'num_mulligans': '0',
                             'deck_Plains': 39, 'deck_Alpha': 1,
                             'opening_hand_Plains': 6, 'opening_hand_Alpha': 1,
                             'drawn_Plains': 0, 'drawn_Alpha': 0})
            rows[1]['won'] = 'not-an-outcome'
            rows[2]['deck_Alpha'] = -1
            rows.append(dict(rows[3]))
            path = root / 'test.csv.gz'
            pd.DataFrame(rows).to_csv(path, index=False, compression='gzip')
            info = b.prepare_one('test', path, root / 'cache', {'sha256': b.sha256(path)})
            self.assertEqual(info['raw_games'], 6)
            self.assertEqual(info['invalid_games'], 2)
            self.assertEqual(info['duplicate_games_excluded'], 2)
            self.assertEqual(info['games'], 2)
            self.assertEqual(info['cards'], ['Alpha'])
            self.assertTrue(b.cache_valid(root / 'cache/test', info['array_sha256']))
            (root / 'cache/test-hand.npz').write_bytes(b'incomplete archive')
            self.assertFalse(b.cache_valid(root / 'cache/test', info['array_sha256']))
            rebuilt = b.prepare_one('test', path, root / 'cache', {'sha256': b.sha256(path)})
            self.assertEqual(rebuilt['games'], 2)
            self.assertTrue(b.cache_valid(root / 'cache/test', rebuilt['array_sha256']))

    def test_target_validation_and_assessment_labels_cannot_affect_predictions(self):
        rng = np.random.default_rng(4)
        features = {}
        for sid in ['a', 'b', 'c']:
            features[sid] = {'all': {}}
            for part in ['validation', 'test']:
                n = 30
                features[sid]['all'][part] = {
                    'x': rng.normal(size=(n, 3)), 'strength': rng.normal(size=(n, 3)),
                    'opening': rng.normal(size=(n, 3)), 'y': np.tile([0., 1.], 15),
                    'draft': np.repeat(np.arange(10), 3)}
        protocol = {'sets': ['a', 'b', 'c'], 'draft_budgets': [None], 'calibration_C': 1.}
        before = b.calibrate_and_predict(features, protocol)['a']['all']
        features['a']['all']['validation']['y'][:] = 1
        features['a']['all']['test']['y'][:] = 0
        after = b.calibrate_and_predict(features, protocol)['a']['all']
        for name in before:
            np.testing.assert_array_equal(before[name], after[name])

    def test_paired_bootstrap_preserves_model_differences(self):
        rng = np.random.default_rng(4)
        sets = []
        for n in [15, 20, 30]:
            values = rng.normal(size=(n, 3, 1))
            sets.append(np.concatenate([values, values - .2], axis=2))
        boot = b.bootstrap(sets, 100, 4)
        np.testing.assert_allclose(boot[:, 0] - boot[:, 1], .2)

    def test_no_forced_superiority_when_bootstrap_does_not_separate(self):
        rng = np.random.default_rng(1)
        boot = rng.normal(.68, .01, size=(1000, 4))
        result = b.choose_winner({'baseline': .68, 'A_gih': .68, 'B_iwd': .679, 'C_adjusted': .678}, boot)
        self.assertEqual(result['empirical_leader'], 'C_adjusted')
        self.assertEqual(result['operational_recommendation'], 'A_gih')
        self.assertIsNone(result['demonstrated_winner'])

    def test_repeated_set_draw_uses_independent_draft_resamples(self):
        values = np.array([0., 2.]).reshape(2, 1, 1)
        boot = b.bootstrap([values, values], 8000, 9)
        # Four independent draws from {0, 2} have mean variance 1 / 4.
        self.assertAlmostEqual(float(boot.var()), .25, delta=.03)


if __name__ == '__main__':
    unittest.main()
