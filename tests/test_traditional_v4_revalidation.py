from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_replays
import traditional_phase2 as historical
import traditional_v4_revalidation as current
from traditional_puzzles import THRESHOLDS


class TraditionalV4RevalidationTests(unittest.TestCase):
    def test_scope_and_historical_exclusions_are_frozen(self):
        self.assertEqual(len(current.SETS), 27)
        self.assertEqual(
            set(current.EXCLUSIONS),
            {"tmt", "ecl", "tla", "mid", "vow", "stx"},
        )
        self.assertEqual(current.serving_window(current.CUBE), (2, 9))
        self.assertEqual(current.late_floor(current.CUBE), 8)

    def test_v4_identity_is_distinct_from_readable_v3_history(self):
        self.assertEqual(build_replays.MODEL_VERSION, "strong-player-colour-stage-v3")
        self.assertEqual(
            build_replays.ISOLATED_MODEL_VERSION,
            "strong-player-colour-stage-v4",
        )
        self.assertEqual(historical.COMPONENT, "traditional-premier-v3-phase2-v1")
        self.assertEqual(current.COMPONENT, "traditional-premier-v4-phase2-v1")
        self.assertEqual(current.PARENT, "elite-trophy-colour-stage-v8")
        self.assertEqual(current.MODEL, build_replays.ISOLATED_MODEL_VERSION)
        self.assertNotEqual(historical.COMPONENT, current.COMPONENT)

    def test_frozen_gates_are_not_redeclared_or_relaxed(self):
        self.assertEqual(
            THRESHOLDS,
            {
                "minimum_trajectories_each": 100,
                "minimum_sets": 3,
                "absolute_ece_max": .15,
                "ece_increase_max": .04,
                "disagreement_increase_max": .10,
                "low_support_increase_max": .03,
                "mean_support_score_drop_max": 8,
                "alternative_low_increase_max": .05,
                "alternative_95_shift_max": .05,
                "difficulty_total_variation_max": .15,
                "unusable_trajectory_fraction_max": .05,
            },
        )
        source = (ROOT / "scripts" / "traditional_v4_revalidation.py").read_text()
        self.assertIn("from traditional_puzzles import THRESHOLDS, compare, record", source)

    def test_revalidation_cannot_use_legacy_shared_v3_builder(self):
        source = (ROOT / "scripts" / "traditional_v4_revalidation.py").read_text()
        self.assertNotIn("collect_legacy_v3", source)
        self.assertNotIn("build_colour_table(", source)
        self.assertIn("collect_isolated", source)
        self.assertIn("build_colour_tables_by_fold", source)
        self.assertIn("CountStore.empty()", source)

    def test_traditional_source_is_rejected_if_it_reaches_premier_training(self):
        class Fold:
            def __init__(self):
                self.training_ids = frozenset({"collision"})
                self.held_out_ids = frozenset()

        built = {
            "training": {"collision"},
            "fold_training": [Fold(), Fold(), Fold(), Fold(), Fold()],
            "models": [object(), object(), object(), object(), object()],
        }
        with self.assertRaisesRegex(AssertionError, "Traditional source ID collides"):
            current.grader_for("TradDraft", "collision", built)

    def test_candidate_identity_cannot_relabel_v3_as_v4(self):
        self.assertEqual(current.PREVIOUS_MODEL, "strong-player-colour-stage-v3")
        self.assertEqual(current.MODEL, "strong-player-colour-stage-v4")
        self.assertEqual(current.CUBE_COMPONENT, "traditional-cube-p2p7-v4-v1")
        self.assertNotIn("-v3-", current.COMPONENT)
        self.assertNotIn("-v3-", current.CUBE_COMPONENT)

    def test_format_training_audit_is_disjoint(self):
        audit = current.format_training_audit()
        self.assertTrue(audit["valid_despite_issue_164"], audit)
        self.assertFalse(audit["rerun_required"])
        self.assertTrue(all(audit["checks"].values()))


if __name__ == "__main__":
    unittest.main()
