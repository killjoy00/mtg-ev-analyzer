import argparse
import csv
import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_draft_run_corpus import CORPUS_VERSION, build, scan_trophy_ids


class DraftRunCorpusTests(unittest.TestCase):
    def make_fixture(self, path: Path):
        fields = [
            "draft_id", "draft_time", "rank", "event_match_wins", "event_match_losses",
            "pack_number", "pick_number", "pick", "user_game_win_rate_bucket", "user_n_games_bucket",
            "pack_card_A", "pack_card_B", "pack_card_C", "pack_card_D",
            "pool_A", "pool_B", "pool_C", "pool_D",
        ]
        skills = {
            "d1": "0.72 - 0.74",
            "d2": "0.70 - 0.72",
            "d3": "0.68 - 0.70",
            "d4": "0.66 - 0.68",
            "d5": "0.55 - 0.57",
            "d6": "0.52 - 0.54",
        }
        wins = {"d1": 7, "d2": 7, "d3": 6, "d4": 7, "d5": 7, "d6": 7}
        rows = []
        for draft_index, (draft_id, skill) in enumerate(skills.items()):
            picked_so_far = []
            for pick_number in range(10):
                order = ["A", "B", "C", "D"]
                historical = order[(pick_number + draft_index) % len(order)]
                pool_counts = {name: picked_so_far.count(name) for name in order}
                rows.append({
                    "draft_id": draft_id,
                    "draft_time": "2026-01-01T00:00:00Z",
                    "rank": "Mythic" if draft_index < 2 else "Diamond",
                    "event_match_wins": str(wins[draft_id]),
                    "event_match_losses": "2",
                    "pack_number": "0",
                    "pick_number": str(pick_number),
                    "pick": historical,
                    "user_game_win_rate_bucket": skill,
                    "user_n_games_bucket": "100 - 499",
                    "pack_card_A": "1",
                    "pack_card_B": "1",
                    "pack_card_C": "1",
                    "pack_card_D": "1",
                    "pool_A": str(pool_counts["A"]),
                    "pool_B": str(pool_counts["B"]),
                    "pool_C": str(pool_counts["C"]),
                    "pool_D": str(pool_counts["D"]),
                })
                picked_so_far.append(historical)
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)

    def args(self, root: str, input_path: Path):
        return argparse.Namespace(
            input=str(input_path),
            output=str(Path(root) / "tst.jsonl"),
            manifest=str(Path(root) / "manifest.json"),
            expansion="TST",
            source_date="2026-01-01",
            minimum_games=100,
            top_fraction=2 / 3,
            max_training_drafts=100,
            max_trophy_drafts=None,
            minimum_first_pack_picks=10,
            folds=3,
            card_metadata=None,
        )

    def test_only_elite_trophies_become_puzzle_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "draft.csv"
            self.make_fixture(source)
            strong = {"d1", "d2", "d3", "d4"}
            trophy_ids, _ = scan_trophy_ids(source, strong)
            self.assertEqual(set(trophy_ids), {"d1", "d2", "d4"})

    def test_build_emits_ten_first_pack_states_per_complete_trophy(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "draft.csv"
            self.make_fixture(source)
            manifest = build(self.args(tmp, source))
            self.assertEqual(manifest["corpus_version"], CORPUS_VERSION)
            self.assertEqual(manifest["format"], "PremierDraft")
            self.assertGreaterEqual(manifest["trophy_drafts"], 2)
            self.assertEqual(manifest["puzzles"], manifest["trophy_drafts"] * 10)

            rows = [json.loads(line) for line in (Path(tmp) / "tst.jsonl").read_text(encoding="utf-8").splitlines()]
            first_draft = rows[0]["source_draft_hash"]
            sequence = [row for row in rows if row["source_draft_hash"] == first_draft]
            self.assertEqual([row["pick_number"] for row in sequence], list(range(1, 11)))
            self.assertEqual([len(row["prior_picks"]) for row in sequence], list(range(10)))
            self.assertTrue(all(row["event_match_wins"] == 7 for row in rows))
            self.assertTrue(all(0 <= row["support_entropy"] <= 1 for row in rows))
            self.assertTrue(all(abs(sum(card["model_probability"] for card in row["candidates"]) - 1) < 1e-5 for row in rows))


if __name__ == "__main__":
    unittest.main()
