import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from contextual_value.dataset import Decision
from contextual_value.rich_features import (
    PACK_RELATIVE_SIGNALS,
    rich_feature_bundle,
)


def decision():
    return Decision(
        draft_id="d1",
        expansion="MSH",
        event_type="PremierDraft",
        draft_time="2026-01-01T00:00:00Z",
        rank="Gold",
        pack_number=0,
        pick_number=5,
        selected_card="A",
        candidates=("A", "B", "C"),
        pool=(("Pool Blue", 2), ("Pool Red", 1), ("Pool Rock", 1)),
        user_game_win_rate=0.56,
        user_games_lower_bound=100,
        event_match_wins=5,
        event_match_losses=3,
    )


def base_features():
    common = {
        "pack_number": 0.0,
        "pick_number": 5.0,
        "pool_size": 4.0,
        "candidate_count": 3.0,
        "user_game_win_rate": 0.56,
        "log1p_user_games": 4.615,
        "set=MSH": 1.0,
        "rank=Gold": 1.0,
    }
    return {
        "A": {
            **common,
            "strong_choice_probability": 0.70,
            "log_strong_choice_probability": -0.357,
            "gih_wr": 0.60,
            "gnd_wr": 0.53,
            "deck_inclusion_probability": 0.75,
            "ata": 3.2,
            "alsa": 3.8,
            "log1p_gih_games": 7.0,
            "log1p_gnd_games": 6.5,
        },
        "B": {
            **common,
            "strong_choice_probability": 0.20,
            "log_strong_choice_probability": -1.609,
            "gih_wr": 0.55,
            "gnd_wr": 0.52,
            "deck_inclusion_probability": 0.65,
            "ata": 4.5,
            "alsa": 4.8,
            "log1p_gih_games": 6.8,
            "log1p_gnd_games": 6.2,
        },
        "C": {
            **common,
            "strong_choice_probability": 0.10,
            "log_strong_choice_probability": -2.303,
            "gih_wr": 0.50,
            "gnd_wr": 0.51,
            "deck_inclusion_probability": 0.45,
            "ata": 6.0,
            "alsa": 6.5,
            "log1p_gih_games": 6.0,
            "log1p_gnd_games": 5.8,
        },
    }


def metadata():
    return {
        "A": {
            "cmc": 2.0,
            "colors": ["U"],
            "color_identity": ["U"],
            "rarity": "uncommon",
            "type_line": "Creature — Wizard",
            "oracle_text": "Draw a card.",
        },
        "B": {
            "cmc": 4.0,
            "colors": ["R", "U"],
            "color_identity": ["R", "U"],
            "rarity": "rare",
            "type_line": "Creature — Dragon",
            "oracle_text": "",
        },
        "C": {
            "cmc": 3.0,
            "colors": [],
            "color_identity": [],
            "rarity": "common",
            "type_line": "Artifact",
            "oracle_text": "",
        },
        "Pool Blue": {
            "cmc": 2.0,
            "colors": ["U"],
            "color_identity": ["U"],
            "rarity": "common",
            "type_line": "Creature — Merfolk",
            "oracle_text": "",
        },
        "Pool Red": {
            "cmc": 3.0,
            "colors": ["R"],
            "color_identity": ["R"],
            "rarity": "common",
            "type_line": "Sorcery",
            "oracle_text": "",
        },
        "Pool Rock": {
            "cmc": 2.0,
            "colors": [],
            "color_identity": [],
            "rarity": "common",
            "type_line": "Artifact",
            "oracle_text": "{T}: Add one mana of any color.",
        },
    }


class RichFeatureTests(unittest.TestCase):
    def test_strong_player_fields_are_removed_from_ranking_features(self):
        state, candidates = rich_feature_bundle(decision(), base_features(), metadata())
        self.assertTrue(state)
        for row in candidates.values():
            self.assertNotIn("base:strong_choice_probability", row)
            self.assertNotIn("base:log_strong_choice_probability", row)

    def test_pool_and_candidate_context_are_pre_pick_and_candidate_specific(self):
        state, candidates = rich_feature_bundle(decision(), base_features(), metadata())
        self.assertAlmostEqual(state["state:pool_color_share:U"], 0.5)
        self.assertAlmostEqual(state["state:pool_color_share:R"], 0.25)
        self.assertAlmostEqual(state["state:pool_fixing_share"], 0.25)

        self.assertEqual(candidates["A"]["card:type:creature"], 1.0)
        self.assertEqual(candidates["B"]["card:is_multicolor"], 1.0)
        self.assertEqual(candidates["C"]["card:type:artifact"], 1.0)
        self.assertGreater(
            candidates["A"]["fit:color_support_mean"],
            candidates["B"]["fit:color_support_mean"],
        )
        for forbidden in (
            "event_match_wins",
            "selected_card",
            "future_picks",
            "actual_final_deck",
        ):
            self.assertNotIn(forbidden, state)
            self.assertTrue(all(forbidden not in row for row in candidates.values()))

    def test_pack_relative_features_capture_actual_pack_comparison(self):
        _state, candidates = rich_feature_bundle(decision(), base_features(), metadata())
        self.assertGreater(candidates["A"]["packrel:gih_wr:minus_best_other"], 0)
        self.assertEqual(candidates["A"]["packrel:gih_wr:percentile"], 1.0)
        self.assertLess(candidates["C"]["packrel:gih_wr:minus_best_other"], 0)
        self.assertEqual(candidates["C"]["packrel:gih_wr:percentile"], 0.0)

    def test_missing_metadata_is_explicit_not_fabricated(self):
        partial = metadata()
        partial.pop("C")
        state, candidates = rich_feature_bundle(decision(), base_features(), partial)
        self.assertEqual(candidates["C"]["card:metadata_missing"], 1.0)
        self.assertGreater(state["state:pool_metadata_missing_share"], -1.0)

    def test_action_invariant_base_controls_are_factorized_once(self):
        state, candidates = rich_feature_bundle(decision(), base_features(), metadata())
        self.assertEqual(state["base:pick_number"], 5.0)
        self.assertEqual(state["base:set=MSH"], 1.0)
        self.assertTrue(all("base:pick_number" not in row for row in candidates.values()))
        self.assertTrue(all("base:set=MSH" not in row for row in candidates.values()))

    def test_all_declared_pack_relative_signals_are_materialized(self):
        _state, candidates = rich_feature_bundle(decision(), base_features(), metadata())
        row = candidates["A"]
        for signal in PACK_RELATIVE_SIGNALS:
            self.assertIn(f"packrel:{signal}:present", row)
            self.assertIn(f"packrel:{signal}:minus_mean", row)
            self.assertIn(f"packrel:{signal}:percentile", row)


if __name__ == "__main__":
    unittest.main()
