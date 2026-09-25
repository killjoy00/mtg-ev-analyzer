import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from contextual_value.dataset import Decision
from contextual_value.features import CardSignals, candidate_features
from contextual_value.nuisance import crossfit_nuisance
from contextual_value.propensity import (
    LinearSoftmaxPropensityModel,
    PropensityExample,
    softmax,
    validate_distribution,
)


def decision(
    draft_id: str,
    *,
    selected: str = "A",
    wins: int = 4,
    pick_number: int = 0,
) -> Decision:
    return Decision(
        draft_id=draft_id,
        expansion="TST",
        event_type="PremierDraft",
        draft_time="2026-01-01T00:00:00Z",
        rank="Gold",
        pack_number=0,
        pick_number=pick_number,
        selected_card=selected,
        candidates=("A", "B"),
        pool=(),
        user_game_win_rate=0.55,
        user_games_lower_bound=100,
        event_match_wins=wins,
        event_match_losses=3 if wins < 7 else 0,
    )


class CandidateFeatureTests(unittest.TestCase):
    def test_features_are_pre_treatment_and_candidate_specific(self):
        row = decision("d1")
        a = candidate_features(
            row,
            "A",
            CardSignals(
                strong_choice_probability=0.7,
                gih_wr=0.58,
                gnd_wr=0.52,
                iwd=0.06,
                gih_games=1000,
                gnd_games=800,
                deck_inclusion_probability=0.75,
            ),
        )
        b = candidate_features(row, "B", CardSignals(strong_choice_probability=0.3))
        self.assertEqual(a["candidate=A"], 1.0)
        self.assertEqual(b["candidate=B"], 1.0)
        self.assertNotIn("event_match_wins", a)
        self.assertNotIn("selected_card", a)
        self.assertAlmostEqual(a["gih_x_deck_probability"], 0.58 * 0.75)

    def test_feature_map_requires_offered_candidate(self):
        with self.assertRaises(ValueError):
            candidate_features(decision("d1"), "C")


class PropensityModelTests(unittest.TestCase):
    def test_softmax_handles_variable_action_sets(self):
        first = softmax({"A": 2.0, "B": 0.0})
        second = softmax({"A": 2.0, "B": 0.0, "C": -1.0})
        validate_distribution(first, ("A", "B"))
        validate_distribution(second, ("A", "B", "C"))
        self.assertGreater(first["A"], first["B"])
        self.assertGreater(second["A"], second["B"])
        self.assertGreater(second["B"], second["C"])

    def test_conditional_logit_learns_observed_choice_signal(self):
        examples = [
            PropensityExample(
                features={"A": {"quality": 1.0}, "B": {"quality": -1.0}},
                selected_action="A",
            )
            for _ in range(80)
        ]
        model = LinearSoftmaxPropensityModel.fit(
            examples,
            l2=0.1,
            learning_rate=0.3,
            epochs=200,
        )
        probabilities = model.probabilities(
            {"A": {"quality": 1.0}, "B": {"quality": -1.0}}
        )
        self.assertGreater(probabilities["A"], 0.85)

    def test_fixed_offset_reproduces_strong_policy_before_correction(self):
        examples = [
            PropensityExample(
                features={"A": {}, "B": {}},
                selected_action="A",
                offsets={"A": math.log(0.8), "B": math.log(0.2)},
            )
        ]
        model = LinearSoftmaxPropensityModel.fit(examples, epochs=5)
        probabilities = model.probabilities(
            {"A": {}, "B": {}},
            {"A": math.log(0.8), "B": math.log(0.2)},
        )
        self.assertAlmostEqual(probabilities["A"], 0.8, places=12)
        self.assertAlmostEqual(probabilities["B"], 0.2, places=12)


class NuisanceCrossFitTests(unittest.TestCase):
    def test_signal_provider_never_sees_the_scored_draft(self):
        rows = [
            decision(
                f"d{index}",
                selected="A" if index % 2 == 0 else "B",
                wins=6 if index % 2 == 0 else 2,
            )
            for index in range(18)
        ]
        calls = []

        def provider(row, training_ids):
            calls.append((row.draft_id, frozenset(training_ids)))
            self.assertNotIn(row.draft_id, training_ids)
            return {
                "A": CardSignals(strong_choice_probability=0.65),
                "B": CardSignals(strong_choice_probability=0.35),
            }

        predictions = crossfit_nuisance(
            rows,
            folds=3,
            inner_feature_folds=3,
            signal_provider=provider,
            propensity_l2=0.5,
            outcome_l2=1.0,
        )
        self.assertEqual(len(predictions), len(rows))
        self.assertEqual(
            {prediction.decision_id for prediction in predictions},
            {row.decision_id for row in rows},
        )
        self.assertTrue(calls)
        for prediction in predictions:
            self.assertEqual(set(prediction.behavior), {"A", "B"})
            self.assertEqual(set(prediction.q_values), {"A", "B"})
            self.assertAlmostEqual(sum(prediction.behavior.values()), 1.0, places=12)
            self.assertGreater(prediction.training_draft_count, 0)

    def test_crossfit_q_uses_factual_selected_action_labels(self):
        rows = []
        for index in range(24):
            selected = "A" if index % 2 == 0 else "B"
            wins = 7 if selected == "A" else 0
            rows.append(decision(f"q{index}", selected=selected, wins=wins))

        predictions = crossfit_nuisance(
            rows,
            folds=4,
            propensity_l2=0.5,
            outcome_l2=0.1,
        )
        margins = [
            prediction.q_values["A"] - prediction.q_values["B"]
            for prediction in predictions
        ]
        self.assertGreater(sum(margins) / len(margins), 2.0)

    def test_crossfit_is_deterministic(self):
        rows = [
            decision(
                f"x{index}",
                selected="A" if index % 3 else "B",
                wins=index % 8,
            )
            for index in range(16)
        ]
        first = crossfit_nuisance(rows, folds=4)
        second = crossfit_nuisance(rows, folds=4)
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
