import unittest
from unittest import mock

from scripts import refresh_card_images as refresh


class CardImageRefreshTests(unittest.TestCase):
    def card(self, card_id, set_code, released_at, image, **overrides):
        card = {
            "id": card_id,
            "name": "Alpha",
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

    def test_inventory_uses_set_base_art_and_cube_original_art(self):
        original = self.card("original", "old", "2001-01-01", "https://img/original.jpg")
        set_base = self.card("set-base", "abc", "2026-01-01", "https://img/set-base.jpg")
        set_alt = self.card(
            "set-alt",
            "abc",
            "2026-01-01",
            "https://img/set-alt.jpg",
            collector_number="301",
            variation=True,
        )
        with mock.patch.object(refresh, "all_printings", return_value=iter([set_alt, set_base, original])):
            by_set, global_records, details = refresh.resolve_inventory({
                "abc": {"Alpha"},
                "powered-cube": {"Alpha"},
            })
        self.assertEqual(by_set["abc"]["Alpha"]["image_url"], "https://img/set-base.jpg")
        self.assertEqual(by_set["powered-cube"]["Alpha"]["image_url"], "https://img/original.jpg")
        self.assertEqual(global_records["Alpha"]["image_url"], "https://img/original.jpg")
        self.assertEqual(details["abc"], {})
        self.assertEqual(details["powered-cube"], {})

    def test_bulk_missing_name_uses_shared_named_resolver(self):
        fallback = self.card(
            "fallback",
            "hbg",
            "2022-07-07",
            "https://img/a-monster-manual.jpg",
            name="A-Monster Manual",
            digital=True,
        )
        with mock.patch.object(refresh, "all_printings", return_value=iter([])), mock.patch.object(
            refresh, "fetch_named", return_value=fallback
        ) as named:
            by_set, global_records, details = refresh.resolve_inventory({
                "hbg": {"A-Monster Manual"},
            })
        self.assertEqual(by_set["hbg"]["A-Monster Manual"]["image_url"], "https://img/a-monster-manual.jpg")
        self.assertEqual(global_records["A-Monster Manual"]["image_url"], "https://img/a-monster-manual.jpg")
        self.assertEqual(details["hbg"], {})
        self.assertGreaterEqual(named.call_count, 1)

    def test_reported_cube_cards_choose_base_dsk_printing(self):
        for name, collector in (("Enduring Innocence", "6"), ("Abhorrent Oculus", "42")):
            with self.subTest(name=name):
                base = self.card(
                    f"{name}-base",
                    "dsk",
                    "2024-09-27",
                    f"https://img/{name}-base.jpg",
                    name=name,
                    collector_number=collector,
                )
                alternate = self.card(
                    f"{name}-alternate",
                    "dsk",
                    "2024-09-27",
                    f"https://img/{name}-alternate.jpg",
                    name=name,
                    collector_number="386",
                    variation=True,
                    border_color="borderless",
                    frame_effects=["showcase"],
                )
                with mock.patch.object(refresh, "all_printings", return_value=iter([alternate, base])):
                    by_set, _, details = refresh.resolve_inventory({"powered-cube": {name}})
                self.assertEqual(by_set["powered-cube"][name]["image_url"], f"https://img/{name}-base.jpg")
                self.assertEqual(details["powered-cube"], {})

    def test_only_available_special_frame_is_marked_unavoidable(self):
        only = self.card(
            "only",
            "sld",
            "2024-11-04",
            "https://img/black-panther.jpg",
            name="Black Panther, Wakandan King",
            border_color="borderless",
            frame_effects=["inverted"],
        )
        with mock.patch.object(refresh, "all_printings", return_value=iter([only])):
            by_set, _, details = refresh.resolve_inventory({
                "msh": {"Black Panther, Wakandan King"},
            })
        self.assertEqual(
            by_set["msh"]["Black Panther, Wakandan King"]["image_url"],
            "https://img/black-panther.jpg",
        )
        detail = details["msh"]["Black Panther, Wakandan King"]
        self.assertEqual(detail["special_flags"], ["borderless", "inverted"])
        self.assertTrue(detail["special_unavoidable"])

    def test_patch_card_changes_display_metadata_only(self):
        original = {
            "id": "alpha",
            "name": "Alpha",
            "image_url": "https://img/alternate.jpg",
            "mana_cost": "{1}{U}",
            "rarity": "common",
            "type_line": "Creature",
            "model_probability": 0.42,
        }
        updated, changed = refresh.patch_card(original, {
            "image_url": "https://img/main.jpg",
            "mana_cost": "{1}{U}",
            "rarity": "common",
            "type_line": "Creature",
        })
        self.assertTrue(changed)
        self.assertEqual(updated["image_url"], "https://img/main.jpg")
        self.assertEqual(refresh.scrub_card(updated), refresh.scrub_card(original))


if __name__ == "__main__":
    unittest.main()
