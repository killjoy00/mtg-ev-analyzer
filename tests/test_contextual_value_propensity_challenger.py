import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from contextual_value.nuisance import NuisanceTrainingRow
from contextual_value_propensity_challenger import (
    PropensityStandardizer,
    candidate_varying_feature_map,
    challenger_feature_map,
    fit_propensity_standardizer,
)


class PropensityChallengerTests(unittest.TestCase):
    def features(self, skill=0.55, experience=2.0):
        shared = {
            "user_game_win_rate": skill,
            "log1p_user_games": experience,
            "rank=Gold": 1.0,
            "candidate_count": 2.0,
        }
        return {
            "A": {**shared, "log_strong_choice_probability": -0.2, "gih_wr": 0.60, "iwd": 0.04},
            "B": {**shared, "log_strong_choice_probability": -1.2, "gih_wr": 0.52, "iwd": -0.01},
        }

    def test_state_only_terms_are_removed(self):
        mapped = candidate_varying_feature_map(self.features())
        self.assertNotIn("user_game_win_rate", mapped["A"])
        self.assertNotIn("rank=Gold", mapped["A"])
        self.assertIn("gih_wr", mapped["A"])

    def test_skill_interactions_vary(self):
        scaler = PropensityStandardizer(0.50, 0.10, 2.0, 1.0)
        low = challenger_feature_map(self.features(skill=0.45), scaler)
        high = challenger_feature_map(self.features(skill=0.65), scaler)
        self.assertNotEqual(
            low["A"]["skill_x_log_strong_choice_probability"],
            high["A"]["skill_x_log_strong_choice_probability"],
        )

    def test_standardizer_uses_row_weights(self):
        rows = [
            NuisanceTrainingRow("d1:0", "d1", "MSH", self.features(0.40, 1.0), "A", 1.0, None, 3.0),
            NuisanceTrainingRow("d2:0", "d2", "SOS", self.features(0.70, 3.0), "B", 3.0, None, 4.0),
        ]
        scaler = fit_propensity_standardizer(rows)
        self.assertAlmostEqual(scaler.skill_mean, 0.625)
        self.assertAlmostEqual(scaler.experience_mean, 2.5)
        self.assertTrue(math.isfinite(scaler.skill_scale))


if __name__ == "__main__":
    unittest.main()
