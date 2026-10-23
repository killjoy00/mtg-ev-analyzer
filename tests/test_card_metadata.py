import csv
import gzip
import io
import tempfile
import unittest
import urllib.error
from unittest import mock
from pathlib import Path

from scripts.fetch_card_metadata import aliases, choose_main_printing, draft_printing_priority, compact_card, discover_draft_data, draft_candidate_names, fetch_named, fetch_set, image_url, request_json


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

    def test_otj_pack_uses_breaking_news_printing_not_older_art(self):
        old = {"id": "ktk-ride-down", "name": "Ride Down", "set": "ktk",
               "lang": "en", "released_at": "2014-09-26", "collector_number": "194",
               "image_uris": {"normal": "https://img/ktk-ride-down.jpg"}}
        otp = {"id": "otp-ride-down", "name": "Ride Down", "set": "otp",
               "lang": "en", "released_at": "2024-04-19", "collector_number": "52",
               "border_color": "borderless", "frame_effects": ["inverted"],
               "image_uris": {"normal": "https://img/otp-ride-down.jpg"}}
        collector_only = {**otp, "id": "otp-special", "collector_number": "92",
                          "variation": True, "image_uris": {"normal": "https://img/special.jpg"}}
        self.assertEqual(choose_main_printing([old, collector_only, otp], "Ride Down", "otj")["id"], "otp-ride-down")
        self.assertEqual(choose_main_printing([old, collector_only, otp], "Ride Down")["id"], "ktk-ride-down")
        self.assertEqual(draft_printing_priority(otp, "otj"), 1)

    def test_only_verified_bonus_sheets_count_as_draft_sources(self):
        base = {"id": "old", "name": "Alpha", "set": "old", "lang": "en",
                "released_at": "2000-01-01", "collector_number": "1",
                "image_uris": {"normal": "https://img/old.jpg"}}
        for draft_set, bonus_set in (("bro", "brr"), ("mom", "mul"), ("sir", "sis"),
                                     ("woe", "wot"), ("otj", "big")):
            with self.subTest(draft_set=draft_set):
                bonus = {**base, "id": bonus_set, "set": bonus_set, "released_at": "2024-04-19",
                         "border_color": "borderless", "image_uris": {"normal": f"https://img/{bonus_set}.jpg"}}
                self.assertEqual(choose_main_printing([base, bonus], "Alpha", draft_set)["id"], bonus_set)
                self.assertEqual(draft_printing_priority(bonus, draft_set), 1)
        commander = {**base, "id": "commander", "set": "otc", "released_at": "2024-04-19"}
        self.assertEqual(draft_printing_priority(commander, "otj"), 2)
        self.assertEqual(choose_main_printing([base, commander], "Alpha", "otj")["id"], "old")
        token = {**base, "id": "token", "set": "otj", "set_type": "token",
                 "released_at": "2024-04-19"}
        self.assertEqual(draft_printing_priority(token, "otj"), 2)
        self.assertEqual(choose_main_printing([base, token], "Alpha", "otj")["id"], "old")

    def test_bonus_sheet_base_numbers_win_even_if_variant_looks_plainer(self):
        # Scryfall's special-frame metadata is not by itself a reliable signal:
        # a bonus sheet's default art may itself be borderless/showcase.
        old = {"id": "old", "name": "Alpha", "set": "old",
               "lang": "en", "released_at": "2000-01-01", "collector_number": "1",
               "image_uris": {"normal": "https://img/old.jpg"}}
        cases = (
            ("bro", "brr", 63),
            ("mom", "mul", 65),
            ("woe", "wot", 63),
            ("otj", "otp", 65),
            ("otj", "big", 30),
            ("fin", "fca", 64),
            ("eoe", "eos", 45),
            ("tla", "tle", 61),
            ("tmt", "pza", 20),
            ("sos", "soa", 65),
        )
        for draft_set, source_set, max_base in cases:
            with self.subTest(draft_set=draft_set, source_set=source_set):
                base = {**old, "id": "source-base", "set": source_set,
                        "collector_number": str(max_base), "released_at": "2024-04-19",
                        "border_color": "borderless", "frame_effects": ["showcase"],
                        "image_uris": {"normal": "https://img/base.jpg"}}
                alternate = {**old, "id": "alternate", "set": source_set,
                             "collector_number": str(max_base + 1),
                             "released_at": "2024-04-19",
                             "image_uris": {"normal": "https://img/alternate.jpg"}}
                self.assertEqual(draft_printing_priority(base, draft_set), 1)
                self.assertEqual(draft_printing_priority(alternate, draft_set), 2)
                self.assertEqual(
                    choose_main_printing([old, alternate, base], "Alpha", draft_set)["id"],
                    "source-base",
                )
                # If the bonus sheet has no official base art for this name,
                # never choose its collector-only printing instead of plain art.
                self.assertEqual(
                    choose_main_printing([old, alternate], "Alpha", draft_set)["id"],
                    "old",
                )

    def test_shared_bonus_set_codes_are_scoped_to_the_correct_release(self):
        old = {"id": "old", "name": "Alpha", "set": "old", "lang": "en",
               "released_at": "2000-01-01", "collector_number": "1",
               "image_uris": {"normal": "https://img/old.jpg"}}
        cases = (
            ("mkm", "spg", 19, 28), ("otj", "spg", 29, 38),
            ("mh3", "spg", 39, 48), ("blb", "spg", 54, 63),
            ("dsk", "spg", 64, 73), ("fdn", "spg", 74, 83),
            ("dft", "spg", 84, 93), ("tdm", "spg", 104, 113),
            ("eoe", "spg", 119, 128), ("ecl", "spg", 129, 148),
            ("sos", "spg", 149, 158), ("msh", "mar", 41, 100),
        )
        for draft_set, source, first, last in cases:
            with self.subTest(draft_set=draft_set):
                base = {**old, "id": "base", "set": source,
                        "collector_number": str(first), "released_at": "2026-01-01",
                        "border_color": "borderless", "frame_effects": ["inverted"]}
                for number in (first, last):
                    self.assertEqual(draft_printing_priority(
                        {**base, "collector_number": str(number)}, draft_set), 1)
                for number in (first - 1, last + 1, f"{first}z", "", "invalid"):
                    outside = {**old, "id": "outside", "set": source,
                               "collector_number": str(number), "released_at": "2026-01-01"}
                    self.assertEqual(draft_printing_priority(outside, draft_set), 2)
                    for options in ([outside, old, base], [base, old, outside]):
                        self.assertEqual(choose_main_printing(options, "Alpha", draft_set)["id"], "base")
                        self.assertEqual(choose_main_printing(options, "Alpha")["id"], "old")
                primary = {**base, "id": "primary", "set": draft_set}
                self.assertEqual(choose_main_printing([old, base, primary], "Alpha", draft_set)["id"], "primary")

    def test_non_draft_products_do_not_gain_bonus_source_priority(self):
        card = {"set": "spg", "collector_number": "1"}
        self.assertEqual(draft_printing_priority(card, "lci"), 2)  # Set Boosters only.
        self.assertEqual(draft_printing_priority({"set": "tle", "collector_number": "155"}, "tla"), 2)
        self.assertEqual(draft_printing_priority({"set": "mar", "collector_number": "9"}, "msh"), 2)

    def test_same_set_normal_printing_wins_over_cosmetic_alternates(self):
        base = {"id": "base", "name": "Alpha", "set": "otj",
                "lang": "en", "released_at": "2024-04-19", "collector_number": "12",
                "image_uris": {"normal": "https://img/base.jpg"}}
        for flags in ({"variation": True}, {"textless": True},
                      {"promo": True}, {"oversized": True},
                      {"full_art": True}, {"frame_effects": ["extendedart"]},
                      {"border_color": "borderless"}):
            with self.subTest(flags=flags):
                alt = {**base, "id": "alternate", "collector_number": "300",
                       "image_uris": {"normal": "https://img/alternate.jpg"},
                       **flags}
                self.assertEqual(
                    choose_main_printing([alt, base], "Alpha", "otj")["id"],
                    "base",
                )

    def test_source_only_promo_falls_back_to_simple_other_set_art(self):
        old = {"id": "old", "name": "Alpha", "set": "ktk", "lang": "en",
               "released_at": "2014-09-26", "collector_number": "1",
               "image_uris": {"normal": "https://img/old.jpg"}}
        promo = {**old, "id": "promo", "set": "otj", "released_at": "2024-04-19",
                 "promo": True, "image_uris": {"normal": "https://img/promo.jpg"}}
        self.assertEqual(draft_printing_priority(promo, "otj"), 2)
        self.assertEqual(
            choose_main_printing([promo, old], "Alpha", "otj")["id"], "old"
        )

    def test_otj_special_guests_are_limited_to_the_2024_collector_range(self):
        old = {"id": "old", "name": "Stoneforge Mystic", "set": "wwk", "lang": "en",
               "released_at": "2010-02-05", "collector_number": "20",
               "image_uris": {"normal": "https://img/old.jpg"}}
        guest = {**old, "id": "guest-29", "set": "spg", "collector_number": "29",
                 "border_color": "borderless", "released_at": "2024-04-19"}
        unrelated = {**old, "id": "guest-200", "set": "spg", "collector_number": "200",
                     "released_at": "2026-01-01"}
        self.assertEqual(draft_printing_priority(guest, "otj"), 1)
        self.assertEqual(draft_printing_priority(unrelated, "otj"), 2)
        self.assertEqual(choose_main_printing([old, guest, unrelated], "Stoneforge Mystic", "otj")["id"], "guest-29")
        self.assertEqual(choose_main_printing([old, unrelated], "Stoneforge Mystic", "otj")["id"], "old")

    def test_main_draft_set_wins_before_cosmetic_penalty(self):
        old = {"id": "old", "name": "Alpha", "set": "old", "lang": "en",
               "released_at": "2001-01-01", "collector_number": "1",
               "image_uris": {"normal": "https://img/old.jpg"}}
        drafted = {**old, "id": "current", "set": "abc", "released_at": "2026-01-01",
                   "full_art": True, "image_uris": {"normal": "https://img/current.jpg"}}
        self.assertEqual(choose_main_printing([old, drafted], "Alpha", "abc")["id"], "current")

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

    def test_named_lookup_canonicalizes_hbg_rebalanced_adventure(self):
        prints = "https://api.scryfall.com/cards/search?q=oracleid%3Aoracle-monster&unique=prints"
        resolved = {
            "id": "arena-rebalanced",
            "oracle_id": "oracle-monster",
            "prints_search_uri": prints,
            "name": "A-Monster Manual // A-Zoological Study",
            "set": "hbg",
            "lang": "en",
            "released_at": "2022-07-07",
            "collector_number": "217",
            "digital": True,
            "card_faces": [
                {
                    "name": "A-Monster Manual",
                    "mana_cost": "{3}{G}",
                    "type_line": "Artifact — Book",
                    "image_uris": {"normal": "https://img/a-monster-manual.jpg"},
                },
                {
                    "name": "A-Zoological Study",
                    "mana_cost": "{2}{G}",
                    "type_line": "Sorcery — Adventure",
                    "image_uris": {"normal": "https://img/a-zoological-study.jpg"},
                },
            ],
        }
        with mock.patch(
            "scripts.fetch_card_metadata.request_json",
            side_effect=[resolved, {"data": [resolved], "has_more": False}],
        ) as request, mock.patch("scripts.fetch_card_metadata.time.sleep"):
            chosen = fetch_named("A-Monster Manual", "hbg")
        self.assertEqual(chosen["id"], "arena-rebalanced")
        self.assertIn("A-Monster%20Manual%20//%20A-Zoological%20Study", request.call_args_list[0].args[0])

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
