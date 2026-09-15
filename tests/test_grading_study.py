import json
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from grading_study import (
    SCORE_CAP,
    js_round,
    Decision,
    build_task,
    displayed_score,
    error_at,
    fit_exponent,
    bootstrap_exponent,
    joined_rows,
    load_ratings,
    pick_band,
    rating_targets,
    severity_of,
    stratified_sample,
    summarize,
)

GRID = [round(0.25 * step, 2) for step in range(2, 17)]


def card(card_id, name=None):
    return {"id": card_id, "name": name or card_id.title(), "image_url": f"https://x/{card_id}.jpg",
            "rarity": "common", "mana_cost": "{1}", "type_line": "Creature",
            "model_probability": 0.1}


def decision(puzzle_id, ratios, trophy, pick_number=1, set_id="blb"):
    return Decision(
        puzzle_id=puzzle_id, set_id=set_id, pick_number=pick_number,
        candidates=[card(cid) for cid in ratios], prior_picks=[],
        trophy_id=trophy, leader_id=max(ratios, key=lambda c: ratios[c]), ratios=dict(ratios),
    )


class ScoreTests(unittest.TestCase):
    def test_reproduces_production_scoring_at_exponent_one(self):
        # gradeDraftRunPick: trophy -> 100, otherwise round(95 * ratio).
        self.assertEqual(displayed_score(1.0, False), 95)
        self.assertEqual(displayed_score(0.5, False), 48)
        self.assertEqual(displayed_score(0.131023, False), 12)
        self.assertEqual(displayed_score(0.0, False), 0)
        self.assertEqual(SCORE_CAP, 95)

    def test_trophy_pick_always_scores_full_marks(self):
        self.assertEqual(displayed_score(0.01, True), 100)
        self.assertEqual(displayed_score(1.0, True), 100)

    def test_exponent_squeezes_alternatives_downward(self):
        self.assertEqual(displayed_score(0.7, False, 1.0), 67)
        self.assertEqual(displayed_score(0.7, False, 2.0), 47)
        self.assertEqual(displayed_score(0.3, False, 1.0), 29)
        self.assertEqual(displayed_score(0.3, False, 2.0), 9)
        # A card level with the leader is untouched whatever the exponent.
        self.assertEqual(displayed_score(1.0, False, 2.0), 95)

    def test_rounding_matches_javascript_not_python(self):
        # Python's round() sends 66.5 to 66; Math.round sends it to 67.
        self.assertEqual(js_round(66.5), 67)
        self.assertEqual(js_round(0.5), 1)
        self.assertEqual(js_round(1.5), 2)
        self.assertEqual(js_round(2.5), 3)

    def test_ratio_is_clamped(self):
        self.assertEqual(displayed_score(1.4, False), 95)
        self.assertEqual(displayed_score(-0.2, False), 0)


class BandTests(unittest.TestCase):
    def test_severity_bands(self):
        self.assertEqual(severity_of(1.0), "leader")
        self.assertEqual(severity_of(0.85), "close")
        self.assertEqual(severity_of(0.7), "close")
        self.assertEqual(severity_of(0.45), "moderate")
        self.assertEqual(severity_of(0.2), "moderate")
        self.assertEqual(severity_of(0.19), "severe")
        self.assertEqual(severity_of(0.0), "severe")

    def test_pick_bands(self):
        self.assertEqual(pick_band(1), "early")
        self.assertEqual(pick_band(3), "early")
        self.assertEqual(pick_band(4), "mid")
        self.assertEqual(pick_band(7), "mid")
        self.assertEqual(pick_band(8), "late")


class SamplingTests(unittest.TestCase):
    def corpus(self):
        items = []
        for index in range(240):
            ratio = [1.0, 0.8, 0.4, 0.1][index % 4]
            ratios = {"leader": 1.0, "alt": ratio, "mid": 0.45, "low": 0.08, "tail": 0.02}
            trophy = "leader" if ratio == 1.0 else "alt"
            items.append(decision(f"p{index}", ratios, trophy, pick_number=1 + (index % 10)))
        return items

    def test_sample_balances_severity_and_depth(self):
        chosen = stratified_sample(self.corpus(), 36, "seed")
        self.assertEqual(len(chosen), 36)
        spread = Counter((severity_of(d.trophy_ratio), pick_band(d.pick_number)) for d in chosen)
        # Severe disagreements are rare in the corpus but must not be rare here.
        self.assertGreaterEqual(min(spread.values()), 2)
        self.assertEqual(len({d.puzzle_id for d in chosen}), 36)

    def test_sample_is_deterministic_for_a_seed(self):
        first = [d.puzzle_id for d in stratified_sample(self.corpus(), 20, "seed")]
        self.assertEqual(first, [d.puzzle_id for d in stratified_sample(self.corpus(), 20, "seed")])
        other = [d.puzzle_id for d in stratified_sample(self.corpus(), 20, "other")]
        self.assertNotEqual(first, other)

    def test_sample_cannot_exceed_the_corpus(self):
        self.assertEqual(len(stratified_sample(self.corpus()[:5], 50, "seed")), 5)

    def test_targets_always_include_the_leader_and_the_trophy_pick(self):
        d = decision("p", {"leader": 1.0, "alt": 0.3, "mid": 0.5, "low": 0.05}, "alt")
        targets = rating_targets(d, 4)
        self.assertIn("leader", targets)
        self.assertIn("alt", targets)
        self.assertEqual(len(targets), 4)
        self.assertEqual(len(set(targets)), 4)

    def test_targets_reach_down_the_support_range(self):
        d = decision("p", {"leader": 1.0, "close": 0.9, "mid": 0.45, "low": 0.05, "tail": 0.02}, "leader")
        bands = {severity_of(d.ratios[cid]) for cid in rating_targets(d, 4)}
        self.assertIn("severe", bands)
        self.assertIn("moderate", bands)


class BlindingTests(unittest.TestCase):
    def test_task_file_contains_no_model_numbers(self):
        chosen = [decision("p1", {"a": 1.0, "b": 0.5, "c": 0.3, "d": 0.05}, "b")]
        task, key = build_task(chosen, 4, "seed")
        text = json.dumps(task)
        self.assertNotIn("model_probability", text)
        self.assertNotIn("ratio", text)
        # the answers live only in the key
        self.assertIn("b", key["answers"]["p1"]["ratios"])
        self.assertEqual(key["answers"]["p1"]["trophy_id"], "b")
        self.assertEqual(key["answers"]["p1"]["leader_id"], "a")

    def test_task_does_not_present_targets_in_support_order(self):
        # Ordering the cards to rate by support would hand the rater the answer.
        ratios = {f"c{i}": 1.0 - i * 0.1 for i in range(10)}
        chosen = [decision(f"p{n}", ratios, "c3") for n in range(12)]
        task, key = build_task(chosen, 4, "seed")
        descending = 0
        for entry in task["decisions"]:
            supports = [key["answers"][entry["puzzle_id"]]["ratios"][cid] for cid in entry["rate"]]
            if supports == sorted(supports, reverse=True):
                descending += 1
        self.assertLess(descending, len(task["decisions"]))

    def test_pack_is_shown_in_full(self):
        chosen = [decision("p1", {"a": 1.0, "b": 0.5, "c": 0.3, "d": 0.05}, "b")]
        task, _ = build_task(chosen, 2, "seed")
        self.assertEqual(len(task["decisions"][0]["pack"]), 4)
        self.assertEqual(len(task["decisions"][0]["rate"]), 2)


class RatingIngestTests(unittest.TestCase):
    def write(self, payload):
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(payload, handle)
        handle.close()
        return Path(handle.name)

    def test_accepts_a_bare_list_and_an_export_object(self):
        rows = [{"puzzle_id": "p", "card_id": "a", "rating": 80}]
        self.assertEqual(len(load_ratings(self.write(rows))), 1)
        self.assertEqual(len(load_ratings(self.write({"ratings": rows}))), 1)

    def test_drops_unusable_rows(self):
        rows = [
            {"puzzle_id": "p", "card_id": "a", "rating": 80},
            {"puzzle_id": "p", "card_id": "b", "rating": 140},
            {"puzzle_id": "p", "card_id": "c", "rating": -1},
            {"puzzle_id": "p", "card_id": "d", "rating": "not a number"},
            {"puzzle_id": "p", "card_id": "e"},
        ]
        self.assertEqual(len(load_ratings(self.write(rows))), 1)

    def test_unmatched_ratings_are_ignored(self):
        key = {"answers": {"p": {"set_id": "blb", "pick_number": 1, "trophy_id": "a",
                                 "leader_id": "a", "ratios": {"a": 1.0}}}}
        rows = load_ratings(self.write([
            {"puzzle_id": "p", "card_id": "a", "rating": 90},
            {"puzzle_id": "other", "card_id": "a", "rating": 90},
            {"puzzle_id": "p", "card_id": "unrated", "rating": 90},
        ]))
        self.assertEqual(len(joined_rows(rows, key)), 1)


class FitTests(unittest.TestCase):
    def synthetic(self, exponent, count=60):
        """Ratings generated by a known curve, so the fitter has a right answer."""
        key = {"answers": {}}
        ratings = []
        for index in range(count):
            puzzle = f"p{index}"
            ratios = {"leader": 1.0, "close": 0.8, "mid": 0.45, "low": 0.12}
            key["answers"][puzzle] = {"set_id": "blb", "pick_number": 1 + index % 10,
                                      "trophy_id": "leader", "leader_id": "leader",
                                      "ratios": ratios}
            for cid, ratio in ratios.items():
                ratings.append({"puzzle_id": puzzle, "card_id": cid, "rater": "r",
                                "rating": displayed_score(ratio, cid == "leader", exponent)})
        return joined_rows(ratings, key), key

    def test_recovers_the_curve_that_generated_the_ratings(self):
        for exponent in (1.0, 1.5, 2.0, 3.0):
            rows, _ = self.synthetic(exponent)
            best, error = fit_exponent(rows, True, GRID)
            self.assertAlmostEqual(best, exponent, places=6)
            self.assertLess(error, 0.6)

    def test_error_separates_the_two_candidate_curves(self):
        rows, _ = self.synthetic(2.0)
        self.assertLess(error_at(rows, 2.0, True), error_at(rows, 1.0, True))

    def test_bootstrap_clusters_by_decision(self):
        rows, _ = self.synthetic(2.0, count=30)
        fitted = bootstrap_exponent(rows, True, GRID, draws=40)
        self.assertEqual(len(fitted), 40)
        self.assertTrue(all(abs(value - 2.0) < 1.0 for value in fitted))

    def test_bootstrap_needs_more_than_one_decision(self):
        rows, _ = self.synthetic(2.0, count=1)
        self.assertEqual(bootstrap_exponent(rows, True, GRID, draws=10), [])

    def test_summary_reports_both_candidate_curves_and_severity(self):
        rows, _ = self.synthetic(2.0)
        summary = summarize(rows, GRID, draws=50)
        self.assertEqual(summary["best_fit_exponent"], 2.0)
        self.assertLess(summary["error_honest_exponent_2"], summary["error_today_exponent_1"])
        self.assertIn("severe", summary["by_severity"])
        self.assertEqual(summary["decisions"], 60)
        low, high = summary["best_fit_ci95"]
        self.assertLessEqual(low, 2.0)
        self.assertGreaterEqual(high, 2.0)

    def test_trophy_rule_is_reported_when_the_trophy_is_not_the_leader(self):
        key = {"answers": {"p": {"set_id": "blb", "pick_number": 1, "trophy_id": "alt",
                                 "leader_id": "leader", "ratios": {"leader": 1.0, "alt": 0.3}}}}
        rows = joined_rows([
            {"puzzle_id": "p", "card_id": "leader", "rating": 100, "rater": "r"},
            {"puzzle_id": "p", "card_id": "alt", "rating": 55, "rater": "r"},
        ], key)
        summary = summarize(rows, GRID, draws=10)
        self.assertEqual(summary["trophy_rule"]["n"], 1)
        self.assertEqual(summary["trophy_rule"]["mean_rating_when_trophy_is_not_leader"], 55.0)
        self.assertEqual(summary["trophy_rule"]["rated_below_90"], 1)


if __name__ == "__main__":
    unittest.main()
