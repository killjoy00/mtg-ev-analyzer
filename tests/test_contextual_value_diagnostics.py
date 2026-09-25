import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from contextual_value.dataset import Decision
from contextual_value.diagnostics import (
    outcome_diagnostics,
    paired_dr_delta_ci,
    policy_overlap_diagnostics,
)
from contextual_value.dr import PolicyObservation
from contextual_value.nuisance import NuisancePrediction


def decision(index, *, wins=None):
    return Decision(
        draft_id=f"d{index}",
        expansion="TST",
        event_type="PremierDraft",
        draft_time="2026-01-01T00:00:00Z",
        rank="Gold",
        pack_number=0,
        pick_number=index % 8,
        selected_card="A" if index % 2 == 0 else "B",
        candidates=("A", "B"),
        pool=(),
        user_game_win_rate=0.48 + 0.01 * (index % 14),
        user_games_lower_bound=50 + 100 * (index % 6),
        event_match_wins=(index % 8 if wins is None else wins),
        event_match_losses=3,
    )


class OutcomeDiagnosticsTests(unittest.TestCase):
    def test_observed_action_diagnostics_cover_required_groups(self):
        rows = [decision(index) for index in range(30)]
        predictions = []
        for row in rows:
            predictions.append(NuisancePrediction(
                decision_id=row.decision_id,
                draft_id=row.draft_id,
                fold=0,
                training_draft_count=20,
                behavior={"A": 0.6, "B": 0.4},
                q_values={"A": float(row.event_match_wins) + 0.5, "B": 1.0},
            ))
        report = outcome_diagnostics(rows, predictions)
        self.assertEqual(report["overall"]["n"], 30)
        self.assertGreater(report["overall"]["mae"], 0)
        self.assertTrue(report["calibration_deciles"])
        self.assertIn("TST", report["by_set"])
        self.assertTrue(report["by_pick"])
        self.assertTrue(report["by_skill"])
        self.assertTrue(report["by_experience"])


class PolicyDiagnosticsTests(unittest.TestCase):
    def _observations(self, target_a):
        rows = []
        for index in range(40):
            action = "A" if index % 2 == 0 else "B"
            outcome = 2.0 if action == "A" else 0.0
            rows.append(PolicyObservation(
                action=action,
                outcome=outcome,
                behavior={"A": 0.5, "B": 0.5},
                target={"A": target_a, "B": 1.0 - target_a},
                q_values={"A": 2.0, "B": 0.0},
                cluster=f"d{index}",
            ))
        return rows

    def test_overlap_reports_weights_ess_and_top_candidate_support(self):
        report = policy_overlap_diagnostics(self._observations(0.8))
        self.assertEqual(report["selected_behavior_propensity"]["n"], 40)
        self.assertEqual(report["leader_behavior_support"]["n"], 40)
        self.assertEqual(report["runner_up_behavior_support"]["n"], 40)
        self.assertAlmostEqual(report["cap20"]["ess_ratio"], 0.7352941176470589)
        self.assertEqual(report["candidate_rank_supported_fraction"]["1"], 1.0)

    def test_paired_cluster_bootstrap_preserves_positive_exact_q_delta(self):
        candidate = self._observations(1.0)
        incumbent = self._observations(0.0)
        low, high = paired_dr_delta_ci(
            candidate,
            incumbent,
            replicates=200,
            seed=7,
        )
        self.assertAlmostEqual(low, 2.0, places=12)
        self.assertAlmostEqual(high, 2.0, places=12)


if __name__ == "__main__":
    unittest.main()
