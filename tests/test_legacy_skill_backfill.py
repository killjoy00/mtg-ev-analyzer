import csv
import gzip
import json
import tempfile
import unittest
from pathlib import Path

from scripts.backfill_legacy_sets import (
    annotate_legacy_provenance,
    arena_rank_proxy,
    arena_rank_tier,
    augment_draft_with_rank_proxy,
    read_legacy_player_history,
)
from scripts.build_replays import scan_draft_skill


class LegacySkillBackfillTests(unittest.TestCase):
    def write_csv_gz(self, path: Path, fieldnames, rows):
        with gzip.open(path, "wt", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

    def test_arena_rank_proxy_orders_tiers_and_is_stable(self):
        mythic = arena_rank_proxy("Mythic", "draft-a")
        diamond = arena_rank_proxy("Diamond", "draft-a")
        platinum = arena_rank_proxy("Platinum-2", "draft-a")
        gold = arena_rank_proxy("Gold", "draft-a")
        self.assertGreater(mythic, diamond)
        self.assertGreater(diamond, platinum)
        self.assertGreater(platinum, gold)
        self.assertEqual(mythic, arena_rank_proxy("Mythic", "draft-a"))
        self.assertNotEqual(mythic, arena_rank_proxy("Mythic", "draft-b"))
        self.assertEqual(arena_rank_tier("Platinum-2"), "platinum")
        self.assertIsNone(arena_rank_proxy("Unknown", "draft-a"))

    def test_game_history_uses_earliest_row_not_later_outcome_or_rank(self):
        with tempfile.TemporaryDirectory() as tmp:
            game = Path(tmp) / "game.csv.gz"
            self.write_csv_gz(
                game,
                [
                    "draft_id", "game_time", "match_number", "game_number", "rank",
                    "won", "event_match_wins", "event_match_losses", "user_n_games_bucket",
                ],
                [
                    {
                        "draft_id": "d1", "game_time": "2021-09-10T12:30:00Z", "match_number": "2", "game_number": "1",
                        "rank": "Diamond", "won": "True", "event_match_wins": "2", "event_match_losses": "0",
                        "user_n_games_bucket": "500",
                    },
                    {
                        "draft_id": "d1", "game_time": "2021-09-10T12:00:00Z", "match_number": "1", "game_number": "1",
                        "rank": "Platinum", "won": "False", "event_match_wins": "0", "event_match_losses": "0",
                        "user_n_games_bucket": "100",
                    },
                    {
                        "draft_id": "d2", "game_time": "2021-09-11T12:00:00Z", "match_number": "1", "game_number": "1",
                        "rank": "Gold", "won": "True", "event_match_wins": "7", "event_match_losses": "0",
                        "user_n_games_bucket": "500",
                    },
                ],
            )
            history = read_legacy_player_history(game)
            self.assertEqual(history["d1"], {"rank": "Platinum", "games": "100"})
            self.assertEqual(history["d2"], {"rank": "Gold", "games": "500"})

    def test_legacy_join_makes_rankless_draft_schema_builder_compatible(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            draft = root / "draft.csv.gz"
            game = root / "game.csv.gz"
            joined = root / "joined.csv.gz"

            draft_fields = [
                "draft_id", "pack_number", "pick_number", "pick",
                "pack_card_A", "pack_card_B", "pool_A", "pool_B",
            ]
            game_fields = [
                "draft_id", "game_time", "rank", "won", "event_match_wins",
                "event_match_losses", "user_n_games_bucket",
            ]
            draft_rows = []
            game_rows = []
            tiers = ["Mythic", "Diamond", "Platinum", "Gold", "Silver", "Bronze"]
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
                    "game_time": f"2021-09-10T12:{index % 60:02d}:00Z",
                    "rank": tiers[index % len(tiers)],
                    "won": str(index % 2 == 0),
                    "event_match_wins": "7" if index % 2 == 0 else "0",
                    "event_match_losses": "0" if index % 2 == 0 else "3",
                    "user_n_games_bucket": "100",
                })

            self.write_csv_gz(draft, draft_fields, draft_rows)
            self.write_csv_gz(game, game_fields, game_rows)

            stats = augment_draft_with_rank_proxy(draft, game, joined)
            self.assertEqual(stats["covered_drafts"], 100)
            self.assertEqual(stats["coverage"], 1.0)
            self.assertEqual(sum(stats["rank_tiers"].values()), 100)

            skills, fieldnames = scan_draft_skill(joined)
            self.assertEqual(len(skills), 100)
            self.assertIn("user_game_win_rate_bucket", fieldnames)
            self.assertIn("user_n_games_bucket", fieldnames)
            self.assertEqual(skills["d0"].games_lower_bound, 100)
            self.assertGreater(skills["d0"].rate, skills["d1"].rate)

    def test_later_outcomes_cannot_change_earliest_game_selection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            draft = root / "draft.csv.gz"
            game = root / "game.csv.gz"
            joined = root / "joined.csv.gz"
            draft_fields = [
                "draft_id", "pack_number", "pick_number", "pick",
                "pack_card_A", "pack_card_B", "pool_A", "pool_B",
            ]
            game_fields = [
                "draft_id", "game_time", "rank", "won", "event_match_wins",
                "event_match_losses", "user_n_games_bucket",
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
                game_rows.extend([
                    {
                        "draft_id": draft_id,
                        "game_time": "2021-09-10T12:00:00Z",
                        "rank": "Platinum",
                        "won": "False",
                        "event_match_wins": "0",
                        "event_match_losses": "0",
                        "user_n_games_bucket": "100",
                    },
                    {
                        "draft_id": draft_id,
                        "game_time": "2021-09-10T13:00:00Z",
                        "rank": "Mythic" if index < 50 else "Bronze",
                        "won": "True" if index < 50 else "False",
                        "event_match_wins": "7" if index < 50 else "0",
                        "event_match_losses": "0" if index < 50 else "3",
                        "user_n_games_bucket": "500",
                    },
                ])
            self.write_csv_gz(draft, draft_fields, draft_rows)
            self.write_csv_gz(game, game_fields, game_rows)
            augment_draft_with_rank_proxy(draft, game, joined)
            skills, _ = scan_draft_skill(joined)
            self.assertAlmostEqual(skills["d0"].rate, arena_rank_proxy("Platinum", "d0"))
            self.assertAlmostEqual(skills["d99"].rate, arena_rank_proxy("Platinum", "d99"))
            self.assertEqual(skills["d0"].games_lower_bound, 100)
            self.assertEqual(skills["d99"].games_lower_bound, 100)

    def test_published_provenance_removes_synthetic_win_rate(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "data" / "vow"
            output.mkdir(parents=True)
            manifest = {
                "cohort": {
                    "win_rate_cutoff": 0.8005,
                    "training_drafts": 300,
                    "minimum_games_bucket_lower_bound": 100,
                }
            }
            path_model = {
                "training": {"win_rate_cutoff": 0.8005, "drafts": 300},
                "model_version": "strong-player-counterfactual-path-v3",
            }
            catalog = {
                "schema_version": 2,
                "sets": [{"id": "vow", "win_rate_cutoff": 0.8005, "training_drafts": 300}],
            }
            (output / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            (output / "path-model.json").write_text(json.dumps(path_model), encoding="utf-8")
            catalog_path = root / "data" / "catalog.json"
            catalog_path.write_text(json.dumps(catalog), encoding="utf-8")

            result = annotate_legacy_provenance(
                output,
                catalog_path,
                code="VOW",
                game_source_date="2024-01-11",
                join_stats={
                    "coverage": 1.0,
                    "rank_tiers": {"mythic": 10, "diamond": 90, "platinum": 100, "gold": 0, "silver": 0, "bronze": 0},
                },
                minimum_games=100,
                top_fraction=0.15,
            )
            self.assertEqual(result["arena_rank_cutoff_tier"], "diamond")

            published_manifest = json.loads((output / "manifest.json").read_text())
            self.assertNotIn("win_rate_cutoff", published_manifest["cohort"])
            self.assertEqual(published_manifest["cohort"]["selection_metric"], "earliest_game_arena_rank")
            self.assertIn("earliest game row", published_manifest["cohort"]["selection_note"])

            published_model = json.loads((output / "path-model.json").read_text())
            self.assertNotIn("win_rate_cutoff", published_model["training"])
            self.assertEqual(published_model["training"]["selection_metric"], "earliest_game_arena_rank")

            published_catalog = json.loads(catalog_path.read_text())
            entry = published_catalog["sets"][0]
            self.assertNotIn("win_rate_cutoff", entry)
            self.assertEqual(entry["cohort_selection"], "earliest_game_arena_rank")
            self.assertEqual(entry["cohort_label"], "Experienced Arena-rank cohort")


if __name__ == "__main__":
    unittest.main()
