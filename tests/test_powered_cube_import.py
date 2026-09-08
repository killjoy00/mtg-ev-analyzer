import csv
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

    def test_model_archive_removes_only_incomplete_raw_p1p1(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.csv.gz"
            output = root / "model.csv.gz"
            fieldnames = ["draft_id", "pack_number", "pick_number", "pack_card_A", "pack_card_B"]
            rows = [
                {"draft_id": "d1", "pack_number": "0", "pick_number": "0", "pack_card_A": "1", "pack_card_B": "0"},
                {"draft_id": "d1", "pack_number": "0", "pick_number": "1", "pack_card_A": "1", "pack_card_B": "1"},
                # A legitimate late one-card decision must remain.
                {"draft_id": "d1", "pack_number": "0", "pick_number": "14", "pack_card_A": "1", "pack_card_B": "0"},
                # A complete future P1P1 row at the same coordinates must remain.
                {"draft_id": "d2", "pack_number": "0", "pick_number": "0", "pack_card_A": "1", "pack_card_B": "1"},
            ]
            # Keep this synthetic archive above the same 1 KB safety floor used
            # in production without weakening that guard for tests. These rows
            # use pack 2 coordinates so they cannot affect the P1P1 assertion.
            rows.extend(
                {
                    "draft_id": f"filler-{index:04d}-{index * 7919}",
                    "pack_number": "1",
                    "pick_number": str(index % 15),
                    "pack_card_A": "1" if index % 3 else "0",
                    "pack_card_B": "1" if index % 5 else "0",
                }
                for index in range(1000)
            )
            with gzip.open(source, "wt", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerows(rows)

            removed = cube.write_model_archive(source, output, complete_p1p1_candidates=2)
            self.assertEqual(removed, 1)
            with gzip.open(output, "rt", encoding="utf-8", newline="") as handle:
                kept = list(csv.DictReader(handle))
            self.assertEqual(
                [(row["draft_id"], row["pick_number"]) for row in kept[:3]],
                [("d1", "1"), ("d1", "14"), ("d2", "0")],
            )
            self.assertEqual(len(kept), 1003)
            self.assertGreater(output.stat().st_size, 1024)

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
    def _rendered_pack(*, start_pick: int, decisions: int, first_candidates: int, inherited_pool: bool):
        picks = []
        for offset in range(decisions):
            pick_number = start_pick + offset
            count = max(1, first_candidates - offset)
            picks.append({
                "pack_number": 1,
                "pick_number": pick_number,
                "historical_pick_id": f"p{pick_number}",
                "pool": {"Black Lotus": 1} if inherited_pool else {},
                "candidates": [{"id": f"c{pick_number}-{index}"} for index in range(count)],
            })
        return picks

    def test_cube_run_uses_full_p1p1_if_arena_restores_it(self):
        replay = {
            "draft_id": "full",
            "picks": self._rendered_pack(start_pick=1, decisions=15, first_candidates=15, inherited_pool=False),
        }
        prepared = cube.prepare_cube_run(replay, 14)
        self.assertIsNotNone(prepared)
        self.assertEqual(prepared["cube_start_pick"], 1)
        self.assertFalse(prepared["cube_missing_p1p1"])

    def test_cube_run_accepts_reindexed_p1p2_with_inherited_starter(self):
        replay = {
            "draft_id": "missing",
            # After incomplete raw P1P1 is removed, the builder normalizes the
            # fourteen visible P1P2-P1P15 decisions to pick numbers 1-14.
            "picks": self._rendered_pack(start_pick=1, decisions=14, first_candidates=14, inherited_pool=True),
        }
        prepared = cube.prepare_cube_run(replay, 14)
        self.assertIsNotNone(prepared)
        self.assertEqual(prepared["cube_start_pick"], 2)
        self.assertTrue(prepared["cube_missing_p1p1"])
        self.assertEqual(len(prepared["picks"][0]["candidates"]), 14)
        self.assertEqual(prepared["picks"][0]["pool"], {"Black Lotus": 1})

    def test_cube_run_rejects_partial_first_visible_pack_or_missing_pick(self):
        partial = {
            "draft_id": "partial",
            "picks": self._rendered_pack(start_pick=1, decisions=14, first_candidates=13, inherited_pool=True),
        }
        self.assertIsNone(cube.prepare_cube_run(partial, 14))

        incomplete = {
            "draft_id": "incomplete",
            "picks": self._rendered_pack(start_pick=1, decisions=14, first_candidates=14, inherited_pool=True),
        }
        incomplete["picks"] = [pick for pick in incomplete["picks"] if pick["pick_number"] != 10]
        self.assertIsNone(cube.prepare_cube_run(incomplete, 14))

        no_starter = {
            "draft_id": "no-starter",
            "picks": self._rendered_pack(start_pick=1, decisions=14, first_candidates=14, inherited_pool=False),
        }
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
