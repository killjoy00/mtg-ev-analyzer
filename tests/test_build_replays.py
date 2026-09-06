import argparse
import csv
import tempfile
import unittest
from pathlib import Path

from scripts.build_replays import build, parse_games_lower_bound, parse_rate_bucket, quantile_cutoff, stable_fold


class ParsingTests(unittest.TestCase):
    def test_rate_bucket_parsing(self):
        self.assertAlmostEqual(parse_rate_bucket("0.60 - 0.64"), 0.62)
        self.assertAlmostEqual(parse_rate_bucket("60% - 64%"), 0.62)
        self.assertAlmostEqual(parse_rate_bucket("0.63"), 0.63)

    def test_game_bucket_uses_lower_bound(self):
        self.assertEqual(parse_games_lower_bound("100 - 499"), 100)
        self.assertEqual(parse_games_lower_bound("500+"), 500)

    def test_top_fraction_cutoff(self):
        self.assertEqual(quantile_cutoff([0.5, 0.6, 0.7, 0.8], 0.5), 0.7)


class PipelineTests(unittest.TestCase):
    def make_fixture(self, path: Path):
        fields = ["draft_id","pack_number","pick_number","pick","user_game_win_rate_bucket","user_n_games_bucket","pack_card_A","pack_card_B","pack_card_C","pool_A","pool_B","pool_C"]
        rows = []
        skill = {"d1":"0.72 - 0.74","d2":"0.70 - 0.72","d3":"0.68 - 0.70","d4":"0.66 - 0.68","d5":"0.55 - 0.57","d6":"0.52 - 0.54"}
        picks = {"d1":"A","d2":"A","d3":"A","d4":"B","d5":"C","d6":"C"}
        for draft_id in skill:
            rows.append({"draft_id":draft_id,"pack_number":"0","pick_number":"0","pick":picks[draft_id],"user_game_win_rate_bucket":skill[draft_id],"user_n_games_bucket":"100 - 499","pack_card_A":"1","pack_card_B":"1","pack_card_C":"1","pool_A":"0","pool_B":"0","pool_C":"0"})
            rows.append({"draft_id":draft_id,"pack_number":"0","pick_number":"1","pick":"B" if picks[draft_id] == "A" else "A","user_game_win_rate_bucket":skill[draft_id],"user_n_games_bucket":"100 - 499","pack_card_A":"1","pack_card_B":"1","pack_card_C":"0","pool_A":"1" if picks[draft_id] == "A" else "0","pool_B":"1" if picks[draft_id] == "B" else "0","pool_C":"0"})
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)

    def test_pipeline_emits_replays_and_probabilities(self):
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "draft.csv"
            self.make_fixture(csv_path)
            args = argparse.Namespace(input=str(csv_path), output=str(Path(tmp)/"out.json"), expansion="TST", format="PremierDraft", source_date="2026-01-01", minimum_games=100, top_fraction=2/3, max_training_drafts=100, max_output_drafts=100, folds=3, card_metadata=None)
            output = build(args)
            self.assertFalse(output["is_fixture"])
            self.assertEqual(output["model"]["holdout"], "3-fold by draft_id")
            self.assertGreaterEqual(len(output["replays"]), 3)
            first = output["replays"][0]["picks"][0]
            self.assertEqual(first["pack_number"], 1)
            self.assertEqual(first["pick_number"], 1)
            self.assertAlmostEqual(sum(card["model_probability"] for card in first["candidates"]), 1.0, places=5)
            self.assertIn(first["consensus_pick_id"], {card["id"] for card in first["candidates"]})

    def test_each_draft_is_scored_with_a_holdout_fold(self):
        self.assertTrue(0 <= stable_fold("draft-a", 5) < 5)


if __name__ == "__main__":
    unittest.main()
