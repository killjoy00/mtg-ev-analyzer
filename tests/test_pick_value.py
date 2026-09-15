import gzip
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_replays import CountStore, PickExample
from eval_model import VARIANTS, VariantModel
from pick_value import (
    OutcomeAxis,
    decision_values,
    draft_results,
    pearson,
    pool_fisher,
    standardise,
    stratum_correlations,
)


def example(draft_id, pack, pick, chosen, candidates, pool=None):
    return PickExample(draft_id, pack, pick, chosen, list(candidates), dict(pool or {}))


class StandardiseTests(unittest.TestCase):
    def test_z_scores_have_zero_mean(self):
        values = standardise([1.0, 2.0, 3.0, 10.0])
        self.assertAlmostEqual(sum(values), 0.0)
        self.assertGreater(values[3], values[0])

    def test_a_flat_pack_contributes_nothing(self):
        self.assertEqual(standardise([4.0, 4.0, 4.0]), [0.0, 0.0, 0.0])

    def test_a_single_card_contributes_nothing(self):
        self.assertEqual(standardise([1.0]), [0.0])


class BlendTests(unittest.TestCase):
    def model(self):
        counts = CountStore.empty()
        # "popular" is taken far more often than "unpopular" at this position.
        for index in range(100):
            counts.observe(example(f"d{index}", 0, 0,
                                   "popular" if index % 10 else "unpopular",
                                   ["popular", "unpopular"]))
        return VariantModel(counts, VARIANTS["v2"])

    def test_weight_zero_follows_behaviour_only(self):
        model = self.model()
        # The outcome signal says the opposite of the behaviour signal.
        outcome = OutcomeAxis({"popular": -0.05, "unpopular": +0.05})
        item = example("x", 0, 0, "unpopular", ["popular", "unpopular"])
        values = decision_values(model, item, outcome, [0.0, 1.0])
        taken_behaviour, best_behaviour = values[0.0]
        # Behaviour prefers "popular", so taking "unpopular" gives value up.
        self.assertLess(taken_behaviour, best_behaviour)
        taken_outcome, best_outcome = values[1.0]
        # Outcome prefers "unpopular", so the same pick now gives up nothing.
        self.assertAlmostEqual(taken_outcome, best_outcome)

    def test_a_card_with_no_outcome_measure_sits_at_the_axis_mean(self):
        model = self.model()
        outcome = OutcomeAxis({"popular": 0.04, "unpopular": -0.04})
        item = example("x", 0, 0, "popular", ["popular", "unpopular", "unmeasured"])
        values = decision_values(model, item, outcome, [1.0])
        self.assertIsNotNone(values)

    def test_a_decision_with_too_little_outcome_evidence_is_skipped(self):
        model = self.model()
        item = example("x", 0, 0, "popular", ["popular", "unpopular"])
        self.assertIsNone(decision_values(model, item, OutcomeAxis({"popular": 0.01}), [0.5]))

    def test_a_one_card_pack_is_skipped(self):
        model = self.model()
        self.assertIsNone(decision_values(model, example("x", 0, 0, "popular", ["popular"]),
                                          OutcomeAxis({"popular": 0.01}), [0.5]))


class OutcomeAxisTests(unittest.TestCase):
    def fit(self):
        return {"grand_play_rate": 0.6, "cards": {
            "red": {"play_rate": 0.6, "colours": "R",
                    "by_commitment": {"0": 0.2, "1-2": 0.5, "3-5": 0.7, "6-9": 0.85, "10+": 0.95}},
            "land": {"play_rate": 0.9, "colours": "C",
                     "by_commitment": {"0": 0.9, "1-2": 0.9, "3-5": 0.9, "6-9": 0.9, "10+": 0.9}},
        }}

    def test_raw_axis_ignores_the_pool(self):
        axis = OutcomeAxis({"red": 0.05})
        self.assertFalse(axis.context_aware)
        self.assertEqual(axis.value("red", {}), 0.05)
        self.assertEqual(axis.value("red", {"red": 8}), 0.05)

    def test_pool_aware_axis_rises_with_commitment(self):
        axis = OutcomeAxis({"red": 0.05}, self.fit())
        self.assertTrue(axis.context_aware)
        empty = axis.value("red", {})
        committed = axis.value("red", {"red": 12})
        self.assertLess(empty, committed)
        # A bomb you cannot cast keeps only a fraction of its measured impact.
        self.assertAlmostEqual(empty, 0.2 * 0.05)
        self.assertAlmostEqual(committed, 0.95 * 0.05)

    def test_a_weak_card_you_will_certainly_play_stays_negative(self):
        axis = OutcomeAxis({"red": -0.04}, self.fit())
        self.assertLess(axis.value("red", {"red": 12}), axis.value("red", {}))

    def test_a_colourless_card_is_playable_from_any_pool(self):
        axis = OutcomeAxis({"land": 0.01}, self.fit())
        # Its commitment counts the whole pool, so an off-colour pool does not
        # push it down the way it would a coloured card.
        self.assertAlmostEqual(axis.value("land", {"red": 12}), 0.9 * 0.01)

    def test_an_unmeasured_card_has_no_value_on_this_axis(self):
        axis = OutcomeAxis({"red": 0.05}, self.fit())
        self.assertIsNone(axis.value("missing", {}))


class CorrelationTests(unittest.TestCase):
    def test_pearson_endpoints(self):
        self.assertAlmostEqual(pearson([1, 2, 3], [2, 4, 6]), 1.0)
        self.assertAlmostEqual(pearson([1, 2, 3], [6, 4, 2]), -1.0)
        self.assertIsNone(pearson([1, 1, 1], [1, 2, 3]))
        self.assertIsNone(pearson([1], [1]))

    def rows(self, skill_offsets):
        """(skill, regret, wins) with a negative relationship inside each bucket."""
        rows = []
        for skill, regret_base, wins_base in skill_offsets:
            for index in range(400):
                jitter = ((index * 37) % 11) * 0.02
                rows.append((skill, regret_base + 0.001 * (index % 20),
                             wins_base - (index % 20) * 0.1 + jitter))
        return rows

    def test_stratifying_reverses_a_confounded_correlation(self):
        """Strong players pick well AND win, so the raw correlation misleads.

        Here the strong bucket sits at higher regret and also wins far more, so
        pooling everything together says higher regret means more wins. Within
        each bucket the truth is the opposite, and only the stratified estimate
        recovers it.
        """
        rows = self.rows([("0.62", 0.50, 6.0), ("0.48", 0.10, 2.0)])
        naive = pearson([r[1] for r in rows], [r[2] for r in rows])
        self.assertGreater(naive, 0.9)

        pooled = pool_fisher(stratum_correlations(rows, minimum_bucket=50))
        self.assertIsNotNone(pooled)
        self.assertLess(pooled["r"], -0.9)
        self.assertEqual(pooled["strata"], 2)

    def test_small_strata_are_dropped(self):
        rows = [("0.5", float(i), float(i)) for i in range(10)]
        self.assertEqual(stratum_correlations(rows, minimum_bucket=50), [])
        self.assertIsNone(pool_fisher([]))

    def test_pooling_combines_sets_into_one_answer(self):
        """A stratum per (set, bucket): sets that disagree average, not fight.

        One set says -0.4, another +0.2, with the first carrying four times the
        drafts. The pooled answer sits between them, nearer the larger set.
        """
        pooled = pool_fisher([(-0.4, 4000), (0.2, 1000)])
        self.assertIsNotNone(pooled)
        self.assertLess(pooled["r"], -0.1)
        self.assertGreater(pooled["r"], -0.4)
        self.assertEqual(pooled["drafts"], 5000)
        self.assertEqual(pooled["strata"], 2)

    def test_larger_strata_pull_harder(self):
        mostly_negative = pool_fisher([(-0.4, 9000), (0.2, 1000)])["r"]
        balanced = pool_fisher([(-0.4, 5000), (0.2, 5000)])["r"]
        self.assertLess(mostly_negative, balanced)

    def test_degenerate_strata_are_ignored(self):
        # |r| = 1 has no Fisher transform, and a stratum of three has no weight.
        self.assertIsNone(pool_fisher([(1.0, 100)]))
        self.assertIsNone(pool_fisher([(-0.5, 3)]))
        # A usable stratum alongside a degenerate one still pools.
        self.assertIsNotNone(pool_fisher([(1.0, 100), (-0.3, 500)]))


class DraftResultTests(unittest.TestCase):
    def test_reads_one_row_per_draft(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "d.csv.gz"
            with gzip.open(path, "wt", encoding="utf-8", newline="") as handle:
                handle.write("draft_id,event_match_wins,user_game_win_rate_bucket,pick\n")
                handle.write("a,7,0.62,Card\n")
                handle.write("a,7,0.62,Card\n")
                handle.write("b,3,0.48,Card\n")
            results = draft_results(path)
        self.assertEqual(len(results), 2)
        self.assertEqual(results["a"], {"wins": 7, "skill": "0.62"})
        self.assertEqual(results["b"]["wins"], 3)

    def test_missing_columns_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "d.csv.gz"
            with gzip.open(path, "wt", encoding="utf-8", newline="") as handle:
                handle.write("draft_id,pick\na,Card\n")
            with self.assertRaises(ValueError):
                draft_results(path)


if __name__ == "__main__":
    unittest.main()
