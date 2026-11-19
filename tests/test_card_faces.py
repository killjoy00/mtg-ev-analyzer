import copy
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.card_faces import display_faces
from scripts.fetch_card_metadata import metadata_for_alias
from scripts.build_card_face_metadata import build_registry, inventory_ids

FIXTURES = Path(__file__).parent / 'fixtures/card-faces/scryfall.json'


class CardFaceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cards = json.loads(FIXTURES.read_text())
        cls.by_id = {c['id']: c for c in cls.cards}

    def card(self, name):
        return next(c for c in self.cards if c['name'].split(' // ')[0] == name)

    def test_real_two_sided_layouts_and_same_printing_images(self):
        for name, back in [('Fable of the Mirror-Breaker','Reflection of Kiki-Jiki'), ('Bala Ged Recovery','Bala Ged Sanctuary'), ('Invasion of Zendikar','Awakened Skyclave')]:
            card = self.card(name)
            faces = display_faces(card)
            self.assertEqual([f['role'] for f in faces], ['front', 'back'])
            self.assertEqual(faces[1]['name'], back)
            self.assertTrue(all(card['id'] in f['image_url'] for f in faces))
            self.assertEqual(metadata_for_alias(card, name)['display_faces'], faces)

    def test_single_image_multiface_cards_do_not_get_a_fake_back(self):
        for name in ['Lightning Bolt', 'Fire', 'Brazen Borrower', 'Erayo, Soratami Ascendant']:
            self.assertEqual(display_faces(self.card(name)), [])
            self.assertNotIn('display_faces', metadata_for_alias(self.card(name), name))

    def test_meld_uses_related_result_and_explains_partner(self):
        card = self.card('Urza, Lord Protector')
        faces = display_faces(card, self.by_id.get)
        self.assertEqual(faces[1]['name'], 'Urza, Planeswalker')
        self.assertEqual(faces[1]['partner_name'], 'The Mightstone and Weakstone')
        self.assertEqual(faces[1]['role'], 'meld_result')
        with patch('scripts.fetch_card_metadata.related_card', side_effect=self.by_id.get):
            self.assertEqual(metadata_for_alias(card)['display_faces'], faces)
        self.assertEqual(display_faces(self.card('Urza, Planeswalker'), self.by_id.get), [])
        self.assertEqual(display_faces(card, lambda _: None), [])

    def test_missing_back_fails_inventory_generation_instead_of_silently_publishing(self):
        card = copy.deepcopy(self.card('Fable of the Mirror-Breaker'))
        card['card_faces'][1].pop('image_uris')
        with self.assertRaisesRegex(ValueError, 'Incomplete face metadata'):
            build_registry([card], {card['id']})

    def test_inventory_finds_pool_and_saved_printings_but_rejects_other_hosts(self):
        card = self.card('Fable of the Mirror-Breaker')
        url = card['card_faces'][0]['image_uris']['normal']
        self.assertEqual(inventory_ids({'answers':[{'puzzle':{'prior_picks':[{'image_url':url}]}}]}), {card['id']})
        self.assertEqual(inventory_ids({'image_url':url.replace('cards.scryfall.io','evil.invalid')}), set())


if __name__ == '__main__':
    unittest.main()
