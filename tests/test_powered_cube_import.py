import gzip
import json
import tempfile
import unittest
from pathlib import Path

from scripts import import_powered_cube as cube


class PoweredCubeImportTests(unittest.TestCase):
    def test_draft_candidate_names_come_from_header(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "cube.csv.gz"
            with gzip.open(path, "wt", encoding="utf-8", newline="") as handle:
                handle.write("draft_id,pack_card_Black Lotus,pack_card_Mox Sapphire,pool_Ancestral Recall\n")
                handle.write("d1,1,1,1\n")
            self.assertEqual(cube.draft_candidate_names(path), ["Black Lotus", "Mox Sapphire"])

    def test_bulk_discovery_prefers_current_jsonl_uri_and_supports_legacy_uri(self):
        current = {
            "object": "list",
            "data": [{
                "type": "oracle_cards",
                "jsonl_download_uri": "https://data.scryfall.io/oracle-cards/current.jsonl.gz",
                "download_uri": "https://data.scryfall.io/oracle-cards/legacy.json",
            }],
        }
        self.assertEqual(
            cube.oracle_bulk_download_uri(current),
            "https://data.scryfall.io/oracle-cards/current.jsonl.gz",
        )

        legacy = {
            "data": [{
                "type": "oracle_cards",
                "download_uri": "https://data.scryfall.io/oracle-cards/legacy.json",
            }],
        }
        self.assertEqual(
            cube.oracle_bulk_download_uri(legacy),
            "https://data.scryfall.io/oracle-cards/legacy.json",
        )
        with self.assertRaises(ValueError):
            cube.oracle_bulk_download_uri({"data": [{"type": "default_cards"}]})

    def test_oracle_bulk_reader_accepts_gzipped_jsonl_and_legacy_array(self):
        cards = [
            {"name": "Black Lotus", "rarity": "rare"},
            {"name": "Mox Sapphire", "rarity": "rare"},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            jsonl = root / "oracle.jsonl.gz"
            with gzip.open(jsonl, "wt", encoding="utf-8") as handle:
                for card in cards:
                    handle.write(json.dumps(card) + "\n")
            self.assertEqual(list(cube.iter_oracle_bulk(jsonl)), cards)

            legacy = root / "oracle.json"
            legacy.write_text(json.dumps(cards), encoding="utf-8")
            self.assertEqual(list(cube.iter_oracle_bulk(legacy)), cards)

    @staticmethod
    def _pack_picks(*, complete_p1p1: bool):
        picks = []
        for pick_number in range(1, 16):
            count = 16 - pick_number
            if pick_number == 1 and not complete_p1p1:
                count = 1
            pool = {} if pick_number == 1 else {"Black Lotus": 1}
            picks.append({
                "pack_number": 1,
                "pick_number": pick_number,
                "historical_pick_id": "black-lotus" if pick_number == 1 else f"p{pick_number}",
                "pool": pool,
                "candidates": [{"id": f"c{pick_number}-{index}"} for index in range(count)],
            })
        return picks

    def test_cube_run_uses_full_p1p1_if_arena_restores_it(self):
        replay = {"draft_id": "full", "picks": self._pack_picks(complete_p1p1=True)}
        prepared = cube.prepare_cube_run(replay, 14)
        self.assertIsNotNone(prepared)
        self.assertEqual(prepared["cube_start_pick"], 1)
        self.assertFalse(prepared["cube_missing_p1p1"])
        self.assertEqual(len(prepared["picks"]), 15)

    def test_cube_run_inherits_p1p1_and_starts_at_complete_p1p2(self):
        replay = {"draft_id": "missing", "picks": self._pack_picks(complete_p1p1=False)}
        prepared = cube.prepare_cube_run(replay, 14)
        self.assertIsNotNone(prepared)
        self.assertEqual(prepared["cube_start_pick"], 2)
        self.assertTrue(prepared["cube_missing_p1p1"])
        first = prepared["picks"][0]
        self.assertEqual(first["pick_number"], 2)
        self.assertEqual(len(first["candidates"]), 14)
        self.assertEqual(first["pool"], {"Black Lotus": 1})
        self.assertEqual([pick["pick_number"] for pick in prepared["picks"]], list(range(2, 16)))

    def test_cube_run_rejects_partial_p1p2_or_missing_later_pick(self):
        partial = {"draft_id": "partial", "picks": self._pack_picks(complete_p1p1=False)}
        partial["picks"][1]["candidates"] = [{"id": "only-one"}]
        self.assertIsNone(cube.prepare_cube_run(partial, 14))

        incomplete = {"draft_id": "incomplete", "picks": self._pack_picks(complete_p1p1=False)}
        incomplete["picks"] = [pick for pick in incomplete["picks"] if pick["pick_number"] != 12]
        self.assertIsNone(cube.prepare_cube_run(incomplete, 14))

        no_starter = {"draft_id": "no-starter", "picks": self._pack_picks(complete_p1p1=False)}
        no_starter["picks"][1]["pool"] = {}
        self.assertIsNone(cube.prepare_cube_run(no_starter, 14))

    def test_register_cube_appends_special_mode_without_replacing_featured_set(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            catalog_path = root / "catalog.json"
            output_dir = root / "powered-cube"
            output_dir.mkdir()
            catalog_path.write_text(json.dumps({
                "schema_version": 2,
                "sets": [{"id": "msh", "name": "MSH", "is_fixture": False}],
            }), encoding="utf-8")
            (output_dir / "manifest.json").write_text(json.dumps({
                "set_id": "powered-cube",
                "name": "powered-cube",
                "format": "PremierDraft",
                "replay_count": 120,
                "source": {"data_date": "2025-11-23"},
                "model": {"model_version": "strong-player-pool-context-v2"},
                "cohort": {"win_rate_cutoff": 0.61, "training_drafts": 900},
            }), encoding="utf-8")

            entry = cube.register_cube(catalog_path, output_dir)
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            manifest = json.loads((output_dir / "manifest.json").read_text(encoding="utf-8"))

            self.assertEqual(catalog["sets"][0]["id"], "msh")
            self.assertEqual(catalog["sets"][-1]["id"], "powered-cube")
            self.assertEqual(entry["category"], "special_mode")
            self.assertTrue(entry["hide_from_set_picker"])
            self.assertEqual(manifest["name"], "Powered Cube")
            self.assertEqual(manifest["source"]["archive_expansion"], "Cube_-_Powered")
            self.assertIn("P1P2", manifest["source"]["first_playable_pick"])


if __name__ == "__main__":
    unittest.main()
