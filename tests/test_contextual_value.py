import csv
import gzip
import json
import math
import sys
import tempfile
import unittest
from collections import Counter
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from contextual_value.dataset import (
    choose_primary_decision,
    draft_split,
    expand_candidates,
    normalized_draft_weights,
    parse_decision,
)
from contextual_value.dr import PolicyObservation, aipw_candidate_values, evaluate_policy
from contextual_value.evaluate import REQUIRED_ABLATIONS, compare_policies
from contextual_value.features import validate_feature_map
from contextual_value.nuisance import (
    build_fold_training_rows,
    crossfit_nuisance,
    crossfit_nuisance_fold,
    fit_fold_from_training_rows,
    nuisance_fold,
    predict_fold,
)
from contextual_value.outcome import RidgeOutcomeModel
from contextual_value.propensity import softmax, support_threshold, validate_distribution
from contextual_value.schema import inspect_archive, validate_header
from contextual_value.uncertainty import cluster_bootstrap
from contextual_value_experiment import protocol


DRAFT_HEADER = [
    "expansion", "event_type", "draft_id", "draft_time", "rank",
    "event_match_wins", "event_match_losses", "pack_number", "pick_number",
    "pick", "user_n_games_bucket", "user_game_win_rate_bucket",
    "pack_card_A", "pack_card_B", "pool_A", "pool_B",
]


def row(draft_id="d1", pick="A", pick_number="0", wins="5", expansion="TST"):
    values = [
        expansion, "PremierDraft", draft_id, "2026-09-01T00:00:00Z", "Gold",
        wins, "2", "0", pick_number, pick, "100-200", "55-60%",
        "1", "1", "0", "0",
    ]
    return dict(zip(DRAFT_HEADER, values))


class ProtocolTests(unittest.TestCase):
    def test_protocol_is_frozen_and_research_only(self):
        p = protocol()
        self.assertEqual(p["version"], "contextual-value-v1")
        self.assertEqual(p["outer_split"], {
            "train_percent": 60, "validation_percent": 15, "assessment_percent": 25
        })
        self.assertEqual(p["weight_caps"], [10.0, 20.0, 50.0])
        self.assertFalse(p["production_changes"])


class SchemaTests(unittest.TestCase):
    def test_draft_header_requires_action_set_and_pool(self):
        validate_header(DRAFT_HEADER, "draft")
        with self.assertRaises(ValueError):
            validate_header([name for name in DRAFT_HEADER if not name.startswith("pool_")], "draft")

    def test_game_header_requires_deck_and_in_hand_columns(self):
        header = [
            "draft_id", "won", "rank", "user_game_win_rate_bucket",
            "user_n_games_bucket", "deck_A", "opening_hand_A",
        ]
        validate_header(header, "game")
        with self.assertRaisesRegex(ValueError, "in-hand"):
            validate_header(
                [name for name in header if not name.startswith("opening_hand_")],
                "game",
            )

    def test_archive_manifest_hashes_exact_header(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "draft.csv.gz"
            with gzip.open(path, "wt", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=DRAFT_HEADER)
                writer.writeheader()
                writer.writerow(row())
            manifest = inspect_archive(path, "draft")
        self.assertEqual(manifest.header, tuple(DRAFT_HEADER))
        self.assertEqual(len(manifest.sha256), 64)
        self.assertGreater(manifest.size_bytes, 0)


class DatasetTests(unittest.TestCase):
    def test_split_is_stable_and_has_frozen_shares(self):
        ids = [f"draft-{index}" for index in range(5000)]
        first = [draft_split(draft_id) for draft_id in ids]
        self.assertEqual(first, [draft_split(draft_id) for draft_id in ids])
        counts = Counter(first)
        self.assertAlmostEqual(counts["train"] / len(ids), 0.60, delta=0.03)
        self.assertAlmostEqual(counts["validation"] / len(ids), 0.15, delta=0.03)
        self.assertAlmostEqual(counts["assessment"] / len(ids), 0.25, delta=0.03)

    def test_candidate_expansion_labels_only_the_observed_action(self):
        decision = parse_decision(row(), DRAFT_HEADER)
        self.assertIsNotNone(decision)
        rows = expand_candidates(decision)
        self.assertEqual(len(rows), 2)
        selected = [candidate for candidate in rows if candidate.selected]
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0].candidate, "A")
        self.assertEqual(selected[0].outcome, 5)
        self.assertIsNone(next(candidate for candidate in rows if candidate.candidate == "B").outcome)

    def test_pre_treatment_state_cannot_leak_terminal_outcome(self):
        decision = parse_decision(row(), DRAFT_HEADER)
        state = decision.pre_treatment_state()
        self.assertNotIn("event_match_wins", state)
        self.assertNotIn("event_match_losses", state)
        self.assertNotIn("selected_card", state)

    def test_incomplete_action_set_is_rejected(self):
        bad = row(pick="C")
        self.assertIsNone(parse_decision(bad, DRAFT_HEADER))

    def test_primary_decision_is_one_stable_pack_one_pick(self):
        decisions = [parse_decision(row(draft_id="same", pick_number=str(i)), DRAFT_HEADER) for i in range(10)]
        chosen = choose_primary_decision([decision for decision in decisions if decision])
        self.assertIsNotNone(chosen)
        self.assertLess(chosen.pick_number, 8)
        self.assertEqual(chosen.decision_id,
                         choose_primary_decision([decision for decision in decisions if decision]).decision_id)

    def test_per_draft_weights_sum_to_one(self):
        decisions = [parse_decision(row(draft_id="same", pick_number=str(i)), DRAFT_HEADER) for i in range(4)]
        decisions = [decision for decision in decisions if decision]
        weights = normalized_draft_weights(decisions)
        self.assertAlmostEqual(sum(weights.values()), 1.0)


class NuisanceCheckpointTests(unittest.TestCase):
    def test_fold_checkpoints_recombine_to_exact_crossfit_predictions(self):
        decisions = []
        for index in range(30):
            decision = parse_decision(
                row(
                    draft_id=f"draft-{index}",
                    pick="A" if index % 2 else "B",
                    wins=str(index % 8),
                ),
                DRAFT_HEADER,
            )
            self.assertIsNotNone(decision)
            decisions.append(decision)
        full = crossfit_nuisance(decisions, folds=3)
        checkpointed = []
        for fold in range(3):
            checkpointed.extend(crossfit_nuisance_fold(decisions, fold, folds=3))
        checkpointed.sort(key=lambda item: item.decision_id)
        self.assertEqual(
            [asdict(item) for item in checkpointed],
            [asdict(item) for item in full],
        )


    def test_environment_feature_shards_recombine_to_exact_outer_fold(self):
        decisions = []
        for index in range(40):
            decision = parse_decision(
                row(
                    draft_id=f"shard-draft-{index}",
                    pick="A" if index % 2 else "B",
                    wins=str(index % 8),
                    expansion="AAA" if index % 2 else "BBB",
                ),
                DRAFT_HEADER,
            )
            self.assertIsNotNone(decision)
            decisions.append(decision)

        fold = 1
        folds = 3
        all_ids = frozenset(decision.draft_id for decision in decisions)
        held_ids = frozenset(
            draft_id for draft_id in all_ids
            if nuisance_fold(draft_id, folds) == fold
        )
        training_ids = frozenset(all_ids - held_ids)
        rows = []
        for expansion in ("AAA", "BBB"):
            rows.extend(build_fold_training_rows(
                decisions,
                training_ids,
                expansion=expansion,
            ))
        fit = fit_fold_from_training_rows(rows, training_ids, fold=fold)
        held = [decision for decision in decisions if decision.draft_id in held_ids]
        sharded = sorted(predict_fold(fit, held), key=lambda item: item.decision_id)
        monolithic = crossfit_nuisance_fold(decisions, fold, folds=folds)
        self.assertEqual(
            [asdict(item) for item in sharded],
            [asdict(item) for item in monolithic],
        )


class PropensityTests(unittest.TestCase):
    def test_softmax_normalizes_variable_action_set(self):
        probs = softmax({"A": 2.0, "B": 0.0, "C": -1.0})
        validate_distribution(probs, ["A", "B", "C"])
        self.assertAlmostEqual(sum(probs.values()), 1.0)
        self.assertGreater(probs["A"], probs["B"])
        self.assertGreater(probs["B"], probs["C"])

    def test_support_gate_matches_protocol_formula(self):
        self.assertEqual(support_threshold(2), 0.05)
        self.assertEqual(support_threshold(20), 0.01)


class DoublyRobustTests(unittest.TestCase):
    def test_candidate_aipw_corrects_only_observed_action(self):
        values = aipw_candidate_values(
            ["A", "B"], "B", 5.0,
            {"A": 0.75, "B": 0.25},
            {"A": 4.0, "B": 3.0},
        )
        self.assertEqual(values["A"], 4.0)
        self.assertEqual(values["B"], 11.0)  # 3 + (5 - 3) / .25

    def test_dr_is_correct_with_correct_q_even_if_behavior_is_wrong(self):
        observations = []
        # Target always selects A. Q is exact: E[Y(A)] = 2, E[Y(B)] = 0.
        # Deliberately supply a behavior model unrelated to the data generator.
        for index in range(200):
            action = "A" if index % 2 == 0 else "B"
            outcome = 2.0 if action == "A" else 0.0
            observations.append(PolicyObservation(
                action=action,
                outcome=outcome,
                behavior={"A": 0.9, "B": 0.1},
                target={"A": 1.0, "B": 0.0},
                q_values={"A": 2.0, "B": 0.0},
            ))
        estimate = evaluate_policy(observations)
        self.assertAlmostEqual(estimate.dr, 2.0, places=12)
        self.assertAlmostEqual(estimate.direct, 2.0, places=12)

    def test_dr_recovers_value_with_correct_behavior_and_wrong_q(self):
        observations = []
        # Deterministic balanced design exactly matches supplied behavior.
        # Target selects A; true outcome under A is 2, Q is wrong at zero.
        for index in range(200):
            action = "A" if index % 2 == 0 else "B"
            outcome = 2.0 if action == "A" else 0.0
            observations.append(PolicyObservation(
                action=action,
                outcome=outcome,
                behavior={"A": 0.5, "B": 0.5},
                target={"A": 1.0, "B": 0.0},
                q_values={"A": 0.0, "B": 0.0},
            ))
        estimate = evaluate_policy(observations)
        self.assertAlmostEqual(estimate.dr, 2.0, places=12)
        self.assertAlmostEqual(estimate.ipw, 2.0, places=12)
        self.assertAlmostEqual(estimate.snips, 2.0, places=12)

    def test_clipping_reports_overlap_diagnostics(self):
        obs = [PolicyObservation(
            action="B", outcome=1.0,
            behavior={"A": 0.99, "B": 0.01},
            target={"A": 0.0, "B": 1.0},
            q_values={"A": 0.0, "B": 0.0},
        )]
        estimate = evaluate_policy(obs, weight_cap=20)
        self.assertEqual(estimate.max_unclipped_weight, 100.0)
        self.assertEqual(estimate.clipped_fraction, 1.0)
        self.assertEqual(estimate.ess_ratio, 1.0)


class BootstrapTests(unittest.TestCase):
    def test_cluster_bootstrap_resamples_whole_drafts(self):
        rows = [("d1", 1.0), ("d1", 3.0), ("d2", 10.0), ("d2", 12.0)]
        low, high = cluster_bootstrap(
            rows,
            cluster_of=lambda item: item[0],
            statistic=lambda sample: sum(value for _, value in sample) / len(sample),
            replicates=200,
            seed=1,
        )
        self.assertLessEqual(low, 6.5)
        self.assertGreaterEqual(high, 6.5)


class FeatureContractTests(unittest.TestCase):
    def test_post_treatment_feature_is_rejected(self):
        with self.assertRaises(ValueError):
            validate_feature_map({"event_match_wins": 7.0})


class OutcomeBaselineTests(unittest.TestCase):
    def test_ridge_baseline_learns_simple_relationship(self):
        rows = [{"x": float(x)} for x in range(-5, 6)]
        outcomes = [1.0 + 2.0 * x for x in range(-5, 6)]
        model = RidgeOutcomeModel.fit(rows, outcomes, l2=0.0)
        self.assertAlmostEqual(model.predict({"x": 3.0}), 7.0, places=9)

    def test_ridge_never_accepts_outcome_as_feature(self):
        with self.assertRaises(ValueError):
            RidgeOutcomeModel.fit([{"event_match_wins": 1.0}], [1.0])


class EvaluationGateTests(unittest.TestCase):
    @staticmethod
    def _policies():
        candidate = []
        incumbent = []
        for index in range(100):
            action = "A" if index % 2 == 0 else "B"
            outcome = 2.0 if action == "A" else 0.0
            shared = dict(
                action=action,
                outcome=outcome,
                behavior={"A": 0.5, "B": 0.5},
                q_values={"A": 2.0, "B": 0.0},
            )
            candidate.append(PolicyObservation(target={"A": 1.0, "B": 0.0}, **shared))
            incumbent.append(PolicyObservation(target={"A": 0.0, "B": 1.0}, **shared))
        return candidate, incumbent

    @staticmethod
    def _environment_evidence():
        return {
            "MSH": (-0.01, 0.20),
            "SOS": (-0.02, 0.18),
            "ECL": (-0.03, 0.16),
            "TLA": (-0.04, 0.14),
        }

    @staticmethod
    def _powered():
        return {"MSH": True, "SOS": True, "ECL": True, "TLA": True}

    @staticmethod
    def _ablations():
        return {name: True for name in REQUIRED_ABLATIONS}

    def _complete_kwargs(self):
        return dict(
            ci95=(1.0, 3.0),
            environment_deltas=self._environment_evidence(),
            environment_powered=self._powered(),
            ablation_evidence=self._ablations(),
            out_of_environment_name="predeclared-holdout",
            out_of_environment_ci95=(-0.04, 0.10),
            out_of_environment_excluded_from_development=True,
        )

    def test_gate_requires_all_written_research_evidence(self):
        candidate, incumbent = self._policies()
        incomplete = compare_policies(candidate, incumbent)
        self.assertEqual(incomplete["status"], "incomplete")
        complete = compare_policies(candidate, incumbent, **self._complete_kwargs())
        self.assertEqual(complete["status"], "pass")
        self.assertFalse(complete["production_promotion"]["decisive"])
        self.assertEqual(complete["production_promotion"]["status"], "incomplete")

    def test_empty_environment_evidence_is_incomplete(self):
        candidate, incumbent = self._policies()
        kwargs = self._complete_kwargs()
        kwargs["environment_deltas"] = {}
        result = compare_policies(candidate, incumbent, **kwargs)
        self.assertEqual(result["status"], "incomplete")
        self.assertFalse(result["checks"]["development_environment_evidence_complete"])

    def test_missing_required_environment_is_incomplete(self):
        candidate, incumbent = self._policies()
        kwargs = self._complete_kwargs()
        evidence = self._environment_evidence()
        evidence.pop("TLA")
        kwargs["environment_deltas"] = evidence
        result = compare_policies(candidate, incumbent, **kwargs)
        self.assertEqual(result["status"], "incomplete")
        self.assertIn(
            "TLA",
            result["evidence"]["development_environments"]["missing_intervals"],
        )

    def test_malformed_environment_interval_is_incomplete(self):
        candidate, incumbent = self._policies()
        kwargs = self._complete_kwargs()
        evidence = self._environment_evidence()
        evidence["SOS"] = (0.2, -0.2)
        kwargs["environment_deltas"] = evidence
        result = compare_policies(candidate, incumbent, **kwargs)
        self.assertEqual(result["status"], "incomplete")
        self.assertIn("SOS", result["evidence"]["development_environments"]["malformed"])

    def test_no_powered_environment_is_incomplete_not_vacuous_pass(self):
        candidate, incumbent = self._policies()
        kwargs = self._complete_kwargs()
        kwargs["environment_powered"] = {
            "MSH": False, "SOS": False, "ECL": False, "TLA": False
        }
        result = compare_policies(candidate, incumbent, **kwargs)
        self.assertEqual(result["status"], "incomplete")
        self.assertIsNone(result["checks"]["no_concentrated_harm"])

    def test_missing_or_malformed_ablation_evidence_is_incomplete(self):
        candidate, incumbent = self._policies()
        kwargs = self._complete_kwargs()
        ablations = self._ablations()
        missing = REQUIRED_ABLATIONS[0]
        ablations.pop(missing)
        kwargs["ablation_evidence"] = ablations
        result = compare_policies(candidate, incumbent, **kwargs)
        self.assertEqual(result["status"], "incomplete")
        self.assertIn(missing, result["evidence"]["ablations"]["missing"])

        kwargs = self._complete_kwargs()
        ablations = self._ablations()
        ablations[REQUIRED_ABLATIONS[1]] = "yes"
        kwargs["ablation_evidence"] = ablations
        self.assertEqual(compare_policies(candidate, incumbent, **kwargs)["status"], "incomplete")

    def test_failed_required_ablation_is_a_gate_failure(self):
        candidate, incumbent = self._policies()
        kwargs = self._complete_kwargs()
        ablations = self._ablations()
        ablations["remove_propensity_correction"] = False
        kwargs["ablation_evidence"] = ablations
        result = compare_policies(candidate, incumbent, **kwargs)
        self.assertEqual(result["status"], "fail")
        self.assertFalse(result["checks"]["ablations_coherent_no_leakage_proxy"])

    def test_missing_or_nonexcluded_holdout_is_not_a_pass(self):
        candidate, incumbent = self._policies()
        kwargs = self._complete_kwargs()
        kwargs["out_of_environment_name"] = None
        self.assertEqual(compare_policies(candidate, incumbent, **kwargs)["status"], "incomplete")

        kwargs = self._complete_kwargs()
        kwargs["out_of_environment_excluded_from_development"] = False
        result = compare_policies(candidate, incumbent, **kwargs)
        self.assertEqual(result["status"], "fail")
        self.assertFalse(result["checks"]["out_of_environment_excluded_from_development"])

    def test_complete_harm_evidence_can_fail_gate(self):
        candidate, incumbent = self._policies()
        kwargs = self._complete_kwargs()
        evidence = self._environment_evidence()
        evidence["ECL"] = (-0.20, -0.06)
        kwargs["environment_deltas"] = evidence
        result = compare_policies(candidate, incumbent, **kwargs)
        self.assertEqual(result["status"], "fail")
        self.assertFalse(result["checks"]["no_concentrated_harm"])

    def test_prospective_environment_is_separate_production_gate(self):
        candidate, incumbent = self._policies()
        result = compare_policies(
            candidate,
            incumbent,
            **self._complete_kwargs(),
            prospective_environment_delta=0.03,
            prospective_environment_ci95=(-0.02, 0.08),
        )
        self.assertEqual(result["status"], "pass")
        self.assertTrue(result["production_promotion"]["passed"])


if __name__ == "__main__":
    unittest.main()
