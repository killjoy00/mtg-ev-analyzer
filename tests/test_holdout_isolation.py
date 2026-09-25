import csv
import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_replays import (
    CONTEXT_STRENGTH,
    FIT_STRENGTH,
    PAIR_MIN_SEEN,
    PAIR_PRIOR_STRENGTH,
    CountStore,
    OutOfFoldModel,
    build_colour_tables_by_fold,
    normalize_probabilities,
    render_replay,
    stable_fold,
    train_and_collect,
)


class HoldoutIsolationTests(unittest.TestCase):
    FOLDS = 5
    TARGET_FOLD = 0

    @classmethod
    def ids_in_fold(cls, prefix, fold, count):
        result = []
        index = 0
        while len(result) < count:
            draft_id = f"{prefix}-{index}"
            if stable_fold(draft_id, cls.FOLDS) == fold:
                result.append(draft_id)
            index += 1
        return result

    @classmethod
    def ids_outside_fold(cls, prefix, fold, count):
        result = []
        index = 0
        while len(result) < count:
            draft_id = f"{prefix}-{index}"
            if stable_fold(draft_id, cls.FOLDS) != fold:
                result.append(draft_id)
            index += 1
        return result

    @staticmethod
    def write_draft_csv(path, fixed_ids, held_ids, held_pick):
        fields = [
            "draft_id", "pack_number", "pick_number", "pick",
            "user_game_win_rate_bucket", "user_n_games_bucket",
            "pack_card_A", "pack_card_B", "pool_P",
        ]
        rows = []
        for index, draft_id in enumerate(fixed_ids):
            rows.append({
                "draft_id": draft_id,
                "pack_number": "0",
                "pick_number": "5",
                "pick": "A" if index % 2 == 0 else "B",
                "user_game_win_rate_bucket": "0.70 - 0.72",
                "user_n_games_bucket": "100 - 499",
                "pack_card_A": "1",
                "pack_card_B": "1",
                "pool_P": "1",
            })
        for draft_id in held_ids:
            rows.append({
                "draft_id": draft_id,
                "pack_number": "0",
                "pick_number": "5",
                "pick": held_pick,
                "user_game_win_rate_bucket": "0.70 - 0.72",
                "user_n_games_bucket": "100 - 499",
                "pack_card_A": "1",
                "pack_card_B": "1",
                "pool_P": "1",
            })
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
        return fields

    @staticmethod
    def write_game_csv(path, draft_ids):
        fields = ["draft_id", "main_colors", "deck_A", "deck_B", "deck_P"]
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            for draft_id in draft_ids:
                # Game/deck inputs are identical between the two builds. Only
                # the held draft pick labels in draft_data change.
                writer.writerow({
                    "draft_id": draft_id,
                    "main_colors": "U",
                    "deck_A": "1",
                    "deck_B": "0",
                    "deck_P": "1",
                })

    def snapshot(self, directory, held_pick):
        fixed_ids = self.ids_outside_fold("fixed", self.TARGET_FOLD, 40)
        held_ids = self.ids_in_fold("held", self.TARGET_FOLD, 20)
        all_ids = fixed_ids + held_ids
        draft_path = directory / f"draft-{held_pick}.csv"
        game_path = directory / "games.csv"
        header = self.write_draft_csv(draft_path, fixed_ids, held_ids, held_pick)
        self.write_game_csv(game_path, all_ids)

        # Keep one held draft as the scored output. Other drafts in the same
        # fold remain ordinary training rows, which is exactly where a shared
        # global reference/colour fit can leak into this fold's grader.
        output_ids = {held_ids[0]}
        colour_examples = []
        fold_training, outputs, _, _, parsed = train_and_collect(
            draft_path, set(all_ids), output_ids, header, self.FOLDS, colour_examples)
        self.assertEqual(parsed, len(all_ids))

        fits = build_colour_tables_by_fold(
            game_path, colour_examples, fold_training, "fixture")
        fold_data = fold_training[self.TARGET_FOLD]
        self.assertFalse(set(fold_data.training_ids) & set(fold_data.held_out_ids))
        self.assertTrue(set(held_ids).issubset(fold_data.held_out_ids))
        self.assertFalse(set(held_ids) & set(fold_data.observed_ids))
        fit = fits[self.TARGET_FOLD]
        model = OutOfFoldModel(fold_data.counts, CountStore.empty(), fit)
        held_example = outputs[held_ids[0]][0]

        raw = {
            card: model.card_tendency(
                card,
                held_example.raw_pack_number,
                held_example.raw_pick_number,
                held_example.pool,
            )
            for card in held_example.candidates
        }
        probabilities = normalize_probabilities(raw)
        ranking = sorted(probabilities, key=lambda card: (-probabilities[card], card))
        rendered = render_replay(
            held_ids[0], [held_example], model, 1, 1, {})["picks"][0]

        def reference(card):
            key = (card, "P")
            seen = model._count("pair_seen", key)
            return model._expected(key) / seen if seen else None

        numeric_fit = {
            "play_rate": fit.get("play_rate"),
            "by_commitment": fit.get("by_commitment"),
            "by_stage": fit.get("by_stage"),
            "cards": {
                card: {
                    "play_rate": row.get("play_rate"),
                    "by_commitment": row.get("by_commitment"),
                    "colours": row.get("colours"),
                }
                for card, row in sorted(fit.get("cards", {}).items())
            },
        }
        numeric_serialized = {
            "consensus_pick_id": rendered["consensus_pick_id"],
            "probabilities": {
                candidate["name"]: candidate["model_probability"]
                for candidate in rendered["candidates"]
            },
        }
        return {
            "base_tendencies": {
                card: model.base_tendency(card, 0, 5)
                for card in ("A", "B")
            },
            "stage_references": {
                card: reference(card)
                for card in ("A", "B")
            },
            "pair_expected": {
                card: model._expected((card, "P"))
                for card in ("A", "B")
            },
            "priors_and_fallbacks": {
                "pair_min_seen": PAIR_MIN_SEEN,
                "pair_prior_strength": PAIR_PRIOR_STRENGTH,
                "context_strength": CONTEXT_STRENGTH,
                "fit_strength": FIT_STRENGTH,
                "unseen_card_base": model.base_tendency("never-seen", 0, 5),
            },
            "colour_fit": numeric_fit,
            "predictions": {
                "raw": raw,
                "probabilities": probabilities,
                "ranking": ranking,
            },
            "serialized_numeric_artifact": numeric_serialized,
        }

    def test_changing_only_held_answers_cannot_change_the_held_fold_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            picked_a = self.snapshot(directory, "A")
            picked_b = self.snapshot(directory, "B")

        # Direct counts are correctly subtracted today, so this part is already
        # invariant. The test intentionally compares every downstream artifact
        # too: a held label must leave no indirect statistical trace.
        self.assertEqual(
            picked_a["base_tendencies"],
            picked_b["base_tendencies"],
        )
        self.assertEqual(picked_a, picked_b)

    def test_rebuilding_identical_inputs_is_exactly_deterministic(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            first = self.snapshot(directory, "A")
            second = self.snapshot(directory, "A")
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
