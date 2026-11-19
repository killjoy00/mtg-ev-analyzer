import unittest
from unittest import mock

from scripts import refresh_card_images as refresh


RELEASES = {"otj": "2024-04-19", "fra": "2026-10-02", "sos": "2026-04-24", "abc": "2026-01-01", "ktk": "2014-09-26"}


class CardImageRefreshTests(unittest.TestCase):
    def setUp(self):
        from scripts import fetch_card_metadata as meta
        meta.register_set_releases(RELEASES, complete=True)

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

    def test_otj_bonus_art_is_display_only_and_accepted_as_intentional_frame(self):
        old = self.card("old-ride-down", "ktk", "2014-09-26",
                        "https://img/ride-down-ktk.jpg", name="Ride Down")
        otp = self.card("otp-ride-down", "otp", "2024-04-19",
                        "https://img/ride-down-otp.jpg", name="Ride Down",
                        collector_number="52", border_color="borderless",
                        frame_effects=["inverted"], games=["paper", "arena"], set_type="masterpiece")
        with mock.patch.object(refresh, "all_printings", return_value=iter([old, otp])):
            by_set, global_records, details = refresh.resolve_inventory({
                "otj": {"Ride Down"},
                "powered-cube": {"Ride Down"},
            })
        self.assertEqual(by_set["otj"]["Ride Down"]["image_url"], "https://img/ride-down-otp.jpg")
        self.assertEqual(by_set["powered-cube"]["Ride Down"]["image_url"], "https://img/ride-down-ktk.jpg")
        self.assertEqual(global_records["Ride Down"]["image_url"], "https://img/ride-down-ktk.jpg")
        self.assertEqual(details["otj"]["Ride Down"]["selected_set"], "otp")
        self.assertTrue(details["otj"]["Ride Down"]["draft_source_bonus"])
        self.assertTrue(details["otj"]["Ride Down"]["draft_source_special"])
        self.assertFalse(details["otj"]["Ride Down"]["special_unavoidable"])
        self.assertEqual(details["powered-cube"], {})

    def test_bonus_sheet_base_number_beats_plainer_collector_variant(self):
        old = self.card("old", "ktk", "2014-09-26", "https://img/old.jpg",
                        name="Ride Down")
        standard = self.card("otp-standard", "otp", "2024-04-19",
                             "https://img/otp-standard.jpg", name="Ride Down",
                             collector_number="52", border_color="borderless",
                             frame_effects=["showcase"], games=["arena"], set_type="masterpiece")
        # Collector variants are numbered after the sheet and may look plainer.
        variant = self.card("otp-variant", "otp", "2024-04-19",
                            "https://img/otp-variant.jpg", name="Ride Down",
                            collector_number="70", games=["arena"], set_type="masterpiece")
        with mock.patch.object(refresh, "all_printings",
                               return_value=iter([variant, old, standard])):
            by_set, global_records, details = refresh.resolve_inventory({
                "otj": {"Ride Down"},
                "powered-cube": {"Ride Down"},
            })
        self.assertEqual(by_set["otj"]["Ride Down"]["image_url"],
                         "https://img/otp-standard.jpg")
        self.assertEqual(global_records["Ride Down"]["image_url"],
                         "https://img/old.jpg")
        self.assertEqual(by_set["powered-cube"]["Ride Down"]["image_url"],
                         "https://img/old.jpg")
        self.assertTrue(details["otj"]["Ride Down"]["draft_source_bonus"])

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

    def test_funny_playtest_loses_to_normal_same_name_printing(self):
        playtest = self.card(
            "playtest",
            "cmb2",
            "2021-08-20",
            "https://img/playtest.jpg",
            name="Pick Your Poison",
            set_type="funny",
            mana_cost="{3}{B}{G}",
            rarity="rare",
            type_line="Sorcery",
        )
        real = self.card(
            "real",
            "mkm",
            "2024-02-09",
            "https://img/real.jpg",
            name="Pick Your Poison",
            mana_cost="{G}",
            rarity="common",
            type_line="Sorcery",
        )
        with mock.patch.object(refresh, "all_printings", return_value=iter([playtest, real])):
            by_set, global_records, details = refresh.resolve_inventory({"powered-cube": {"Pick Your Poison"}})
        self.assertEqual(by_set["powered-cube"]["Pick Your Poison"]["image_url"], "https://img/real.jpg")
        self.assertEqual(by_set["powered-cube"]["Pick Your Poison"]["mana_cost"], "{G}")
        self.assertEqual(global_records["Pick Your Poison"]["image_url"], "https://img/real.jpg")
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

    def test_served_inventory_adds_names_and_trophy_only_environments(self):
        import json, tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "served.json"
            path.write_text(json.dumps({"environments": {
                "fra": {"catalog": False, "names": ["Countersculpt"]},
                "tla": {"catalog": True, "names": ["Lightning Bolt"]},
            }}), encoding="utf-8")
            served = refresh.load_served_inventory(path)
            self.assertEqual(served, {"fra": {"Countersculpt"}, "tla": {"Lightning Bolt"}})
            names_by_set, names_by_id = refresh.collect_inventory({"sets": []}, served)
            self.assertEqual(names_by_set, {"fra": {"Countersculpt"}, "tla": {"Lightning Bolt"}})
            self.assertEqual(names_by_id, {})
            # The release requires the inventory; a missing file is not silently ignored.
            with self.assertRaisesRegex(ValueError, "required but missing"):
                refresh.load_served_inventory(Path(tmp) / "absent.json", required=True)
            self.assertEqual(refresh.load_served_inventory(Path(tmp) / "absent.json"), {})
            path.write_text(json.dumps({"environments": {"fra": {"names": []}}}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "invalid for fra"):
                refresh.load_served_inventory(path)

    def test_served_names_join_catalog_names_for_policy_resolution(self):
        import gzip, json, tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            corpus, data = Path(tmp) / "corpus", Path(tmp) / "data"
            (data / "tla" / "shards").mkdir(parents=True)
            corpus.mkdir()
            (corpus / "tla.json.gz").write_bytes(gzip.compress(json.dumps(
                [{"candidates": [{"id": "alpha", "name": "Alpha"}], "prior_picks": []}]).encode()))
            (data / "tla" / "shards" / "0.json").write_text(json.dumps(
                {"replays": [{"picks": [{"candidates": [{"id": "beta", "name": "Beta"}]}]}]}), encoding="utf-8")
            with mock.patch.object(refresh, "CORPUS_DIR", corpus), mock.patch.object(refresh, "DATA_DIR", data):
                names_by_set, _ = refresh.collect_inventory({"sets": [{"id": "tla"}]}, {"tla": {"Lightning Bolt"}})
                self.assertEqual(names_by_set["tla"], {"Alpha", "Beta", "Lightning Bolt"})
                # Without the served inventory, a served card outside the samples is invisible.
                names_by_set, _ = refresh.collect_inventory({"sets": [{"id": "tla"}]})
                self.assertNotIn("Lightning Bolt", names_by_set["tla"])

    def test_same_release_arena_printings_are_draft_sources(self):
        from scripts import fetch_card_metadata as meta
        guest = self.card("g", "spg", "2026-10-02", "https://img/g.jpg", collector_number="160",
                          games=["paper", "arena"], set_type="masterpiece")
        # FRA's Special Guests shipped with FRA on Arena: no per-set entry needed.
        self.assertEqual(meta.draft_printing_priority(guest, "fra"), 1)
        # Another release's guest, a paper-only printing, and same-day Commander
        # or Jumpstart products are not draft sources.
        self.assertEqual(meta.draft_printing_priority({**guest, "released_at": "2026-04-24"}, "fra"), 2)
        self.assertEqual(meta.draft_printing_priority({**guest, "games": ["paper", "mtgo"]}, "fra"), 2)
        for set_type in ("commander", "draft_innovation", "alchemy", "box", "token"):
            self.assertEqual(meta.draft_printing_priority({**guest, "set_type": set_type}, "fra"), 2, set_type)
        # An environment with no known release date gets no draft-source tier.
        self.assertEqual(meta.draft_printing_priority(guest, "zzz"), 2)

    def test_arena_substitute_guest_replaces_the_original_printing(self):
        # On Arena, Library of Alexandria (SPG 158a) replaces SOS's paper guest
        # Library of Leng (SPG 158).
        original = self.card("loa-arn", "arn", "1993-12-17", "https://img/loa-arn.jpg",
                             name="Library of Alexandria", collector_number="76")
        arena = self.card("loa-spg", "spg", "2026-04-24", "https://img/loa-spg.jpg",
                          name="Library of Alexandria", collector_number="158a", digital=True,
                          border_color="borderless", games=["arena"], set_type="masterpiece")
        with mock.patch.object(refresh, "all_printings", return_value=iter([original, arena])):
            by_set, _, details = refresh.resolve_inventory({"sos": {"Library of Alexandria"}}, allow_named_fallback=False)
        self.assertEqual(by_set["sos"]["Library of Alexandria"]["image_url"], "https://img/loa-spg.jpg")
        self.assertEqual(refresh.printing_choices(details), {"sos": {"Library of Alexandria": "spg/158a"}})

    def test_printing_choices_differences_need_review(self):
        details = {
            "sos": {"A": {"selected_set": "SPG", "collector_number": "158a"},
                    "Main": {"selected_set": "sos", "collector_number": "1", "special_flags": ["showcase"]}},
            "powered-cube": {"Cube": {"selected_set": "lea", "collector_number": "1"}},
        }
        choices = refresh.printing_choices(details)
        # Own-set choices and Powered Cube (global earliest printing) are not recorded.
        self.assertEqual(choices, {"sos": {"A": "spg/158a"}})
        names = {"sos": {"A", "B", "C"}, "powered-cube": {"Cube"}}
        self.assertEqual(refresh.compare_printing_choices(choices, choices, names), {"added": [], "changed": [], "removed": []})
        recorded = {"sos": {"A": "arn/76", "B": "soa/1", "Gone": "soa/2"}, "old": {"X": "y/1"}}
        current = {"sos": {"A": "spg/158a", "C": "spg/150"}}
        # Names and environments that are no longer served are dropped silently.
        self.assertEqual(refresh.compare_printing_choices(recorded, current, names), {
            "added": [["sos", "C", "spg/150"]],
            "changed": [["sos", "A", "arn/76", "spg/158a"]],
            "removed": [["sos", "B", "soa/1"]],
        })
        self.assertEqual(refresh.compare_printing_choices({}, current, names)["added"], [["sos", "A", "spg/158a"], ["sos", "C", "spg/150"]])

    def test_printing_record_round_trips_and_covers_reviewed_choices(self):
        import json
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "card-printings.json"
            refresh.write_printing_record(path, {"sos": {"A": "spg/158a"}})
            self.assertEqual(refresh.load_printing_record(path), {"sos": {"A": "spg/158a"}})
            self.assertEqual(refresh.load_printing_record(Path(tmp) / "missing.json"), {})
        record = refresh.load_printing_record()
        catalog = json.loads(refresh.CATALOG_PATH.read_text(encoding="utf-8"))
        environments = {entry["id"] for entry in catalog["sets"]} | {"fra"}
        self.assertLessEqual(set(record), environments)
        self.assertNotIn("powered-cube", record)
        for sid, choices in record.items():
            for name, printing in choices.items():
                self.assertRegex(printing, r"^[a-z0-9]+/[0-9]+[a-z]?$", f"{sid}: {name}")
                self.assertFalse(printing.startswith(sid + "/"), f"{sid}: {name}")
        self.assertEqual(record["sos"]["Library of Alexandria"], "spg/158a")
        self.assertEqual(sorted(int(p.split("/")[1]) for p in record["fra"].values()), list(range(159, 169)))
        self.assertEqual(record["msh"]["Counterspell"], "mar/52")
        self.assertEqual(record["tla"]["Lightning Bolt"], "tle/32")
        self.assertEqual(record["ecl"]["Bitterblossom"], "spg/133")

if __name__ == "__main__":
    unittest.main()
