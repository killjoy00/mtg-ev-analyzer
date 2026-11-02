import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_replays
import traditional_phase2 as historical
import traditional_v4_revalidation as current
from traditional_puzzles import THRESHOLDS


class TraditionalV4RevalidationTests(unittest.TestCase):
    def test_scope_and_historical_exclusions_are_frozen(self):
        self.assertEqual(len(current.SETS), 26)
        self.assertEqual(
            set(current.EXCLUSIONS),
            {"tmt", "ecl", "tla", "mid", "vow", "stx", "hob"},
        )
        self.assertFalse(set(current.SETS) & set(current.EXCLUSIONS))
        self.assertEqual(current.serving_window(current.CUBE), (2, 9))
        self.assertEqual(current.late_floor(current.CUBE), 8)

    def test_v4_identity_is_distinct_from_readable_v3_history(self):
        self.assertEqual(build_replays.MODEL_VERSION, "strong-player-colour-stage-v3")
        self.assertEqual(
            build_replays.ISOLATED_MODEL_VERSION,
            "strong-player-colour-stage-v4",
        )
        self.assertEqual(historical.COMPONENT, "traditional-premier-v3-phase2-v1")
        self.assertEqual(current.COMPONENT, "traditional-premier-v4-phase2-v1")
        self.assertEqual(current.PARENT, "elite-trophy-colour-stage-v8")
        self.assertEqual(current.MODEL, build_replays.ISOLATED_MODEL_VERSION)
        self.assertNotEqual(historical.COMPONENT, current.COMPONENT)

    def test_frozen_gates_are_not_redeclared_or_relaxed(self):
        self.assertEqual(
            THRESHOLDS,
            {
                "minimum_trajectories_each": 100,
                "minimum_sets": 3,
                "absolute_ece_max": .15,
                "ece_increase_max": .04,
                "disagreement_increase_max": .10,
                "low_support_increase_max": .03,
                "mean_support_score_drop_max": 8,
                "alternative_low_increase_max": .05,
                "alternative_95_shift_max": .05,
                "difficulty_total_variation_max": .15,
                "unusable_trajectory_fraction_max": .05,
            },
        )
        source = (ROOT / "scripts" / "traditional_v4_revalidation.py").read_text()
        self.assertIn("from traditional_puzzles import THRESHOLDS, compare, record", source)

    def test_revalidation_cannot_use_legacy_shared_v3_builder(self):
        source = (ROOT / "scripts" / "traditional_v4_revalidation.py").read_text()
        self.assertNotIn("collect_legacy_v3", source)
        self.assertNotIn("build_colour_table(", source)
        self.assertIn("collect_isolated", source)
        self.assertIn("build_colour_tables_by_fold", source)
        self.assertIn("CountStore.empty()", source)

    def test_traditional_source_is_rejected_if_it_reaches_premier_training(self):
        class Fold:
            def __init__(self):
                self.training_ids = frozenset({"collision"})
                self.held_out_ids = frozenset()

        built = {
            "training": {"collision"},
            "fold_training": [Fold(), Fold(), Fold(), Fold(), Fold()],
            "models": [object(), object(), object(), object(), object()],
        }
        with self.assertRaisesRegex(AssertionError, "Traditional source ID collides"):
            current.grader_for("TradDraft", "collision", built)

    def test_candidate_identity_cannot_relabel_v3_as_v4(self):
        self.assertEqual(current.PREVIOUS_MODEL, "strong-player-colour-stage-v3")
        self.assertEqual(current.MODEL, "strong-player-colour-stage-v4")
        self.assertEqual(current.CUBE_COMPONENT, "traditional-cube-p2p7-v4-v1")
        self.assertNotIn("-v3-", current.COMPONENT)
        self.assertNotIn("-v3-", current.CUBE_COMPONENT)

    def test_image_resolution_uses_main_art_not_newest_printing(self):
        prints = "https://api.scryfall.com/cards/search?q=oracleid%3Acolonnade&unique=prints"

        def card(set_code, set_type, released, number, layout="normal"):
            return {
                "name": "Celestial Colonnade", "layout": layout, "set": set_code,
                "set_type": set_type, "released_at": released, "collector_number": number,
                "lang": "en", "rarity": "rare", "type_line": "Land", "id": set_code,
                "image_uris": {"normal": f"https://img.test/{set_code}.jpg"},
                "prints_search_uri": prints,
            }

        art_series = card("aeoe", "memorabilia", "2025-08-01", "40", "art_series")
        pages = {
            "https://api.scryfall.com/cards/named?exact=Celestial%20Colonnade": art_series,
            prints: {"data": [
                art_series,
                card("eos", "masterpiece", "2025-08-01", "3"),
                card("uma", "masters", "2018-12-07", "238"),
                card("wwk", "expansion", "2010-02-05", "133"),
            ]},
        }
        requested = []

        def request(url, method="GET"):
            requested.append(url)
            return contextlib.nullcontext(io.BytesIO(json.dumps(pages[url]).encode()))

        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(current, "resilient_request", request), \
                mock.patch.object(current.time, "sleep"):
            cache = Path(tmp) / "images.json"
            cube = current.resolve_research_images({"Celestial Colonnade"}, {}, cache)
            self.assertEqual(cube["Celestial Colonnade"]["image_url"], "https://img.test/wwk.jpg")
            # The cache is scoped to its policy and environment: a set lookup
            # re-resolves instead of reusing the global choice.
            regular = current.resolve_research_images(
                {"Celestial Colonnade"}, {}, cache, "eoe"
            )
            self.assertEqual(regular["Celestial Colonnade"]["image_url"], "https://img.test/eos.jpg")
            self.assertEqual(requested.count(prints), 2)

    def test_image_cache_never_overrides_environment_metadata(self):
        stale = {"Loot, the Pathfinder": {"image_url": "https://img.test/art-series.jpg"}}
        known = {"Loot, the Pathfinder": {"image_url": "https://img.test/dft.jpg"}}
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(current, "resilient_request", side_effect=AssertionError):
            cache = Path(tmp) / "images.json"
            # A cache written before the main-art policy is ignored outright.
            cache.write_text(json.dumps(stale))
            self.assertEqual(current.resolve_research_images(set(known), dict(known), cache, "dft"), known)
            # A current-policy cache still never replaces environment metadata.
            cache.write_text(json.dumps({current.IMAGE_CACHE_POLICY_KEY: "main-art-v1:dft", **stale}))
            self.assertEqual(current.resolve_research_images(set(known), dict(known), cache, "dft"), known)

    def test_seed_metadata_is_scoped_to_the_measured_environment(self):
        source = (ROOT / "scripts" / "traditional_v4_revalidation.py").read_text()
        self.assertIn("known = metadata(ROOT, sid)", source)
        self.assertNotIn("metadata(ROOT)", source)
        self.assertNotIn("compact_card", source)

    def test_format_training_audit_is_disjoint(self):
        audit = current.format_training_audit()
        self.assertTrue(audit["valid_despite_issue_164"], audit)
        self.assertFalse(audit["rerun_required"])
        self.assertTrue(all(audit["checks"].values()))


if __name__ == "__main__":
    unittest.main()
