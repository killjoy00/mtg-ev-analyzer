import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from grading_curve import (
    SCORE_CAP,
    auc,
    band_of,
    cohen_d,
    curve_score,
    interval,
    js_round,
    paired_auc_delta,
)


class CurveTests(unittest.TestCase):
    def test_exponent_one_reproduces_production(self):
        self.assertEqual(SCORE_CAP, 95)
        self.assertEqual(curve_score(1.0, 1.0), 95)
        self.assertEqual(curve_score(0.7, 1.0), 67)
        self.assertEqual(curve_score(0.5, 1.0), 48)

    def test_rounding_follows_javascript(self):
        # 95 * 0.7 is 66.5: Math.round gives 67, Python's round() gives 66.
        self.assertEqual(js_round(66.5), 67)
        self.assertEqual(js_round(-0.5), 0)

    def test_higher_exponent_is_harsher_everywhere_below_the_leader(self):
        for ratio in (0.2, 0.5, 0.8, 0.95):
            self.assertLess(curve_score(ratio, 2.0), curve_score(ratio, 1.0))
            self.assertGreater(curve_score(ratio, 0.5), curve_score(ratio, 1.0))
        # A card level with the leader is fixed at the cap for every exponent.
        for exponent in (0.5, 1.0, 2.0, 3.0):
            self.assertEqual(curve_score(1.0, exponent), 95)

    def test_a_sharpened_model_cancels_against_a_halved_exponent(self):
        # Sharpening supports by T squares the ratio; scoring that with 1/T
        # restores exactly today's award. This is why honest probabilities and
        # unchanged scores are compatible.
        for ratio in (0.15, 0.4, 0.62, 0.9):
            self.assertEqual(curve_score(ratio ** 2.0, 0.5), curve_score(ratio, 1.0))

    def test_ratio_is_clamped(self):
        self.assertEqual(curve_score(1.8, 2.0), 95)
        self.assertEqual(curve_score(-1.0, 1.0), 0)


class BandTests(unittest.TestCase):
    def test_bands_cover_the_range(self):
        self.assertEqual(band_of(1.0), "0.85-1.00")
        self.assertEqual(band_of(0.9), "0.85-1.00")
        self.assertEqual(band_of(0.7), "0.70-0.85")
        self.assertEqual(band_of(0.5), "0.50-0.70")
        self.assertEqual(band_of(0.3), "0.30-0.50")
        self.assertEqual(band_of(0.15), "0.15-0.30")
        self.assertEqual(band_of(0.0), "0.00-0.15")


class SeparationTests(unittest.TestCase):
    def test_auc_of_perfectly_separated_groups(self):
        self.assertEqual(auc([5, 6, 7], [1, 2, 3]), 1.0)
        self.assertEqual(auc([1, 2, 3], [5, 6, 7]), 0.0)

    def test_auc_of_identical_groups_is_a_coin_flip(self):
        self.assertAlmostEqual(auc([1, 2, 3], [1, 2, 3]), 0.5)

    def test_auc_handles_ties_as_half(self):
        self.assertAlmostEqual(auc([1], [1]), 0.5)
        self.assertAlmostEqual(auc([2, 1], [1, 0]), 0.875)

    def test_auc_is_invariant_to_a_monotone_rescaling(self):
        # The point of using a rank statistic: rescaling one score cannot move
        # it, so any AUC change across exponents is real reordering.
        a = [0.9, 0.6, 0.4]
        b = [0.7, 0.3, 0.2]
        plain = auc(a, b)
        squared = auc([x ** 2 for x in a], [x ** 2 for x in b])
        self.assertAlmostEqual(plain, squared)

    def test_cohens_d_sign_and_scale(self):
        self.assertGreater(cohen_d([10, 11, 12], [1, 2, 3]), 2)
        self.assertLess(cohen_d([1, 2, 3], [10, 11, 12]), -2)
        self.assertTrue(math.isnan(cohen_d([1], [2])))

    def test_paired_delta_is_zero_against_itself(self):
        elite = {1.0: [3.0, 4.0, 5.0], 2.0: [3.0, 4.0, 5.0]}
        control = {1.0: [1.0, 2.0, 3.0], 2.0: [1.0, 2.0, 3.0]}
        result = paired_auc_delta(elite, control, [1.0, 2.0], 1.0, draws=50)
        self.assertEqual(result[1.0]["delta"], 0.0)
        self.assertEqual(result[2.0]["delta"], 0.0)

    def test_paired_delta_detects_a_worse_ordering(self):
        # Under exponent 2.0 the groups overlap completely; under 1.0 they do not.
        elite = {1.0: [9.0, 8.0, 7.0], 2.0: [1.0, 5.0, 9.0]}
        control = {1.0: [3.0, 2.0, 1.0], 2.0: [2.0, 6.0, 8.0]}
        result = paired_auc_delta(elite, control, [1.0, 2.0], 1.0, draws=100)
        self.assertLess(result[2.0]["delta"], 0)


class IntervalTests(unittest.TestCase):
    def test_interval_brackets_the_bulk(self):
        low, high = interval(list(range(1000)))
        self.assertLessEqual(low, 40)
        self.assertGreaterEqual(high, 960)

    def test_interval_precision_is_configurable(self):
        values = [0.001234, 0.004321] * 100
        self.assertEqual(interval(values), [0.001, 0.004])
        self.assertEqual(interval(values, 5), [0.00123, 0.00432])


if __name__ == "__main__":
    unittest.main()
