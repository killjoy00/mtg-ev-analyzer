import csv
import gzip
import json
import sys
import tempfile
import unittest
from collections import Counter
from dataclasses import asdict, replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from contextual_value.archive import (
    ArchiveSignalProvider,
    GameDraftSummary,
    GameStore,
    limit_decisions,
    load_decisions,
    select_global_draft_ids,
)
from contextual_value.checkpoint import (
    build_cohort_manifest,
    load_preprocessed_cohort,
    verify_checkpoint_metadata,
    write_checkpoint_metadata,
    write_preprocessed_cohort,
)
from contextual_value.dataset import Decision, draft_split
from contextual_value.dr import PolicyObservation, evaluate_policy
from contextual_value.features import CardSignals
from contextual_value.nuisance import (
    NuisanceTrainingRow,
    build_fold_training_rows,
    fit_fold_from_training_rows,
    nuisance_fold,
    predict_fold,
)
from contextual_value.pipeline import run_development
from contextual_value.schema import ArchiveManifest
from contextual_value.value import argmax_policy


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


    def test_streaming_global_cap_matches_full_materialization(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        paths = []
        for expansion in ("AAA", "BBB"):
            path = root / f"draft-{expansion}.csv.gz"
            paths.append(path)
            with gzip.open(path, "wt", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=DRAFT_HEADER)
                writer.writeheader()
                for index in range(8):
                    draft_id = f"{expansion.lower()}-{index}"
                    for pick_number in range(1 + index % 3):
                        row = _draft_row(
                            draft_id,
                            "A" if (index + pick_number) % 2 == 0 else "B",
                            (index + 1) % 8,
                            pick_number,
                        )
                        row["expansion"] = expansion
                        writer.writerow(row)

                # Validly parseable but outside the Premier population.
                quick = _draft_row(f"{expansion.lower()}-quick", "A", 3, 0)
                quick["expansion"] = expansion
                quick["event_type"] = "QuickDraft"
                writer.writerow(quick)

                # Invalid because the selected card is not in the offered pack.
                invalid = _draft_row(f"{expansion.lower()}-invalid", "A", 3, 0)
                invalid["expansion"] = expansion
                invalid["pack_card_A"] = "0"
                writer.writerow(invalid)

        full = []
        for path in paths:
            full.extend(load_decisions(path))
        expected = limit_decisions(full, 7)
        selected_ids = select_global_draft_ids(paths, 7)
        actual = []
        progress = []
        for path in paths:
            actual.extend(load_decisions(
                path,
                keep_ids=selected_ids,
                progress_callback=lambda scanned, retained: progress.append(
                    (scanned, retained)
                ),
            ))
        actual = sorted(
            actual,
            key=lambda row: (row.draft_id, row.pack_number, row.pick_number),
        )

        self.assertEqual(
            [asdict(row) for row in actual],
            [asdict(row) for row in expected],
        )
        self.assertEqual(
            selected_ids,
            frozenset(row.draft_id for row in expected),
        )
        self.assertEqual(
            {draft_id: draft_split(draft_id) for draft_id in selected_ids},
            {
                row.draft_id: draft_split(row.draft_id)
                for row in expected
            },
        )
        self.assertTrue(progress)


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
        self.assertTrue(report["assessment_boundary"]["outcomes_loaded_into_pipeline"])
        self.assertFalse(report["assessment_boundary"]["outcomes_used_for_fit"])
        self.assertFalse(report["assessment_boundary"]["outcomes_scored"])
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

class CheckpointIntegrityTests(unittest.TestCase):
    @staticmethod
    def _fixed_provider(row, training_ids):
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

    def _cohort_fixture(self):
        rows = [
            _decision(
                f"cohort-{index}",
                "A" if index % 2 == 0 else "B",
                7 if index % 2 == 0 else 1,
            )
            for index in range(100)
        ]
        manifests = [
            ArchiveManifest("draft.csv.gz", "a" * 64, 100, tuple(DRAFT_HEADER), "draft"),
            ArchiveManifest("game.csv.gz", "b" * 64, 100, tuple(GAME_HEADER), "game"),
        ]
        manifest = build_cohort_manifest(
            manifests,
            rows,
            max_drafts=100,
            nuisance_folds=3,
            inner_feature_folds=3,
        )
        return rows, manifest

    def test_assessment_outcome_changes_cannot_change_preprocessed_development_fit(self):
        rows, manifest = self._cohort_fixture()
        assessment_ids = {
            row["draft_id"] for row in manifest["selected_drafts"]
            if row["split"] == "assessment"
        }
        self.assertTrue(assessment_ids)
        mutated = [
            replace(
                row,
                event_match_wins=(0 if row.event_match_wins else 7),
                event_match_losses=3,
            )
            if row.draft_id in assessment_ids else row
            for row in rows
        ]

        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        left = Path(temp.name) / "left"
        right = Path(temp.name) / "right"
        write_preprocessed_cohort(left, rows, GameStore({}), manifest)
        write_preprocessed_cohort(right, mutated, GameStore({}), manifest)

        self.assertEqual(
            (left / "development-decisions.jsonl.gz").read_bytes(),
            (right / "development-decisions.jsonl.gz").read_bytes(),
        )
        left_rows, _, left_manifest = load_preprocessed_cohort(left)
        right_rows, _, right_manifest = load_preprocessed_cohort(right)
        self.assertEqual(left_manifest["cohort_id"], right_manifest["cohort_id"])
        self.assertFalse(any(draft_split(row.draft_id) == "assessment" for row in left_rows))
        self.assertEqual(
            [asdict(row) for row in left_rows],
            [asdict(row) for row in right_rows],
        )

        kwargs = dict(
            signal_provider=self._fixed_provider,
            nuisance_folds=3,
            inner_feature_folds=3,
            propensity_l2=0.5,
            outcome_l2=1.0,
            value_l2=1.0,
            temperature_grid=(0.5, 1.0),
            blend_lambdas=(0.0, 0.5, 1.0),
            blend_weights=(0.0, 0.5, 1.0),
            assessment_draft_count=manifest["split_counts"]["assessment"],
        )
        left_report, _, _, left_model = run_development(left_rows, **kwargs)
        right_report, _, _, right_model = run_development(right_rows, **kwargs)
        self.assertEqual(left_report, right_report)
        self.assertEqual(left_model, right_model)
        self.assertFalse(left_report["assessment_boundary"]["outcomes_loaded_into_pipeline"])
        self.assertEqual(
            left_report["drafts"]["assessment_withheld"],
            manifest["split_counts"]["assessment"],
        )

    def test_corrupt_or_incompatible_checkpoint_is_rejected(self):
        rows, manifest = self._cohort_fixture()
        train_ids = frozenset(
            row.draft_id for row in rows if draft_split(row.draft_id) == "train"
        )
        held_ids = frozenset(
            row.draft_id for row in rows if draft_split(row.draft_id) == "validation"
        )
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        payload = Path(temp.name) / "payload.jsonl.gz"
        with gzip.open(payload, "wt", encoding="utf-8") as handle:
            handle.write('{"ok":true}\n')
        config = {
            "max_drafts": 100,
            "nuisance_folds": 3,
            "inner_feature_folds": 3,
            "propensity_l2": 1.0,
            "outcome_l2": 10.0,
            "value_l2": 10.0,
        }
        write_checkpoint_metadata(
            payload,
            kind="nuisance_predictions",
            cohort_manifest=manifest,
            fold=-1,
            expansion=None,
            training_ids=train_ids,
            held_ids=held_ids,
            configuration=config,
            row_count=1,
        )
        verify_checkpoint_metadata(
            payload,
            cohort_manifest=manifest,
            kind="nuisance_predictions",
            fold=-1,
            expansion=None,
            training_ids=train_ids,
            held_ids=held_ids,
            configuration=config,
        )
        with self.assertRaisesRegex(ValueError, "incompatible checkpoint fold"):
            verify_checkpoint_metadata(
                payload,
                cohort_manifest=manifest,
                kind="nuisance_predictions",
                fold=0,
                expansion=None,
                training_ids=train_ids,
                held_ids=held_ids,
                configuration=config,
            )
        with payload.open("ab") as handle:
            handle.write(b"corruption")
        with self.assertRaisesRegex(ValueError, "payload hash mismatch"):
            verify_checkpoint_metadata(
                payload,
                cohort_manifest=manifest,
                kind="nuisance_predictions",
                fold=-1,
                expansion=None,
                training_ids=train_ids,
                held_ids=held_ids,
                configuration=config,
            )


class ArchiveSignalShardEquivalenceTests(unittest.TestCase):
    def test_multi_environment_gzip_signal_shards_match_monolithic_path(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        draft_header = DRAFT_HEADER + ["pack_card_C", "pool_C"]
        game_header = GAME_HEADER + [
            "deck_C", "opening_hand_C", "drawn_C", "tutored_C",
        ]
        draft_paths = []
        game_paths = []

        for expansion in ("AAA", "BBB"):
            draft_path = root / f"draft-{expansion}.csv.gz"
            game_path = root / f"game-{expansion}.csv.gz"
            draft_paths.append(draft_path)
            game_paths.append(game_path)
            with gzip.open(draft_path, "wt", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=draft_header)
                writer.writeheader()
                for index in range(12):
                    draft_id = f"{expansion.lower()}-{index}"
                    pick_count = 1 + (index % 3)
                    for pick_number in range(pick_count):
                        selected = "A" if (index + pick_number) % 2 == 0 else "B"
                        row = _draft_row(draft_id, selected, (index + 2) % 8, pick_number)
                        row["expansion"] = expansion
                        row["pack_card_C"] = "1" if pick_number == 0 else "0"
                        row["pool_C"] = "0"
                        writer.writerow(row)
            with gzip.open(game_path, "wt", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=game_header)
                writer.writeheader()
                for index in range(12):
                    draft_id = f"{expansion.lower()}-{index}"
                    for game in _game_rows(draft_id, flip=(index % 4 == 0)):
                        game["deck_C"] = "0"
                        game["opening_hand_C"] = "0"
                        game["drawn_C"] = "0"
                        game["tutored_C"] = "0"
                        writer.writerow(game)

        decisions = []
        for path in draft_paths:
            decisions.extend(load_decisions(path))
        games = GameStore.from_archives(game_paths, {row.draft_id for row in decisions})
        provider = ArchiveSignalProvider(decisions, games, strong_training_cap=None)

        folds = 3
        fold = 1
        all_ids = frozenset(row.draft_id for row in decisions)
        held_ids = frozenset(
            draft_id for draft_id in all_ids
            if nuisance_fold(draft_id, folds) == fold
        )
        training_ids = frozenset(all_ids - held_ids)
        monolithic_rows = build_fold_training_rows(
            decisions,
            training_ids,
            signal_provider=provider,
            inner_feature_folds=3,
        )

        sharded_rows = []
        for expansion in ("AAA", "BBB"):
            rows = build_fold_training_rows(
                decisions,
                training_ids,
                signal_provider=provider,
                inner_feature_folds=3,
                expansion=expansion,
            )
            path = root / f"feature-{expansion}.jsonl.gz"
            with gzip.open(path, "wt", encoding="utf-8") as handle:
                for row in rows:
                    handle.write(json.dumps(asdict(row), sort_keys=True) + "\n")
            with gzip.open(path, "rt", encoding="utf-8") as handle:
                for line in handle:
                    payload = json.loads(line)
                    sharded_rows.append(NuisanceTrainingRow(**payload))

        mono = sorted(monolithic_rows, key=lambda row: row.decision_id)
        shard = sorted(sharded_rows, key=lambda row: row.decision_id)
        self.assertEqual(len(mono), len(shard))
        for left, right in zip(mono, shard):
            self.assertEqual(left.decision_id, right.decision_id)
            self.assertEqual(left.features, right.features)
            self.assertEqual(left.offsets, right.offsets)
            self.assertAlmostEqual(left.sample_weight, right.sample_weight, places=15)
            self.assertEqual(left.outcome, right.outcome)

        rare = next(row for row in mono if "C" in row.features)
        self.assertIn("C", rare.features)
        self.assertNotIn("gih_wr", rare.features["C"])

        monolithic_fit = fit_fold_from_training_rows(
            monolithic_rows, training_ids, propensity_l2=0.5, outcome_l2=1.0, fold=fold
        )
        sharded_fit = fit_fold_from_training_rows(
            sharded_rows, training_ids, propensity_l2=0.5, outcome_l2=1.0, fold=fold
        )
        self.assertEqual(monolithic_fit.propensity.feature_names, sharded_fit.propensity.feature_names)
        self.assertEqual(monolithic_fit.outcome.feature_names, sharded_fit.outcome.feature_names)
        for left, right in zip(
            monolithic_fit.propensity.coefficients,
            sharded_fit.propensity.coefficients,
        ):
            self.assertAlmostEqual(left, right, places=12)
        for left, right in zip(
            monolithic_fit.outcome.coefficients,
            sharded_fit.outcome.coefficients,
        ):
            self.assertAlmostEqual(left, right, places=12)

        held = [row for row in decisions if row.draft_id in held_ids]
        mono_predictions = sorted(
            predict_fold(monolithic_fit, held, signal_provider=provider),
            key=lambda row: row.decision_id,
        )
        shard_predictions = sorted(
            predict_fold(sharded_fit, held, signal_provider=provider),
            key=lambda row: row.decision_id,
        )
        self.assertEqual(
            [row.decision_id for row in mono_predictions],
            [row.decision_id for row in shard_predictions],
        )
        by_decision = {row.decision_id: row for row in held}
        mono_observations = []
        shard_observations = []
        for left, right in zip(mono_predictions, shard_predictions):
            decision = by_decision[left.decision_id]
            for action in decision.candidates:
                self.assertAlmostEqual(left.behavior[action], right.behavior[action], places=12)
                self.assertAlmostEqual(left.q_values[action], right.q_values[action], places=12)
            target = argmax_policy({action: -index for index, action in enumerate(decision.candidates)})
            mono_observations.append(PolicyObservation(
                action=decision.selected_card,
                outcome=float(decision.event_match_wins),
                behavior=left.behavior,
                target=target,
                q_values=left.q_values,
                cluster=decision.draft_id,
            ))
            shard_observations.append(PolicyObservation(
                action=decision.selected_card,
                outcome=float(decision.event_match_wins),
                behavior=right.behavior,
                target=target,
                q_values=right.q_values,
                cluster=decision.draft_id,
            ))
        mono_estimate = evaluate_policy(mono_observations, weight_cap=20)
        shard_estimate = evaluate_policy(shard_observations, weight_cap=20)
        self.assertAlmostEqual(mono_estimate.dr, shard_estimate.dr, places=12)
        self.assertAlmostEqual(mono_estimate.direct, shard_estimate.direct, places=12)
        self.assertAlmostEqual(mono_estimate.snips, shard_estimate.snips, places=12)



if __name__ == "__main__":
    unittest.main()
