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

    def test_complete_cube_opening_requires_real_p1p1_and_full_pack(self):
        picks = []
        for pick_number in range(1, 16):
            count = 16 - pick_number
            picks.append({
                "pack_number": 1,
                "pick_number": pick_number,
                "candidates": [{"id": f"c{index}"} for index in range(count)],
            })
        replay = {"draft_id": "complete", "picks": picks}
        self.assertTrue(cube.complete_cube_opening(replay, 15))

        missing_p1p1 = {"draft_id": "missing", "picks": picks[1:]}
        self.assertFalse(cube.complete_cube_opening(missing_p1p1, 15))

        partial_p1p1 = json.loads(json.dumps(replay))
        partial_p1p1["picks"][0]["candidates"] = [{"id": "lotus"}]
        self.assertFalse(cube.complete_cube_opening(partial_p1p1, 15))

        incomplete_pack = json.loads(json.dumps(replay))
        incomplete_pack["picks"] = [pick for pick in incomplete_pack["picks"] if pick["pick_number"] != 12]
        self.assertFalse(cube.complete_cube_opening(incomplete_pack, 15))

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


if __name__ == "__main__":
    unittest.main()
