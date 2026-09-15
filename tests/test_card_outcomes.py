import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from card_outcomes import column_index, count_of, shrink, summarise, tally


def archive(path: Path, cards, rows):
    """rows: (won, {card: (in_deck, in_hand)})"""
    header = ["draft_id", "won", "user_game_win_rate_bucket"]
    for group in ("deck_", "opening_hand_", "drawn_", "tutored_", "sideboard_"):
        header += [group + c for c in cards]
    with gzip.open(path, "wt", encoding="utf-8", newline="") as handle:
        handle.write(",".join(header) + "\n")
        for index, (won, state) in enumerate(rows):
            values = [f"d{index}", "True" if won else "False", "0.55"]
            for group in ("deck_", "opening_hand_", "drawn_", "tutored_", "sideboard_"):
                for card in cards:
                    deck, hand = state.get(card, (0, 0))
                    if group == "deck_":
                        values.append(str(deck))
                    elif group == "drawn_":
                        values.append(str(hand))
                    else:
                        values.append("0")
            handle.write(",".join(values) + "\n")


class ParsingTests(unittest.TestCase):
    def test_count_of(self):
        self.assertEqual(count_of(""), 0)
        self.assertEqual(count_of("0"), 0)
        self.assertEqual(count_of("1"), 1)
        self.assertEqual(count_of("2.0"), 2)
        self.assertEqual(count_of("junk"), 0)

    def test_column_index_groups_cards(self):
        header = ["won", "deck_Alpha", "drawn_Alpha", "opening_hand_Alpha", "sideboard_Alpha"]
        cards, plain = column_index(header)
        self.assertEqual(set(cards), {"Alpha"})
        self.assertEqual(set(cards["Alpha"]), {"deck_", "drawn_", "opening_hand_", "sideboard_"})
        self.assertEqual(plain["won"], 0)

    def test_missing_won_column_is_rejected(self):
        with self.assertRaises(ValueError):
            column_index(["deck_Alpha", "drawn_Alpha"])

    def test_archive_with_no_cards_is_rejected(self):
        with self.assertRaises(ValueError):
            column_index(["won", "draft_id"])


class TallyTests(unittest.TestCase):
    def test_splits_games_by_whether_the_card_was_drawn(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "g.csv.gz"
            # Alpha is in every deck. Drawn in 4 games (3 won), undrawn in 4 (1 won).
            rows = [(True, {"Alpha": (1, 1)}), (True, {"Alpha": (1, 1)}),
                    (True, {"Alpha": (1, 1)}), (False, {"Alpha": (1, 1)}),
                    (True, {"Alpha": (1, 0)}), (False, {"Alpha": (1, 0)}),
                    (False, {"Alpha": (1, 0)}), (False, {"Alpha": (1, 0)})]
            archive(path, ["Alpha"], rows)
            counts, seen = tally(path)
        self.assertEqual(seen, 8)
        alpha = counts["Alpha"]
        self.assertEqual(alpha["gih_games"], 4)
        self.assertEqual(alpha["gih_wins"], 3)
        self.assertEqual(alpha["gnd_games"], 4)
        self.assertEqual(alpha["gnd_wins"], 1)
        self.assertEqual(alpha["deck_games"], 8)

    def test_a_card_not_in_the_deck_is_not_counted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "g.csv.gz"
            archive(path, ["Alpha", "Beta"],
                    [(True, {"Alpha": (1, 1)}), (False, {"Alpha": (1, 0)})])
            counts, _ = tally(path)
        self.assertIn("Alpha", counts)
        self.assertNotIn("Beta", counts)


class SummaryTests(unittest.TestCase):
    def test_iwd_is_the_drawn_minus_undrawn_gap(self):
        counts = {"Alpha": {"gih_games": 1000, "gih_wins": 700,
                            "gnd_games": 1000, "gnd_wins": 500,
                            "deck_games": 2000, "deck_wins": 1200}}
        rows = summarise(counts)["cards"]["Alpha"]
        self.assertAlmostEqual(rows["gih_wr"], 0.7)
        self.assertAlmostEqual(rows["gnd_wr"], 0.5)
        self.assertAlmostEqual(rows["iwd"], 0.2)

    def test_a_thinly_supported_card_is_shrunk_toward_no_effect(self):
        thin = {"Alpha": {"gih_games": 6, "gih_wins": 6, "gnd_games": 6, "gnd_wins": 0,
                          "deck_games": 12, "deck_wins": 6}}
        rows = summarise(thin)["cards"]["Alpha"]
        # Raw IWD is a full 1.0; six games each way is not evidence of that.
        self.assertAlmostEqual(rows["iwd"], 1.0)
        self.assertLess(abs(rows["iwd_shrunk"]), 0.05)

    def test_a_well_supported_card_keeps_most_of_its_measured_effect(self):
        thick = {"Alpha": {"gih_games": 20000, "gih_wins": 13000,
                           "gnd_games": 20000, "gnd_wins": 9000,
                           "deck_games": 40000, "deck_wins": 22000}}
        rows = summarise(thick)["cards"]["Alpha"]
        self.assertAlmostEqual(rows["iwd"], 0.2, places=6)
        self.assertGreater(rows["iwd_shrunk"], 0.17)

    def test_shrink_moves_toward_the_mean(self):
        self.assertAlmostEqual(shrink(0, 0, 0.55, 400), 0.55)
        self.assertGreater(shrink(400, 400, 0.55, 400), 0.55)
        self.assertLess(shrink(0, 400, 0.55, 400), 0.55)


if __name__ == "__main__":
    unittest.main()
