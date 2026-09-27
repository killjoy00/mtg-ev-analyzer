import gzip
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import refresh_card_images as refresh
from scripts import repair_card_image as repair


class CardImageRepairTests(unittest.TestCase):
    def card(self, card_id, name, set_code, released_at, image, **overrides):
        card = {
            "id": card_id,
            "name": name,
            "set": set_code,
            "lang": "en",
            "released_at": released_at,
            "collector_number": "1",
            "promo": False,
            "full_art": False,
            "textless": False,
            "oversized": False,
            "digital": False,
            "variation": False,
            "border_color": "black",
            "set_type": "expansion",
            "frame_effects": [],
            "mana_cost": "{1}{U}",
            "rarity": "common",
            "type_line": "Creature",
            "image_uris": {"normal": image},
        }
        card.update(overrides)
        return card

    def test_targeted_selection_matches_full_refresh_for_titania(self):
        name = "Titania, Protector of Argoth"
        original = self.card(
            "224d904a-5972-4152-878a-9a922e7a55b6",
            name,
            "c14",
            "2014-11-07",
            "https://img/titania-c14.jpg",
            collector_number="50",
        )
        full_art = self.card(
            "titania-full-art",
            name,
            "mh2",
            "2021-06-18",
            "https://img/titania-full-art.jpg",
            collector_number="416",
            full_art=True,
            border_color="borderless",
        )
        with mock.patch.object(refresh, "all_printings", return_value=iter([full_art, original])):
            full = refresh.resolve_inventory({"powered-cube": {name}})[0]
        with mock.patch.object(refresh, "all_printings", return_value=iter([full_art, original])):
            targeted = repair.resolve_target(name, ["powered-cube"])[0]
        self.assertEqual(targeted, full)
        self.assertEqual(targeted["powered-cube"][name]["image_url"], "https://img/titania-c14.jpg")

    def test_targeted_selection_prefers_cosmogrand_base_eoe_printing(self):
        name = "Cosmogrand Zenith"
        standard = self.card(
            "b3c1e5e3-4e6b-456a-958c-7a75c38f8183",
            name,
            "eoe",
            "2025-08-01",
            "https://img/cosmogrand-eoe-9.jpg",
            collector_number="9",
        )
        borderless = self.card(
            "d68d891d-333f-46c9-b5a3-3b1d4d3e4563",
            name,
            "eoe",
            "2025-08-01",
            "https://img/cosmogrand-eoe-304.jpg",
            collector_number="304",
            border_color="borderless",
            frame_effects=["inverted"],
        )
        with mock.patch.object(refresh, "all_printings", return_value=iter([borderless, standard])):
            full = refresh.resolve_inventory({"eoe": {name}})[0]
        with mock.patch.object(refresh, "all_printings", return_value=iter([borderless, standard])):
            targeted = repair.resolve_target(name, ["eoe"])[0]
        self.assertEqual(targeted, full)
        self.assertEqual(targeted["eoe"][name]["image_url"], "https://img/cosmogrand-eoe-9.jpg")

    def test_targeted_selection_matches_full_refresh_for_regular_preferred_set(self):
        name = "Alpha"
        older = self.card("old", name, "old", "2001-01-01", "https://img/old.jpg")
        preferred = self.card("abc", name, "abc", "2026-01-01", "https://img/abc.jpg")
        with mock.patch.object(refresh, "all_printings", return_value=iter([older, preferred])):
            full = refresh.resolve_inventory({"abc": {name}})[0]
        with mock.patch.object(refresh, "all_printings", return_value=iter([older, preferred])):
            targeted = repair.resolve_target(name, ["abc"])[0]
        self.assertEqual(targeted, full)
        self.assertEqual(targeted["abc"][name]["image_url"], "https://img/abc.jpg")

    def test_targeted_selection_never_uses_named_or_fuzzy_fallback(self):
        with mock.patch.object(refresh, "all_printings", return_value=iter([])), mock.patch.object(
            refresh, "fetch_named"
        ) as named:
            records, _, _ = repair.resolve_target("Alpha", ["powered-cube"])
        self.assertEqual(records["powered-cube"], {})
        named.assert_not_called()

    def test_environment_validation_rejects_unknown_duplicate_and_too_many(self):
        catalog = {"sets": [{"id": "a"}, {"id": "b"}]}
        self.assertEqual(repair.parse_environments("a,b", catalog), ["a", "b"])
        self.assertEqual(repair.parse_environments("a, b", catalog), ["a", "b"])
        with self.assertRaisesRegex(ValueError, "Unknown environment"):
            repair.parse_environments("a,c", catalog)
        with self.assertRaisesRegex(ValueError, "duplicate"):
            repair.parse_environments("a,a", catalog)
        with self.assertRaisesRegex(ValueError, "at most"):
            repair.parse_environments(
                ",".join(str(i) for i in range(9)),
                {"sets": [{"id": str(i)} for i in range(9)]},
            )

    def test_exact_served_name_rejects_missing_near_miss_and_case_variant(self):
        checked = {"a": [{"name": "Alpha"}]}
        shards = {"a": [{"name": "Alpha"}]}
        repair.validate_served_name("Alpha", ["a"], checked, shards)
        for bad in ("alpha", "Alph"):
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, "not served exactly"):
                repair.validate_served_name(bad, ["a"], {"a": []}, {"a": []})
        with self.assertRaisesRegex(ValueError, "not served exactly"):
            repair.validate_served_name("Alpha", ["a"], checked, {"a": []})

    def test_card_name_rejects_path_url_sql_ref_backend_and_controls(self):
        for bad in (
            "../catalog.json",
            "/tmp/card",
            "C:\\temp\\card",
            "https://example.com/card",
            "DROP TABLE cards",
            "refs/heads/main",
            "refresh-image-page",
            "Alpha\nBeta",
        ):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                repair.validate_card_name(bad)
        self.assertEqual(
            repair.validate_card_name("Who // What // When // Where // Why"),
            "Who // What // When // Where // Why",
        )

    def test_card_id_collision_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "collision"):
            repair.fail_on_card_id_collisions(
                "Alpha",
                {"id1"},
                {"id1": {"Alpha", "Beta"}},
                {},
            )

    def test_shard_collision_scan_includes_non_target_environments(self):
        catalog = {"sets": [{"id": "a"}, {"id": "b"}]}
        names_by_id = {}
        cards = {
            "a": [{"id": "shared", "name": "Alpha"}],
            "b": [{"id": "shared", "name": "Beta"}],
        }
        with mock.patch.object(
            repair,
            "cards_in_shards",
            side_effect=lambda sid: iter(cards[sid]),
        ) as read_shards:
            targets = repair.collect_shard_inventory(
                catalog,
                "Alpha",
                ["a"],
                names_by_id,
            )
        self.assertEqual(read_shards.call_count, 2)
        self.assertEqual(targets, {"a": [cards["a"][0]]})
        self.assertEqual(names_by_id["shared"], {"Alpha", "Beta"})
        with self.assertRaisesRegex(ValueError, "collision"):
            repair.fail_on_card_id_collisions(
                "Alpha",
                {"shared"},
                names_by_id,
                {},
            )

    def test_dry_run_reports_expected_patch_without_mutating_sources(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            corpus_dir = root / "corpus" / "draft-run"
            shard_dir = root / "data" / "powered-cube" / "shards"
            report_path = root / "generated" / "card-image-repair" / "report.json"
            corpus_dir.mkdir(parents=True)
            shard_dir.mkdir(parents=True)
            original_card = {
                "id": "alpha-id",
                "name": "Alpha",
                "image_url": "https://img/wrong.jpg",
                "mana_cost": "{1}{U}",
                "rarity": "common",
                "type_line": "Creature",
                "model_probability": 0.42,
            }
            rows = [{"puzzle_id": "p1", "candidates": [original_card], "prior_picks": []}]
            corpus_path = corpus_dir / "powered-cube.json.gz"
            corpus_path.write_bytes(
                gzip.compress(json.dumps(rows, separators=(",", ":")).encode(), mtime=0)
            )
            shard_path = shard_dir / "part-1.json"
            shard_path.write_text(
                json.dumps(
                    {"replays": [{"picks": [{"candidates": [original_card]}]}]},
                    separators=(",", ":"),
                )
            )
            catalog_path = corpus_dir / "catalog.json"
            catalog_path.write_text(
                json.dumps(
                    {
                        "sets": [
                            {
                                "id": "powered-cube",
                                "sha256": "before",
                            }
                        ]
                    }
                )
            )
            card_images_path = corpus_dir / "card-images.json"
            card_images_path.write_text(
                json.dumps(
                    {
                        "alpha-id": {
                            "name": "Alpha",
                            "image_url": "https://img/wrong.jpg",
                            "mana_cost": "{1}{U}",
                            "rarity": "common",
                            "type_line": "Creature",
                        }
                    }
                )
            )
            chosen = self.card(
                "scryfall-alpha",
                "Alpha",
                "lea",
                "1993-08-05",
                "https://img/right.jpg",
            )
            before = {
                "corpus": corpus_path.read_bytes(),
                "shard": shard_path.read_bytes(),
                "catalog": catalog_path.read_bytes(),
                "card_images": card_images_path.read_bytes(),
            }
            with (
                mock.patch.object(refresh, "CORPUS_DIR", corpus_dir),
                mock.patch.object(refresh, "DATA_DIR", root / "data"),
                mock.patch.object(refresh, "CATALOG_PATH", catalog_path),
                mock.patch.object(refresh, "CARD_IMAGES_PATH", card_images_path),
                mock.patch.object(repair, "REPORT_PATH", report_path),
                mock.patch.object(refresh, "all_printings", return_value=iter([chosen])),
            ):
                report = repair.run_repair("Alpha", "powered-cube", dry_run=True)

            self.assertTrue(report["dry_run"])
            self.assertEqual(
                report["environment_results"]["powered-cube"]["after"]["image_url"],
                "https://img/right.jpg",
            )
            self.assertEqual(corpus_path.read_bytes(), before["corpus"])
            self.assertEqual(shard_path.read_bytes(), before["shard"])
            self.assertEqual(catalog_path.read_bytes(), before["catalog"])
            self.assertEqual(card_images_path.read_bytes(), before["card_images"])
            self.assertTrue(report_path.exists())


if __name__ == "__main__":
    unittest.main()
