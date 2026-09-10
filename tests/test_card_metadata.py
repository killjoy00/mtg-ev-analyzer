import csv
import gzip
import tempfile
import unittest
from pathlib import Path

from scripts.fetch_card_metadata import aliases, compact_card, discover_draft_data, draft_candidate_names, image_url


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

    def test_discovers_sibling_draft_archive_and_authoritative_card_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "sos-cards.json"
            archive = root / "draft_data_public.SOS.PremierDraft.csv.gz"
            fields = ["draft_id", "pack_card_Abrade", "pack_card_Ad Nauseam", "pool_Abrade"]
            with gzip.open(archive, "wt", encoding="utf-8", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerow({"draft_id": "d1", "pack_card_Abrade": 1, "pack_card_Ad Nauseam": 1, "pool_Abrade": 0})
            self.assertEqual(discover_draft_data(output, "SOS"), archive)
            self.assertEqual(draft_candidate_names(archive), {"Abrade", "Ad Nauseam"})


if __name__ == "__main__":
    unittest.main()
