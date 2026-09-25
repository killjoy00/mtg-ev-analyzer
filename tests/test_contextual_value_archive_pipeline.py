import csv
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from contextual_value.archive import ArchiveSignalProvider, GameDraftSummary, GameStore, load_decisions
from contextual_value.dataset import Decision, draft_split
from contextual_value.features import CardSignals
from contextual_value.pipeline import run_development


DRAFT_HEADER = [
    "expansion", "event_type", "draft_id", "draft_time", "rank",
    "event_match_wins", "event_match_losses", "pack_number", "pick_number",
    "pick", "user_n_games_bucket", "user_game_win_rate_bucket",
    "pack_card_A", "pack_card_B", "pool_A", "pool_B",
]
GAME_HEADER = [
    "draft_id", "won", "rank", "user_game_win_rate_bucket",
    "user_n_games_bucket", "main_colors",
    "deck_A", "deck_B", "opening_hand_A", "opening_hand_B",
    "drawn_A", "drawn_B", "tutored_A", "tutored_B",
]


def _draft_row(draft_id, pick, wins, pick_number=0):
    return {
        "expansion": "TST",
        "event_type": "PremierDraft",
        "draft_id": draft_id,
        "draft_time": "2026-01-01T00:00:00Z",
        "rank": "Gold",
        "event_match_wins": str(wins),
        "event_match_losses": str(max(0, 3 if wins < 7 else 0)),
        "pack_number": "0",
        "pick_number": str(pick_number),
        "pick": pick,
        "user_n_games_bucket": "100-199",
        "user_game_win_rate_bucket": "55%-57%",
        "pack_card_A": "1",
        "pack_card_B": "1",
        "pool_A": "1" if pick_number else "0",
        "pool_B": "0",
    }


def _game_rows(draft_id, flip=False):
    first_won = "0" if flip else "1"
    second_won = "1" if flip else "0"
    common = {
        "draft_id": draft_id,
        "rank": "Gold",
        "user_game_win_rate_bucket": "55%-57%",
        "user_n_games_bucket": "100-199",
        "main_colors": "W",
        "deck_A": "1",
        "deck_B": "1",
        "tutored_A": "0",
        "tutored_B": "0",
    }
    first = {
        **common,
        "won": first_won,
        "opening_hand_A": "1",
        "opening_hand_B": "0",
        "drawn_A": "0",
        "drawn_B": "0",
    }
    second = {
        **common,
        "won": second_won,
        "opening_hand_A": "0",
        "opening_hand_B": "1",
        "drawn_A": "0",
        "drawn_B": "0",
    }
    return [first, second]


class ArchiveSignalTests(unittest.TestCase):
    def _fixtures(self):
        temp = tempfile.TemporaryDirectory()
        root = Path(temp.name)
        draft_path = root / "draft.csv"
        game_path = root / "game.csv"
        draft_ids = [f"d{i}" for i in range(8)]
        with draft_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=DRAFT_HEADER)
            writer.writeheader()
            for index, draft_id in enumerate(draft_ids):
                selected = "A" if index % 2 == 0 else "B"
                writer.writerow(_draft_row(draft_id, selected, 6 if selected == "A" else 2, 0))
                writer.writerow(_draft_row(draft_id, "B" if selected == "A" else "A",
                                           6 if selected == "A" else 2, 1))
        with game_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=GAME_HEADER)
            writer.writeheader()
            for index, draft_id in enumerate(draft_ids):
                for row in _game_rows(draft_id, flip=(index == len(draft_ids) - 1)):
                    writer.writerow(row)
        return temp, draft_path, game_path, draft_ids

    def test_archive_provider_builds_complete_signals_from_complement(self):
        temp, draft_path, game_path, draft_ids = self._fixtures()
        self.addCleanup(temp.cleanup)
        decisions = load_decisions(draft_path)
        games = GameStore.from_archive(game_path, draft_ids)
        provider = ArchiveSignalProvider(
            decisions,
            games,
            strong_training_cap=None,
        )
        held = draft_ids[-1]
        scored = next(row for row in decisions if row.draft_id == held and row.pick_number == 0)
        training = frozenset(draft_ids[:-1])
        signals = provider(scored, training)

        self.assertEqual(set(signals), {"A", "B"})
        self.assertIsNotNone(signals["A"].strong_choice_probability)
        self.assertIsNotNone(signals["B"].strong_choice_probability)
        self.assertAlmostEqual(
            signals["A"].strong_choice_probability + signals["B"].strong_choice_probability,
            1.0,
            places=12,
        )
        # Seven training drafts, one GIH observation for A per draft. The held
        # draft's flipped outcome must not change this count.
        self.assertEqual(signals["A"].gih_games, 7)
        self.assertEqual(signals["B"].gih_games, 7)
        self.assertIsNotNone(signals["A"].deck_inclusion_probability)
        self.assertIsNotNone(signals["A"].ata)
        self.assertIsNotNone(signals["A"].alsa)

    def test_multiple_game_archives_merge_only_disjoint_drafts(self):
        temp, _, game_path, draft_ids = self._fixtures()
        self.addCleanup(temp.cleanup)
        roots = [Path(temp.name) / "game-a.csv", Path(temp.name) / "game-b.csv"]
        outputs = [path.open("w", newline="", encoding="utf-8") for path in roots]
        try:
            writers = [csv.DictWriter(handle, fieldnames=GAME_HEADER) for handle in outputs]
            for writer in writers:
                writer.writeheader()
            with game_path.open("r", newline="", encoding="utf-8") as source:
                for row in csv.DictReader(source):
                    target = 0 if row["draft_id"] in set(draft_ids[:4]) else 1
                    writers[target].writerow(row)
        finally:
            for handle in outputs:
                handle.close()

        games = GameStore.from_archives(roots, draft_ids)
        self.assertEqual(set(games.drafts), set(draft_ids))

    def test_card_outcome_signals_are_scoped_by_expansion(self):
        def row(draft_id, expansion, selected):
            return Decision(
                draft_id=draft_id,
                expansion=expansion,
                event_type="PremierDraft",
                draft_time="2026-01-01T00:00:00Z",
                rank="Gold",
                pack_number=0,
                pick_number=0,
                selected_card=selected,
                candidates=("A", "B"),
                pool=(),
                user_game_win_rate=0.55,
                user_games_lower_bound=100,
                event_match_wins=4,
                event_match_losses=3,
            )

        decisions = []
        summaries = {}
        training_ids = set()
        for expansion, a_wins, b_wins in (("TST", 1, 0), ("ALT", 0, 1)):
            for index in range(4):
                draft_id = f"{expansion.lower()}-{index}"
                training_ids.add(draft_id)
                decisions.append(row(draft_id, expansion, "A" if index % 2 == 0 else "B"))
                summaries[draft_id] = GameDraftSummary(
                    rows=2,
                    wins=1,
                    cards={
                        "A": {
                            "gih_games": 1, "gih_wins": a_wins,
                            "gnd_games": 1, "gnd_wins": 1 - a_wins,
                            "deck_games": 2, "deck_wins": 1,
                        },
                        "B": {
                            "gih_games": 1, "gih_wins": b_wins,
                            "gnd_games": 1, "gnd_wins": 1 - b_wins,
                            "deck_games": 2, "deck_wins": 1,
                        },
                    },
                    played={"A", "B"},
                    main_colours=Counter({"W": 2}),
                )
        tst_held = row("tst-held", "TST", "A")
        alt_held = row("alt-held", "ALT", "A")
        decisions.extend([tst_held, alt_held])
        provider = ArchiveSignalProvider(
            decisions,
            GameStore(summaries),
            strong_training_cap=None,
        )
        training = frozenset(training_ids)
        tst = provider(tst_held, training)
        alt = provider(alt_held, training)
        self.assertGreater(tst["A"].gih_wr, alt["A"].gih_wr)
        self.assertLess(tst["B"].gih_wr, alt["B"].gih_wr)
        self.assertEqual(
            provider.artifacts(training, "TST").training_ids,
            frozenset(d for d in training if d.startswith("tst-")),
        )

    def test_game_archive_without_main_colors_fails_closed(self):
        temp, _, game_path, draft_ids = self._fixtures()
        self.addCleanup(temp.cleanup)
        stripped = Path(temp.name) / "game-no-colours.csv"
        header = [name for name in GAME_HEADER if name != "main_colors"]
        with game_path.open("r", newline="", encoding="utf-8") as source, stripped.open(
            "w", newline="", encoding="utf-8"
        ) as destination:
            reader = csv.DictReader(source)
            writer = csv.DictWriter(destination, fieldnames=header)
            writer.writeheader()
            for row in reader:
                writer.writerow({name: row[name] for name in header})
        with self.assertRaisesRegex(ValueError, "main_colors"):
            GameStore.from_archive(stripped, draft_ids)

    def test_provider_rejects_same_draft_in_training_complement(self):
        temp, draft_path, game_path, draft_ids = self._fixtures()
        self.addCleanup(temp.cleanup)
        decisions = load_decisions(draft_path)
        games = GameStore.from_archive(game_path, draft_ids)
        provider = ArchiveSignalProvider(decisions, games, strong_training_cap=None)
        scored = decisions[0]
        with self.assertRaises(AssertionError):
            provider(scored, frozenset(draft_ids))

    def test_deterministic_draft_cap(self):
        temp, draft_path, _, _ = self._fixtures()
        self.addCleanup(temp.cleanup)
        first = load_decisions(draft_path, max_drafts=3)
        second = load_decisions(draft_path, max_drafts=3)
        self.assertEqual(
            {row.draft_id for row in first},
            {row.draft_id for row in second},
        )
        self.assertEqual(len({row.draft_id for row in first}), 3)


def _decision(draft_id, selected, wins):
    return Decision(
        draft_id=draft_id,
        expansion="TST",
        event_type="PremierDraft",
        draft_time="2026-01-01T00:00:00Z",
        rank="Gold",
        pack_number=0,
        pick_number=0,
        selected_card=selected,
        candidates=("A", "B"),
        pool=(),
        user_game_win_rate=0.55,
        user_games_lower_bound=100,
        event_match_wins=wins,
        event_match_losses=3 if wins < 7 else 0,
    )


class DevelopmentPipelineTests(unittest.TestCase):
    def test_development_run_never_queries_assessment_signals(self):
        rows = [
            _decision(
                f"p{index}",
                "A" if index % 2 == 0 else "B",
                7 if index % 2 == 0 else 1,
            )
            for index in range(80)
        ]
        self.assertTrue(any(draft_split(row.draft_id) == "assessment" for row in rows))
        calls = []

        def provider(row, training_ids):
            calls.append((row.draft_id, frozenset(training_ids)))
            self.assertNotIn(row.draft_id, training_ids)
            return {
                "A": CardSignals(
                    strong_choice_probability=0.7,
                    gih_wr=0.60,
                    gnd_wr=0.50,
                    iwd=0.10,
                    gih_games=1000,
                    gnd_games=900,
                    deck_inclusion_probability=0.8,
                    ata=2.0,
                    alsa=3.0,
                ),
                "B": CardSignals(
                    strong_choice_probability=0.3,
                    gih_wr=0.50,
                    gnd_wr=0.52,
                    iwd=-0.02,
                    gih_games=900,
                    gnd_games=1000,
                    deck_inclusion_probability=0.7,
                    ata=4.0,
                    alsa=5.0,
                ),
            }

        report, train_predictions, validation_predictions, value_model = run_development(
            rows,
            signal_provider=provider,
            nuisance_folds=3,
            inner_feature_folds=3,
            propensity_l2=0.5,
            outcome_l2=1.0,
            value_l2=1.0,
            temperature_grid=(0.5, 1.0),
            blend_lambdas=(0.0, 0.5, 1.0),
            blend_weights=(0.0, 0.5, 1.0),
        )

        assessment_ids = {
            row.draft_id for row in rows
            if draft_split(row.draft_id) == "assessment"
        }
        self.assertTrue(calls)
        self.assertFalse(any(draft_id in assessment_ids for draft_id, _ in calls))
        self.assertFalse(report["assessment_opened"])
        self.assertEqual(
            set(report["models"]),
            {
                "A_current_v4_strong_player",
                "B_historical_trophy_choice",
                "C_gih_only",
                "D_iwd_only",
                "E_simple_behavior_outcome_blend",
                "F_direct_q",
                "G_contextual_value",
            },
        )
        self.assertGreater(len(train_predictions), 0)
        self.assertGreater(len(validation_predictions), 0)
        self.assertEqual(
            value_model.training_draft_count,
            report["drafts"]["train"],
        )


if __name__ == "__main__":
    unittest.main()
