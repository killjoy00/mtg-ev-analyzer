import argparse
import csv
import json
import tempfile
import unittest
from pathlib import Path

from scripts.build_replays import (
    CountStore,
    OutOfFoldModel,
    PickExample,
    build,
    load_deck_fit,
    parse_games_lower_bound,
    parse_rate_bucket,
    quantile_cutoff,
    stable_fold,
    update_catalog,
    write_sharded_dataset,
)


class ParsingTests(unittest.TestCase):
    def test_rate_bucket_parsing(self):
        self.assertAlmostEqual(parse_rate_bucket("0.60 - 0.64"), 0.62)
        self.assertAlmostEqual(parse_rate_bucket("60% - 64%"), 0.62)
        self.assertAlmostEqual(parse_rate_bucket("0.63"), 0.63)

    def test_game_bucket_uses_lower_bound(self):
        self.assertEqual(parse_games_lower_bound("100 - 499"), 100)
        self.assertEqual(parse_games_lower_bound("500+"), 500)

    def test_top_fraction_cutoff(self):
        self.assertEqual(quantile_cutoff([0.5, 0.6, 0.7, 0.8], 0.5), 0.7)


class ModelTests(unittest.TestCase):
    def test_production_reproduces_the_validated_harness_model(self):
        """The port's whole correctness guarantee.

        `v3-colour-and-pair` is the configuration measured on six held-out
        sets. If production and the harness ever disagree, what ships is not
        what was validated - and nothing else in this suite would notice.
        """
        import sys
        from pathlib import Path as _P
        sys.path.insert(0, str(_P(__file__).resolve().parents[1] / "scripts"))
        from eval_model import VARIANTS, VariantModel

        fit = {"set_id": "tst", "split": "train", "play_rate": 0.60,
               "by_commitment": {"0": 0.42, "1-2": 0.50, "3-5": 0.61,
                                 "6-9": 0.70, "10+": 0.64},
               "by_stage": {"s3-5": {"*": 0.58, "0": 0.33, "1-2": 0.47,
                                     "3-5": 0.71, "6-9": 0.80},
                            "s6-9": {"*": 0.66, "3-5": 0.55, "6-9": 0.83}},
               "cards": {"A": {"colours": "U", "play_rate": 0.7,
                               "by_commitment": {"0": 0.4, "3-5": 0.8}},
                         "B": {"colours": "R", "play_rate": 0.5,
                               "by_commitment": {"0": 0.3, "3-5": 0.6}},
                         "Signal X": {"colours": "U", "play_rate": 0.6,
                                      "by_commitment": {}},
                         "Signal Y": {"colours": "R", "play_rate": 0.6,
                                      "by_commitment": {}},
                         "Mystery": {"colours": "?", "play_rate": 0.6,
                                     "by_commitment": {}}}}

        counts = CountStore.empty()
        for i in range(60):
            pool = {"Signal X": 1 + i % 2} if i % 3 else {"Signal Y": 1}
            picked = "A" if i % 4 else "B"
            counts.observe(PickExample(f"d{i}", 0, 2 + i % 6, picked, ["A", "B"], pool))
        base = OutOfFoldModel(counts, CountStore.empty())
        for i in range(60):
            pool = {"Signal X": 1 + i % 2} if i % 3 else {"Signal Y": 1}
            picked = "A" if i % 4 else "B"
            counts.observe_expected(
                PickExample(f"d{i}", 0, 2 + i % 6, picked, ["A", "B"], pool),
                base.base_tendency)

        production = OutOfFoldModel(counts, CountStore.empty(), fit)
        harness = VariantModel(counts, VARIANTS["v3-colour-and-pair"],
                               dict(counts.pair_expected), fit)

        pools = [{}, {"Signal X": 1}, {"Signal Y": 2},
                 {"Signal X": 3, "Signal Y": 1}, {"Mystery": 4},
                 {"Signal X": 5, "Mystery": 2}]
        checked = 0
        for card in ("A", "B", "Mystery"):
            for pick in (0, 3, 7):
                for pool in pools:
                    with self.subTest(card=card, pick=pick, pool=tuple(sorted(pool))):
                        self.assertAlmostEqual(
                            production.card_tendency(card, 0, pick, pool),
                            harness.card_tendency(card, 0, pick, pool), places=12)
                    checked += 1
        self.assertEqual(checked, 54)

    def test_an_unknown_colour_gets_no_shift_in_production_either(self):
        fit = {"set_id": "tst", "split": "train", "play_rate": 0.6,
               "by_commitment": {"0": 0.4, "3-5": 0.8}, "by_stage": {},
               "cards": {"Mystery": {"colours": "?", "play_rate": 0.6,
                                     "by_commitment": {}},
                         "Blue": {"colours": "U", "play_rate": 0.6,
                                  "by_commitment": {}}}}
        counts = CountStore.empty()
        for i in range(30):
            counts.observe(PickExample(f"d{i}", 0, 3, "Mystery", ["Mystery", "Blue"],
                                       {"Blue": 4}))
        model = OutOfFoldModel(counts, CountStore.empty(), fit)
        self.assertEqual(model.fit_shift("Mystery", {"Blue": 4}), 0.0)

    def test_a_fit_table_from_the_wrong_split_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "fit.json"
            path.write_text(json.dumps({"split": "test", "cards": {},
                                        "by_commitment": {}, "by_stage": {},
                                        "play_rate": 0.6}))
            with self.assertRaises(ValueError) as caught:
                load_deck_fit(path)
            self.assertIn("train split", str(caught.exception))

    def test_a_fit_table_without_a_stage_curve_is_refused(self):
        """Silently falling back to the marginal curve everywhere would ship a
        model with the stage confound the whole change exists to remove."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "fit.json"
            path.write_text(json.dumps({"split": "train", "cards": {},
                                        "by_commitment": {}, "play_rate": 0.6}))
            with self.assertRaises(ValueError):
                load_deck_fit(path)

    def test_pool_context_changes_card_preference(self):
        counts = CountStore.empty()
        held = CountStore.empty()
        for i in range(20):
            pool = {"Signal X": 1} if i < 10 else {"Signal Y": 1}
            picked = "A" if i < 10 else "B"
            counts.observe(PickExample(f"d{i}", 0, 5, picked, ["A", "B"], pool))
        # The stage-matched lift anchors on the base rate expected over the
        # pair's own observations, so the second pass has to run here too -
        # without it every pair abstains and the pool changes nothing.
        base = OutOfFoldModel(counts, CountStore.empty())
        for i in range(20):
            pool = {"Signal X": 1} if i < 10 else {"Signal Y": 1}
            picked = "A" if i < 10 else "B"
            counts.observe_expected(PickExample(f"d{i}", 0, 5, picked, ["A", "B"], pool),
                                    base.base_tendency)
        model = OutOfFoldModel(counts, held)
        a_x = model.card_tendency("A", 0, 5, {"Signal X": 1})
        b_x = model.card_tendency("B", 0, 5, {"Signal X": 1})
        a_y = model.card_tendency("A", 0, 5, {"Signal Y": 1})
        b_y = model.card_tendency("B", 0, 5, {"Signal Y": 1})
        self.assertGreater(a_x, b_x)
        self.assertGreater(b_y, a_y)

    def test_held_out_counts_are_subtracted(self):
        all_counts = CountStore.empty()
        held = CountStore.empty()
        example = PickExample("held", 0, 0, "A", ["A", "B"], {})
        all_counts.observe(example)
        held.observe(example)
        model = OutOfFoldModel(all_counts, held)
        self.assertAlmostEqual(model.base_tendency("A", 0, 0), 0.01)


class PipelineTests(unittest.TestCase):
    def make_fixture(self, path: Path):
        fields = [
            "draft_id","pack_number","pick_number","pick",
            "user_game_win_rate_bucket","user_n_games_bucket",
            "pack_card_A","pack_card_B","pack_card_C",
            "pool_A","pool_B","pool_C"
        ]
        rows = []
        skill = {
            "d1":"0.72 - 0.74","d2":"0.70 - 0.72","d3":"0.68 - 0.70",
            "d4":"0.66 - 0.68","d5":"0.55 - 0.57","d6":"0.52 - 0.54"
        }
        picks = {"d1":"A","d2":"A","d3":"A","d4":"B","d5":"C","d6":"C"}
        for draft_id in skill:
            rows.append({
                "draft_id":draft_id,"pack_number":"0","pick_number":"0","pick":picks[draft_id],
                "user_game_win_rate_bucket":skill[draft_id],"user_n_games_bucket":"100 - 499",
                "pack_card_A":"1","pack_card_B":"1","pack_card_C":"1",
                "pool_A":"0","pool_B":"0","pool_C":"0"
            })
            rows.append({
                "draft_id":draft_id,"pack_number":"0","pick_number":"1",
                "pick":"B" if picks[draft_id] == "A" else "A",
                "user_game_win_rate_bucket":skill[draft_id],"user_n_games_bucket":"100 - 499",
                "pack_card_A":"1","pack_card_B":"1","pack_card_C":"0",
                "pool_A":"1" if picks[draft_id] == "A" else "0",
                "pool_B":"1" if picks[draft_id] == "B" else "0","pool_C":"0"
            })
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)

    def make_args(self, tmp, csv_path):
        game_path = Path(tmp) / "games.csv"
        with game_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=[
                "draft_id", "main_colors", "deck_A", "deck_B", "deck_C"])
            writer.writeheader()
            for draft_id in ("d1", "d2", "d3", "d4", "d5", "d6"):
                writer.writerow({
                    "draft_id": draft_id, "main_colors": "U",
                    "deck_A": "1", "deck_B": "1", "deck_C": "0",
                })
        return argparse.Namespace(
            input=str(csv_path), output_dir=str(Path(tmp)/"tst"), catalog=str(Path(tmp)/"catalog.json"),
            expansion="TST", format="PremierDraft", source_date="2026-01-01", minimum_games=100,
            top_fraction=2/3, max_training_drafts=100, max_output_drafts=1, minimum_picks=2,
            folds=2, shard_size=2, card_metadata=None,
            deck_fit=None, game_data=str(game_path),
        )

    @staticmethod
    def make_deck_fit(path):
        """A minimal colour table. Every card unknown, so the colour term
        abstains and the fixture exercises the pair path alone; the stage curve
        is present so load_deck_fit accepts it."""
        path.write_text(json.dumps({
            "set_id": "tst", "split": "train", "play_rate": 0.6,
            "by_commitment": {"0": 0.5, "1-2": 0.55, "3-5": 0.6, "6-9": 0.65, "10+": 0.6},
            "by_stage": {}, "cards": {},
        }))
        return path

    def test_pipeline_emits_pool_conditioned_replays(self):
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "draft.csv"
            self.make_fixture(csv_path)
            dataset = build(self.make_args(tmp, csv_path))
            self.assertFalse(dataset["is_fixture"])
            self.assertTrue(dataset["model"]["pool_conditioned"])
            self.assertEqual(dataset["model"]["holdout"], "2-fold by draft_id")
            self.assertEqual(dataset["model"]["model_version"], "strong-player-colour-stage-v4")
            self.assertEqual(len(dataset["replays"]), 1)
            first = dataset["replays"][0]["picks"][0]
            self.assertEqual(first["pack_number"], 1)
            self.assertEqual(first["pick_number"], 1)
            self.assertAlmostEqual(sum(card["model_probability"] for card in first["candidates"]), 1.0, places=5)

    def test_shards_and_catalog(self):
        with tempfile.TemporaryDirectory() as tmp:
            csv_path = Path(tmp) / "draft.csv"
            self.make_fixture(csv_path)
            args = self.make_args(tmp, csv_path)
            dataset = build(args)
            out_dir = Path(args.output_dir)
            manifest = write_sharded_dataset(dataset, out_dir, 2)
            update_catalog(Path(args.catalog), manifest, out_dir)
            self.assertEqual(manifest["replay_count"], len(dataset["replays"]))
            self.assertGreaterEqual(len(manifest["shards"]), 2)
            for shard in manifest["shards"]:
                path = Path(tmp) / shard["path"].replace("./data/tst/", "tst/")
                self.assertTrue(path.exists())
            catalog = json.loads(Path(args.catalog).read_text())
            self.assertEqual(catalog["sets"][0]["id"], "tst")
            self.assertEqual(catalog["sets"][0]["manifest_path"], "./data/tst/manifest.json")

    def test_each_draft_is_assigned_a_holdout_fold(self):
        self.assertTrue(0 <= stable_fold("draft-a", 5) < 5)


if __name__ == "__main__":
    unittest.main()
