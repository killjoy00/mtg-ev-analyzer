import csv
import gzip
import tempfile
import unittest
from pathlib import Path

from scripts.backfill_legacy_sets import augment_draft_with_skills, read_skill_buckets
from scripts.build_replays import scan_draft_skill


class LegacySkillBackfillTests(unittest.TestCase):
    def write_csv_gz(self, path: Path, fieldnames, rows):
        with gzip.open(path, "wt", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

    def test_game_data_supplies_modal_anonymized_skill_buckets(self):
        with tempfile.TemporaryDirectory() as tmp:
            game = Path(tmp) / "game.csv.gz"
            self.write_csv_gz(
                game,
                ["draft_id", "won", "user_game_win_rate_bucket", "user_n_games_bucket"],
                [
                    {"draft_id": "d1", "won": "True", "user_game_win_rate_bucket": "0.62", "user_n_games_bucket": "100"},
                    {"draft_id": "d1", "won": "False", "user_game_win_rate_bucket": "0.62", "user_n_games_bucket": "100"},
                    {"draft_id": "d1", "won": "True", "user_game_win_rate_bucket": "0.60", "user_n_games_bucket": "100"},
                    {"draft_id": "d2", "won": "False", "user_game_win_rate_bucket": "0.58", "user_n_games_bucket": "500"},
                ],
            )
            skills = read_skill_buckets(game)
            self.assertEqual(skills["d1"], ("0.62", "100"))
            self.assertEqual(skills["d2"], ("0.58", "500"))

    def test_legacy_join_makes_old_draft_schema_builder_compatible(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            draft = root / "draft.csv.gz"
            game = root / "game.csv.gz"
            joined = root / "joined.csv.gz"

            draft_fields = [
                "draft_id", "pack_number", "pick_number", "pick",
                "pack_card_A", "pack_card_B", "pool_A", "pool_B",
            ]
            draft_rows = []
            game_rows = []
            for index in range(100):
                draft_id = f"d{index}"
                draft_rows.append({
                    "draft_id": draft_id,
                    "pack_number": "0",
                    "pick_number": "0",
                    "pick": "A",
                    "pack_card_A": "1",
                    "pack_card_B": "1",
                    "pool_A": "0",
                    "pool_B": "0",
                })
                game_rows.append({
                    "draft_id": draft_id,
                    "user_game_win_rate_bucket": "0.62",
                    "user_n_games_bucket": "100",
                })

            self.write_csv_gz(draft, draft_fields, draft_rows)
            self.write_csv_gz(
                game,
                ["draft_id", "user_game_win_rate_bucket", "user_n_games_bucket"],
                game_rows,
            )

            stats = augment_draft_with_skills(draft, game, joined)
            self.assertEqual(stats["covered_drafts"], 100)
            self.assertEqual(stats["coverage"], 1.0)

            skills, fieldnames = scan_draft_skill(joined)
            self.assertEqual(len(skills), 100)
            self.assertIn("user_game_win_rate_bucket", fieldnames)
            self.assertIn("user_n_games_bucket", fieldnames)
            self.assertEqual(skills["d0"].games_lower_bound, 100)
            self.assertAlmostEqual(skills["d0"].rate, 0.62)

    def test_join_never_reads_game_outcome_columns(self):
        with tempfile.TemporaryDirectory() as tmp:
            game = Path(tmp) / "game.csv.gz"
            self.write_csv_gz(
                game,
                ["draft_id", "won", "event_match_wins", "event_match_losses", "user_game_win_rate_bucket", "user_n_games_bucket"],
                [
                    {
                        "draft_id": "d1",
                        "won": "True",
                        "event_match_wins": "7",
                        "event_match_losses": "0",
                        "user_game_win_rate_bucket": "0.55",
                        "user_n_games_bucket": "100",
                    }
                ],
            )
            self.assertEqual(read_skill_buckets(game)["d1"], ("0.55", "100"))


if __name__ == "__main__":
    unittest.main()
