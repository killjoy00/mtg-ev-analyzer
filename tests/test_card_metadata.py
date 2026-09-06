import unittest

from scripts.fetch_card_metadata import aliases, compact_card, image_url


class CardMetadataTests(unittest.TestCase):
    def test_single_face_card(self):
        card = {"name":"Alpha","image_uris":{"normal":"https://img/alpha.jpg"},"mana_cost":"{1}{U}","rarity":"common","type_line":"Creature"}
        self.assertEqual(image_url(card), "https://img/alpha.jpg")
        self.assertEqual(compact_card(card)["mana_cost"], "{1}{U}")
        self.assertEqual(list(aliases(card)), ["Alpha"])

    def test_double_face_uses_front_image_and_aliases_faces(self):
        card = {"name":"Front // Back","card_faces":[{"name":"Front","image_uris":{"normal":"https://img/front.jpg"}},{"name":"Back"}]}
        self.assertEqual(image_url(card), "https://img/front.jpg")
        self.assertEqual(list(aliases(card)), ["Front // Back", "Front", "Back"])


if __name__ == "__main__":
    unittest.main()
