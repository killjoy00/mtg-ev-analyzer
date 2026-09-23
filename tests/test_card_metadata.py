import csv
import gzip
import io
import tempfile
import unittest
import urllib.error
from unittest import mock
from pathlib import Path

from scripts.fetch_card_metadata import aliases, choose_main_printing, compact_card, discover_draft_data, draft_candidate_names, fetch_named, fetch_set, image_url, request_json


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

    def test_main_art_prefers_base_variant_in_requested_set(self):
        old_print = {"id":"old","name":"Alpha","set":"old","lang":"en","released_at":"2020-01-01","collector_number":"12","image_uris":{"normal":"https://img/old.jpg"}}
        base = {"id":"base","name":"Alpha","set":"new","lang":"en","released_at":"2026-01-01","collector_number":"12","image_uris":{"normal":"https://img/base.jpg"}}
        alternate = {"id":"alt","name":"Alpha","set":"new","lang":"en","released_at":"2026-01-01","collector_number":"301","variation":True,"image_uris":{"normal":"https://img/alt.jpg"}}
        chosen = choose_main_printing([alternate, old_print, base], "Alpha", "new")
        self.assertEqual(chosen["id"], "base")

    def test_requested_digital_set_beats_unrelated_paper_reprint(self):
        draft_set = {"id":"digital","name":"Alpha","set":"hbg","lang":"en","released_at":"2022-01-01","collector_number":"1","digital":True,"image_uris":{"normal":"https://img/hbg.jpg"}}
        paper = {"id":"paper","name":"Alpha","set":"old","lang":"en","released_at":"2001-01-01","collector_number":"1","digital":False,"image_uris":{"normal":"https://img/paper.jpg"}}
        chosen = choose_main_printing([paper, draft_set], "Alpha", "hbg")
        self.assertEqual(chosen["id"], "digital")

    def test_main_art_prefers_earliest_ordinary_printing_without_set(self):
        original = {"id":"original","name":"Alpha","set":"one","lang":"en","released_at":"2001-01-01","collector_number":"1","image_uris":{"normal":"https://img/original.jpg"}}
        reprint = {"id":"reprint","name":"Alpha","set":"two","lang":"en","released_at":"2026-01-01","collector_number":"1","image_uris":{"normal":"https://img/reprint.jpg"}}
        chosen = choose_main_printing([reprint, original], "Alpha")
        self.assertEqual(chosen["id"], "original")

    def test_fetch_set_chooses_main_art_independent_of_api_order(self):
        alternate = {"id":"alt","name":"Alpha","set":"abc","lang":"en","released_at":"2026-01-01","collector_number":"301","variation":True,"image_uris":{"normal":"https://img/alt.jpg"}}
        base = {"id":"base","name":"Alpha","set":"abc","lang":"en","released_at":"2026-01-01","collector_number":"12","image_uris":{"normal":"https://img/base.jpg"}}
        with mock.patch("scripts.fetch_card_metadata.request_json", return_value={"data":[alternate, base],"has_more":False}):
            records = fetch_set("ABC")
        self.assertEqual(records["Alpha"]["image_url"], "https://img/base.jpg")

    def test_named_lookup_reselects_main_art_from_all_printings(self):
        prints = "https://api.scryfall.com/cards/search?order=released&q=oracleid%3Aoracle-alpha&unique=prints"
        default = {"id":"default","oracle_id":"oracle-alpha","prints_search_uri":prints,"name":"Alpha","set":"new","lang":"en","released_at":"2026-01-01","collector_number":"1","image_uris":{"normal":"https://img/default.jpg"}}
        original = {"id":"original","oracle_id":"oracle-alpha","name":"Alpha","set":"old","lang":"en","released_at":"2001-01-01","collector_number":"1","image_uris":{"normal":"https://img/original.jpg"}}
        with mock.patch("scripts.fetch_card_metadata.request_json", side_effect=[default, {"data":[default, original],"has_more":False}]) as request, mock.patch("scripts.fetch_card_metadata.time.sleep"):
            chosen = fetch_named("Alpha")
        self.assertEqual(chosen["id"], "original")
        self.assertEqual(request.call_count, 2)
        self.assertEqual(request.call_args_list[1].args[0], prints)

    def test_fuzzy_lookup_keeps_original_draft_name_coverage(self):
        prints = "https://api.scryfall.com/cards/search?q=oracleid%3Aoracle-alpha&unique=prints"
        resolved = {"id":"canonical","name":"Alpha Prime","oracle_id":"oracle-alpha","prints_search_uri":prints,"image_uris":{"normal":"https://img/canonical.jpg"}}
        original = {"id":"original","name":"Alpha Prime","set":"old","lang":"en","released_at":"2001-01-01","collector_number":"1","image_uris":{"normal":"https://img/original.jpg"}}
        missing = urllib.error.HTTPError("https://api.scryfall.com/cards/named",404,"Not Found",{},None)
        with mock.patch("scripts.fetch_card_metadata.request_json", side_effect=[RuntimeError("Could not fetch Scryfall metadata: HTTP Error 404"), resolved, {"data":[original],"has_more":False}]), mock.patch("scripts.fetch_card_metadata.time.sleep"):
            chosen = fetch_named("Alpha-Prme")
        self.assertEqual(chosen["id"], "original")

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


    def test_request_json_retries_rate_limit_with_backoff(self):
        rate_limit = urllib.error.HTTPError(
            "https://api.scryfall.com/cards/search",
            429,
            "Too Many Requests",
            {"Retry-After": "3"},
            None,
        )
        with mock.patch(
            "scripts.fetch_card_metadata.urllib.request.urlopen",
            side_effect=[rate_limit, io.BytesIO(b'{"ok": true}')],
        ) as urlopen, mock.patch("scripts.fetch_card_metadata.time.sleep") as sleep:
            self.assertEqual(request_json("https://api.scryfall.com/cards/search"), {"ok": True})
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(3.0)

    def test_request_json_does_not_retry_nontransient_http_error(self):
        missing = urllib.error.HTTPError(
            "https://api.scryfall.com/cards/named",
            404,
            "Not Found",
            {},
            None,
        )
        with mock.patch(
            "scripts.fetch_card_metadata.urllib.request.urlopen",
            side_effect=missing,
        ) as urlopen, mock.patch("scripts.fetch_card_metadata.time.sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "HTTP Error 404"):
                request_json("https://api.scryfall.com/cards/named")
        self.assertEqual(urlopen.call_count, 1)
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
