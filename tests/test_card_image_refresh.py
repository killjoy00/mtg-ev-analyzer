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
