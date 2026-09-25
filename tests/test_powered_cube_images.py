import unittest

from scripts import refresh_powered_cube_images as images
from scripts.fetch_card_metadata import aliases


class PoweredCubeImageRefreshTests(unittest.TestCase):
    def card(self, **overrides):
        card = {
            "name": "Black Lotus",
            "lang": "en",
            "frame": "2015",
            "released_at": "2025-01-01",
            "promo": False,
            "full_art": False,
            "textless": False,
            "oversized": False,
            "digital": False,
            "border_color": "black",
            "set_type": "masters",
            "frame_effects": [],
            "mana_cost": "{0}",
            "rarity": "rare",
            "type_line": "Artifact",
            "image_uris": {"normal": "https://cards.example/normal.jpg"},
        }
        card.update(overrides)
        return card

    def test_standard_text_printing_beats_cosmetic_variants(self):
        standard = self.card()
        special = self.card(
            promo=True,
            full_art=True,
            textless=True,
            border_color="borderless",
            frame_effects=["showcase"],
            image_uris={"normal": "https://cards.example/promo.jpg"},
        )
        self.assertLess(images.printing_rank(standard, "Black Lotus"), images.printing_rank(special, "Black Lotus"))
        self.assertEqual(images.special_flags(standard), [])
        self.assertIn("full_art", images.special_flags(special))
        self.assertIn("textless", images.special_flags(special))

    def test_original_ordinary_printing_beats_newer_ordinary_reprint(self):
        original = self.card(id="original", released_at="1993-08-05", image_uris={"normal":"https://cards.example/original.jpg"})
        reprint = self.card(id="reprint", released_at="2026-01-01", image_uris={"normal":"https://cards.example/reprint.jpg"})
        self.assertLess(images.printing_rank(original, "Black Lotus"), images.printing_rank(reprint, "Black Lotus"))

    def test_face_alias_uses_matching_face_image_and_text(self):
        card = self.card(
            name="Front // Back",
            image_uris=None,
            card_faces=[
                {
                    "name": "Front",
                    "mana_cost": "{1}{U}",
                    "type_line": "Creature",
                    "image_uris": {"normal": "https://cards.example/front.jpg"},
                },
                {
                    "name": "Back",
                    "mana_cost": "",
                    "type_line": "Land",
                    "image_uris": {"normal": "https://cards.example/back.jpg"},
                },
            ],
        )
        metadata = images.metadata_for_alias(card, "Back")
        self.assertEqual(metadata["image_url"], "https://cards.example/back.jpg")
        self.assertEqual(metadata["type_line"], "Land")

    def test_flavor_names_are_resolved_as_card_aliases(self):
        card = self.card(name="Spectacular Spider-Man", flavor_name="Ademi of the Silkchutes")
        self.assertIn("Spectacular Spider-Man", set(aliases(card)))
        self.assertIn("Ademi of the Silkchutes", set(aliases(card)))

    def test_prepare_spell_name_does_not_alias_over_standalone_card(self):
        card = self.card(
            name="Harmonized Trio // Brainstorm",
            keywords=["Prepared"],
            card_faces=[
                {
                    "name": "Harmonized Trio",
                    "mana_cost": "{U}",
                    "type_line": "Creature — Merfolk Bard Wizard",
                    "oracle_text": "Tap two untapped creatures you control: This creature becomes prepared.",
                },
                {
                    "name": "Brainstorm",
                    "mana_cost": "{U}",
                    "type_line": "Instant",
                    "oracle_text": "Draw three cards, then put two cards from your hand on top of your library in any order.",
                },
            ],
        )
        names = set(aliases(card))
        self.assertIn("Harmonized Trio // Brainstorm", names)
        self.assertIn("Harmonized Trio", names)
        self.assertNotIn("Brainstorm", names)

    def test_patch_changes_display_fields_without_touching_gameplay_metadata(self):
        original = {
            "id": "black-lotus",
            "name": "Black Lotus",
            "image_url": "https://cards.example/promo.jpg",
            "mana_cost": "{0}",
            "rarity": "rare",
            "type_line": "Artifact",
            "model_probability": 0.42,
        }
        updated, changed = images.patch_card(original, {
            "Black Lotus": {
                "image_url": "https://cards.example/normal.jpg",
                "mana_cost": "{0}",
                "rarity": "rare",
                "type_line": "Artifact",
            }
        })
        self.assertTrue(changed)
        self.assertEqual(updated["image_url"], "https://cards.example/normal.jpg")
        self.assertEqual(updated["id"], original["id"])
        self.assertEqual(updated["name"], original["name"])
        self.assertEqual(updated["model_probability"], original["model_probability"])


if __name__ == "__main__":
    unittest.main()
