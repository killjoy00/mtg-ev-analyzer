import contextlib
import gzip
import io
import json
import math
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_replays import CountStore, DraftSkill, OutOfFoldModel, PickExample, logit
from eval_model import (
    VARIANTS,
    award,
    behaviour_support,
    build_backbone,
    fit_temperature,
    guard_test_split,
    js_round,
    normalize_probabilities,
    sharpen,
    REVIEW_INSTRUCTIONS,
    pack_strata,
    render_review_sheet,
    evidence_bucket,
    Accumulator,
    Cache,
    Calibration,
    GradingStats,
    VariantModel,
    cap_prefix,
    daily_weights,
    draft_split,
    eligible_cohort,
    extract,
    pair_expectations,
    paired_bootstrap,
    pick_metrics,
    pool_bucket,
    weighted_headline,
)
from eval_model import parse_args as eval_model_args
from pick_prediction import parse_args as pick_prediction_args
from pick_value import parse_args as pick_value_args
from grading_curve import parse_args as grading_curve_args
from deck_fit import parse_args as deck_fit_args


def example(draft_id, pack, pick, chosen, candidates, pool=None):
    return PickExample(draft_id, pack, pick, chosen, list(candidates), dict(pool or {}))


class SplitTests(unittest.TestCase):
    def test_split_is_stable_and_draft_separated(self):
        ids = [f"draft-{i}" for i in range(4000)]
        first = [draft_split(i) for i in ids]
        self.assertEqual(first, [draft_split(i) for i in ids])
        shares = Counter(first)
        self.assertAlmostEqual(shares["train"] / len(ids), 0.60, delta=0.03)
        self.assertAlmostEqual(shares["validation"] / len(ids), 0.15, delta=0.03)
        self.assertAlmostEqual(shares["test"] / len(ids), 0.25, delta=0.03)

    def test_splits_do_not_overlap(self):
        ids = [f"d{i}" for i in range(500)]
        groups = {name: {i for i in ids if draft_split(i) == name}
                  for name in ("train", "validation", "test")}
        self.assertEqual(sum(len(g) for g in groups.values()), len(ids))
        self.assertFalse(groups["train"] & groups["test"])
        self.assertFalse(groups["train"] & groups["validation"])
        self.assertFalse(groups["validation"] & groups["test"])


class CohortTests(unittest.TestCase):
    def test_ties_at_the_cutoff_are_admitted(self):
        # Bucketed win rates mean many drafts share the cutoff value exactly,
        # so the eligible share lands above the requested top fraction.
        skills = {f"d{i}": DraftSkill(rate=0.55, games_lower_bound=100) for i in range(90)}
        skills.update({f"h{i}": DraftSkill(rate=0.62, games_lower_bound=100) for i in range(10)})
        eligible, cutoff, experienced = eligible_cohort(skills, 100, 0.15)
        self.assertEqual(experienced, 100)
        self.assertEqual(cutoff, 0.55)
        self.assertEqual(len(eligible), 100)

    def test_inexperienced_drafts_are_excluded(self):
        skills = {"a": DraftSkill(0.7, 100), "b": DraftSkill(0.9, 20)}
        eligible, _, experienced = eligible_cohort(skills, 100, 1.0)
        self.assertEqual(experienced, 1)
        self.assertEqual(eligible, ["a"])

    def test_cap_prefix_is_nested(self):
        ids = [f"d{i}" for i in range(50)]
        self.assertEqual(cap_prefix(ids, 10), ids[:10])
        self.assertEqual(cap_prefix(ids, 10), cap_prefix(ids, 20)[:10])
        self.assertEqual(cap_prefix(ids, None), ids)


class MetricTests(unittest.TestCase):
    def test_pick_metrics_on_a_confident_correct_call(self):
        loss, brier, hit, rank = pick_metrics([0.7, 0.2, 0.1], 0)
        self.assertAlmostEqual(loss, -math.log(0.7))
        self.assertAlmostEqual(brier, 0.09 + 0.04 + 0.01)
        self.assertTrue(hit)
        self.assertEqual(rank, 1)

    def test_rank_counts_better_scoring_cards(self):
        _, _, hit, rank = pick_metrics([0.5, 0.3, 0.2], 2)
        self.assertFalse(hit)
        self.assertEqual(rank, 3)

    def test_uniform_log_loss_matches_candidate_count(self):
        loss, _, _, _ = pick_metrics([0.25] * 4, 1)
        self.assertAlmostEqual(loss, math.log(4))

    def test_accumulator_reports_a_standard_error(self):
        acc = Accumulator()
        for value in (0.5, 1.5, 0.5, 1.5):
            acc.add(value, 0.2, True, 1, 5)
        summary = acc.summary()
        self.assertEqual(summary["n"], 4)
        self.assertAlmostEqual(summary["log_loss"], 1.0)
        self.assertAlmostEqual(summary["log_loss_stderr"], 0.25)
        self.assertEqual(summary["top1_accuracy"], 1.0)


class CalibrationTests(unittest.TestCase):
    def test_a_perfectly_calibrated_stream_has_near_zero_error(self):
        calibration = Calibration()
        # 80 of 100 examples put 0.8 on the card that was actually taken.
        for index in range(100):
            calibration.add([0.8, 0.2], 0 if index < 80 else 1)
        summary = calibration.summary()
        self.assertLess(summary["confidence_ece"], 0.02)
        self.assertLess(summary["per_card_ece"], 0.02)

    def test_overconfidence_is_detected(self):
        calibration = Calibration()
        for index in range(100):
            calibration.add([0.95, 0.05], 0 if index < 50 else 1)
        self.assertGreater(calibration.summary()["confidence_ece"], 0.4)


class GradingTests(unittest.TestCase):
    def test_support_ratio_and_displayed_score(self):
        grading = GradingStats()
        grading.add([0.5, 0.25], 1)
        summary = grading.summary()
        self.assertEqual(summary["historical_pick_is_leader"], 0.0)
        self.assertAlmostEqual(summary["mean_support_ratio"], 0.5)
        # round(95 * 0.5) is the partial credit the player would see.
        self.assertEqual(summary["median_displayed_score"], 48)

    def test_leader_pick_scores_full_marks(self):
        grading = GradingStats()
        grading.add([0.6, 0.4], 0)
        summary = grading.summary()
        self.assertEqual(summary["historical_pick_is_leader"], 1.0)
        self.assertEqual(summary["median_displayed_score"], 95)

    def test_severity_is_tracked_apart_from_disagreement(self):
        grading = GradingStats()
        grading.add([1.0, 0.9], 1)   # disagreement, barely
        grading.add([1.0, 0.05], 1)  # disagreement, severe
        summary = grading.summary()
        self.assertEqual(summary["historical_below_leader"], 1.0)
        self.assertEqual(summary["below_one_fifth_of_leader"], 0.5)


class VariantTests(unittest.TestCase):
    def counts_with_pair_evidence(self):
        counts = CountStore.empty()
        # "anchor" is picked half the time overall at this position.
        for index in range(40):
            counts.observe(example(f"d{index}", 0, 0, "anchor" if index % 2 else "other",
                                   ["anchor", "other"]))
        # Alongside "partner" it is taken far more often, but only at later picks.
        for index in range(40):
            counts.observe(example(f"p{index}", 0, 6, "anchor" if index % 10 else "other",
                                   ["anchor", "other"], {"partner": 1}))
        return counts

    def test_v2_reproduces_production_card_tendency(self):
        counts = self.counts_with_pair_evidence()
        pool = {"partner": 1}
        production = OutOfFoldModel(counts, CountStore.empty())
        harness = VariantModel(counts, VARIANTS["v2"])
        for pick in (0, 6):
            self.assertAlmostEqual(
                harness.card_tendency("anchor", 0, pick, pool),
                production.card_tendency("anchor", 0, pick, pool), places=12)

    def test_no_context_variant_ignores_the_pool(self):
        counts = self.counts_with_pair_evidence()
        model = VariantModel(counts, VARIANTS["v2-no-context"])
        self.assertAlmostEqual(model.card_tendency("anchor", 0, 6, {"partner": 1}),
                               model.base_tendency("anchor", 0, 6), places=12)

    def test_coverage_shrinks_context_when_evidence_is_thin(self):
        counts = self.counts_with_pair_evidence()
        thin_pool = {"partner": 1, **{f"unknown{i}": 1 for i in range(7)}}
        base = VariantModel(counts, VARIANTS["v2"]).card_tendency("anchor", 0, 6, thin_pool)
        covered = VariantModel(counts, VARIANTS["v2-coverage"]).card_tendency("anchor", 0, 6, thin_pool)
        plain = VariantModel(counts, VARIANTS["v2"]).base_tendency("anchor", 0, 6)
        # One qualifying pair in an eight-card pool should move the estimate far
        # less once coverage is taken into account.
        self.assertGreater(abs(base - plain), abs(covered - plain))

    def test_stage_matched_context_removes_a_pure_stage_effect(self):
        """A lift explained entirely by draft stage should wash out.

        "late" is taken 10% of the time at pick 2 and 90% at pick 10. The same
        eight cards sit in the pool at both, so they cause none of that swing.
        Pair counts are not keyed by position, so their pooled rate lands near
        50% and v2 reads it as a large lift over the 10% base at pick 2.
        """
        pool = {f"partner{i}": 1 for i in range(8)}
        examples = []
        for index in range(200):
            examples.append(example(f"early{index}", 0, 2,
                                    "late" if index < 20 else "other",
                                    ["late", "other"], pool))
            examples.append(example(f"deep{index}", 0, 10,
                                    "late" if index < 180 else "other",
                                    ["late", "other"], pool))
        counts = CountStore.empty()
        for item in examples:
            counts.observe(item)
        train_ids = sorted({item.draft_id for item in examples})
        with tempfile.TemporaryDirectory() as directory:
            cache = self.build_cache(Path(directory), examples)
            expectations = pair_expectations(cache, train_ids, counts)

        naive = VariantModel(counts, VARIANTS["v2"])
        matched = VariantModel(counts, VARIANTS["v3-stage-matched"], expectations)
        base = naive.base_tendency("late", 0, 2)
        self.assertLess(base, 0.2)

        naive_shift = abs(naive.card_tendency("late", 0, 2, pool) - base)
        matched_shift = abs(matched.card_tendency("late", 0, 2, pool) - base)
        # v2 inflates a 10% card substantially; stage matching leaves it alone.
        self.assertGreater(naive_shift, 0.1)
        self.assertLess(matched_shift, 0.01)

    # ------------------------------------------------------------------
    # colour-commitment context
    # ------------------------------------------------------------------

    @staticmethod
    def fit_table():
        """"mono" is abandoned from an off-colour pool and kept from an on-colour
        one; "vanilla" plays at the same rate whatever is beside it."""
        return {"grand_play_rate": 0.6, "play_rate": 0.55,
                "by_commitment": {"0": 0.40, "1-2": 0.50, "3-5": 0.60,
                                  "6-9": 0.70, "10+": 0.80},
                "cards": {
            "mono": {"play_rate": 0.50, "colours": "U", "observations": 900,
                     "by_commitment": {"0": 0.50, "1-2": 0.55, "3-5": 0.70,
                                       "6-9": 0.85, "10+": 0.92}},
            "vanilla": {"play_rate": 0.60, "colours": "U", "observations": 900,
                        "by_commitment": {"0": 0.60, "1-2": 0.60, "3-5": 0.60,
                                          "6-9": 0.60, "10+": 0.60}},
            "offcolour": {"play_rate": 0.50, "colours": "R", "observations": 900,
                          "by_commitment": {"0": 0.50, "1-2": 0.55, "3-5": 0.70,
                                            "6-9": 0.85, "10+": 0.92}},
                }}

    def fit_model(self, counts=None, name="v3-deck-fit", fit=True):
        return VariantModel(counts or self.counts_with_pair_evidence(), VARIANTS[name],
                            None, self.fit_table() if fit else None)

    def test_a_matching_pool_raises_the_odds_the_card_reaches_a_deck(self):
        model = self.fit_model()
        blue_pool = {f"blue{i}": 1 for i in range(6)}
        for card in blue_pool:
            model.fit_colours[card] = frozenset("U")
        self.assertGreater(model.fit_shift("mono", blue_pool), 0)
        self.assertLess(model.fit_shift("mono", {}), 1e-12)

    def test_an_off_colour_pool_does_not_lift_the_card(self):
        """The pool is large, so a term keyed on pool size alone would fire.
        Only the colour-matched count may."""
        model = self.fit_model()
        red_pool = {f"red{i}": 1 for i in range(6)}
        for card in red_pool:
            model.fit_colours[card] = frozenset("R")
        self.assertAlmostEqual(model.fit_shift("mono", red_pool), 0.0, places=12)
        self.assertGreater(model.fit_shift("offcolour", red_pool), 0)

    def test_a_card_whose_play_rate_never_moves_gets_no_shift(self):
        model = self.fit_model()
        blue_pool = {f"blue{i}": 1 for i in range(6)}
        for card in blue_pool:
            model.fit_colours[card] = frozenset("U")
        self.assertAlmostEqual(model.fit_shift("vanilla", blue_pool), 0.0, places=12)

    def test_an_unknown_card_or_a_missing_table_shifts_nothing(self):
        blue_pool = {"blue": 1}
        with_table = self.fit_model()
        with_table.fit_colours["blue"] = frozenset("U")
        self.assertEqual(with_table.fit_shift("never-seen", blue_pool), 0.0)
        self.assertEqual(self.fit_model(fit=False).fit_shift("mono", blue_pool), 0.0)

    def test_the_fit_term_applies_at_an_empty_pool_where_the_pair_term_cannot(self):
        """Bucket "0" is a real estimate, not a missing one: a card nobody plays
        off a bare pool should be marked down at pick one, and v2 cannot say so."""
        counts = self.counts_with_pair_evidence()
        fitted = self.fit_model(counts)
        # A card that is usually kept but rarely kept from nothing.
        fitted.fit["cards"]["anchor"] = {"play_rate": 0.80, "colours": "U",
                                         "observations": 900,
                                         "by_commitment": {"0": 0.40, "10+": 0.95}}
        # The colour map is derived at construction, so a card added afterwards
        # has to be added to both. Without this the card reads as unknown and
        # correctly gets no adjustment at all - which is the whole point of the
        # three-state scheme, and would make this test pass for the wrong reason.
        fitted.fit_colours["anchor"] = frozenset("U")
        base = fitted.base_tendency("anchor", 0, 0)
        self.assertLess(fitted.card_tendency("anchor", 0, 0, {}), base)
        self.assertAlmostEqual(VariantModel(counts, VARIANTS["v2"]).card_tendency("anchor", 0, 0, {}),
                               base, places=12)

    def test_the_colour_only_variant_ignores_the_cards_own_play_rates(self):
        """If this carries most of the per-card version's value, a port needs
        only which colours a card is - already on the card - and never has to
        ship a per-card table built from game data."""
        pooled = self.fit_model(name="v3-colour-only")
        per_card = self.fit_model(name="v3-deck-fit")
        blue_pool = {f"blue{i}": 1 for i in range(6)}
        for model in (pooled, per_card):
            for card in blue_pool:
                model.fit_colours[card] = frozenset("U")
        # "vanilla" never moves on its own table, but the format's cards do.
        self.assertAlmostEqual(per_card.fit_shift("vanilla", blue_pool), 0.0, places=12)
        self.assertGreater(pooled.fit_shift("vanilla", blue_pool), 0)
        # Two cards with the same colours get the same shift from one curve.
        self.assertAlmostEqual(pooled.fit_shift("vanilla", blue_pool),
                               pooled.fit_shift("mono", blue_pool), places=12)
        self.assertNotAlmostEqual(per_card.fit_shift("vanilla", blue_pool),
                                  per_card.fit_shift("mono", blue_pool), places=6)

    def coloured_model(self, name, pools, by_stage=None):
        """A model that knows the colours of the cards in `pools`.

        The fit table only names the three cards under test, so a pool card's
        colour has to be painted on or commitment silently counts zero - which
        is a real trap, since every such test would then compare bucket "0"
        against bucket "0" and pass for the wrong reason.
        """
        model = self.fit_model(name=name)
        if by_stage is not None:
            model.fit["by_stage"] = by_stage
        for pool, letters in pools:
            for card in pool:
                model.fit_colours[card] = frozenset(letters)
        return model

    def test_holding_the_stage_strips_a_commitment_effect_that_is_only_stage(self):
        """A pool of eight is both "your colours are settled" and "you are eight
        picks in". Here the play rate depends only on the latter, so a term
        that reads commitment must report nothing."""
        pool = {f"blue{i}": 1 for i in range(8)}
        stage = {  # every commitment level inside this stage plays at its rate
            "s6-9": {"*": 0.70, "3-5": 0.70, "6-9": 0.70},
            "s1-2": {"*": 0.45, "0": 0.45, "1-2": 0.45},
        }
        held = self.coloured_model("v3-colour-stage", [(pool, "U")], stage)
        marginal = self.coloured_model("v3-colour-only", [(pool, "U")])
        # The marginal curve reads this as a large lift; holding the stage
        # leaves nothing, because nothing here is about colour.
        self.assertGreater(marginal.fit_shift("mono", pool), 0.5)
        self.assertAlmostEqual(held.fit_shift("mono", pool), 0.0, places=12)

    def test_a_real_colour_effect_survives_holding_the_stage(self):
        on_colour = {f"blue{i}": 1 for i in range(8)}
        off_colour = {f"red{i}": 1 for i in range(8)}
        model = self.coloured_model("v3-colour-stage",
                                    [(on_colour, "U"), (off_colour, "R")],
                                    {"s6-9": {"*": 0.60, "0": 0.30, "6-9": 0.85}})
        self.assertGreater(model.fit_shift("mono", on_colour), 0)
        self.assertLess(model.fit_shift("mono", off_colour), 0)

    def test_a_missing_stage_cell_falls_back_to_the_marginal_curve(self):
        """Thin cells are dropped upstream, so the consumer must land on the
        marginal curve rather than on nothing."""
        pool = {f"blue{i}": 1 for i in range(8)}
        held = self.coloured_model("v3-colour-stage", [(pool, "U")],
                                   {"s20+": {"*": 0.6, "10+": 0.9}})
        marginal = self.coloured_model("v3-colour-only", [(pool, "U")])
        self.assertAlmostEqual(held.fit_shift("mono", pool),
                               marginal.fit_shift("mono", pool), places=12)
        self.assertNotAlmostEqual(held.fit_shift("mono", pool), 0.0, places=6)

    def test_the_colour_only_variant_still_needs_to_know_the_card(self):
        """Colours come from the same table, so a card missing from it has no
        colours to match on and must not be given the curve anyway."""
        pooled = self.fit_model(name="v3-colour-only")
        pooled.fit_colours["blue"] = frozenset("U")
        self.assertEqual(pooled.fit_shift("never-seen", {"blue": 6}), 0.0)

    def test_the_combined_variant_adds_both_terms_in_log_odds(self):
        counts = self.counts_with_pair_evidence()
        pool = {"partner": 1}
        fit = self.fit_table()
        fit["cards"]["anchor"] = {"play_rate": 0.50, "colours": "U", "observations": 900,
                                  "by_commitment": {"0": 0.50, "1-2": 0.75}}
        expectations = {("anchor", "partner"): 0.0, ("other", "partner"): 0.0}
        pair_only = VariantModel(counts, VARIANTS["v3-stage-matched"], expectations)
        both = VariantModel(counts, VARIANTS["v3-fit-and-pair"], expectations, fit)
        both.fit_colours["partner"] = frozenset("U")
        pair_shift = logit(pair_only.card_tendency("anchor", 0, 6, pool)) \
            - logit(pair_only.base_tendency("anchor", 0, 6))
        fit_shift = VARIANTS["v3-fit-and-pair"].fit_strength * both.fit_shift("anchor", pool)
        self.assertGreater(abs(fit_shift), 1e-6)
        self.assertAlmostEqual(
            logit(both.card_tendency("anchor", 0, 6, pool)),
            logit(both.base_tendency("anchor", 0, 6)) + pair_shift + fit_shift, places=10)

    @staticmethod
    def build_cache(directory: Path, examples) -> Cache:
        names: list[str] = []
        index: dict[str, int] = {}

        def intern(name):
            if name not in index:
                index[name] = len(names)
                names.append(name)
            return index[name]

        drafts = sorted({e.draft_id for e in examples})
        order = {d: i for i, d in enumerate(drafts)}
        picks_path = directory / "cache.json.picks.jsonl.gz"
        with gzip.open(picks_path, "wt", encoding="utf-8") as handle:
            for item in examples:
                handle.write(json.dumps([
                    order[item.draft_id], item.raw_pack_number, item.raw_pick_number,
                    intern(item.historical_pick),
                    [intern(c) for c in item.candidates],
                    [[intern(c), n] for c, n in sorted(item.pool.items())],
                ]) + "\n")
        meta_path = directory / "cache.json"
        meta_path.write_text(json.dumps({
            "cache_version": 3, "set_id": "test", "drafts": drafts, "vocabulary": names,
            "pack_offset": 1, "pick_offset": 1, "picks_file": picks_path.name,
        }))
        return Cache.load(meta_path)


class SplitDisciplineTests(unittest.TestCase):
    """Reaching the test split has to be something a person typed.

    Every selection surface here once defaulted to test, or read validation and
    test together. Choosing lambda, a weight or a variant while the test split
    is in view turns it into more validation data, and no later run undoes that.
    """

    def test_every_evaluation_entry_point_defaults_to_validation(self):
        for module, argv in ((eval_model_args, ["evaluate", "c.json"]),
                             (pick_value_args, ["--set", "a:b:c"]),
                             (pick_prediction_args, ["--set", "a:b"])):
            with self.subTest(entry=module.__module__):
                self.assertEqual(module(argv).split, "validation")

    def test_test_split_is_still_reachable_on_purpose(self):
        self.assertEqual(eval_model_args(["evaluate", "c.json", "--split", "test"]).split,
                         "test")
        self.assertEqual(pick_value_args(["--set", "a:b:c", "--split", "test"]).split, "test")
        self.assertEqual(pick_prediction_args(["--set", "a:b", "--split", "test"]).split,
                         "test")

    def test_nothing_outside_those_two_splits_is_accepted(self):
        for module, argv in ((eval_model_args, ["evaluate", "c.json", "--split", "train"]),
                             (pick_value_args, ["--set", "a:b:c", "--split", "train"]),
                             (pick_prediction_args, ["--set", "a:b", "--split", "train"])):
            # argparse prints its usage to stderr on the way out; swallow it so
            # a passing suite stays readable.
            with self.subTest(entry=module.__module__), self.assertRaises(SystemExit), \
                    contextlib.redirect_stderr(io.StringIO()):
                module(argv)


    def test_reading_test_needs_a_second_deliberate_flag(self):
        """A default is a suggestion. Three surfaces here silently defaulted to
        test and nobody noticed until an outsider read the source."""
        with self.assertRaises(SystemExit) as caught:
            guard_test_split("test", final_test=False)
        self.assertIn("--final-test", str(caught.exception))
        guard_test_split("test", final_test=True)      # allowed, on purpose
        guard_test_split("validation", final_test=False)
        # The flag alone must not drag anything onto test.
        guard_test_split("validation", final_test=True)

    def test_the_flag_exists_on_every_entry_point(self):
        for module, argv in ((eval_model_args, ["evaluate", "c.json"]),
                             (pick_value_args, ["--set", "a:b:c"]),
                             (pick_prediction_args, ["--set", "a:b"]),
                             (grading_curve_args, ["--pair", "a:b"]),
                             (deck_fit_args, ["--games", "g", "--cache", "c", "--out", "o"])):
            with self.subTest(entry=module.__module__):
                self.assertFalse(module(argv).final_test)
                self.assertTrue(module(argv + ["--final-test"]).final_test)

    def test_the_two_surfaces_an_outside_reviewer_found(self):
        """grading_curve.py read the test split directly - missed because it
        lives in the grading track, not the prediction track. deck_fit.py
        defaulted to no restriction at all, which means every split including
        test; the pipeline always passed train, so nothing was contaminated,
        but a standalone run was one omitted flag away from it."""
        self.assertEqual(grading_curve_args(["--pair", "a:b"]).split, "validation")
        self.assertEqual(deck_fit_args(["--games", "g", "--cache", "c",
                                        "--out", "o"]).split, "train")
        # "all" stays reachable for a deliberate descriptive run, and is not test.
        self.assertEqual(deck_fit_args(["--games", "g", "--cache", "c", "--out", "o",
                                        "--split", "all"]).split, "all")


class BackboneTests(unittest.TestCase):
    """An outcome weight fitted against a backbone that still makes the errors
    outcomes were compensating for measures the wrong marginal value."""

    def counts(self):
        store = CountStore.empty()
        for index in range(40):
            store.observe(example(f"d{index}", 0, 0, "a" if index % 2 else "b", ["a", "b"]))
        return store

    def test_the_backbone_is_the_variant_asked_for(self):
        counts = self.counts()
        model = build_backbone(None, [], counts, "v2-no-context")
        self.assertEqual(model.variant.name, "v2-no-context")
        self.assertFalse(model.variant.context)

    def test_an_unknown_backbone_is_refused(self):
        with self.assertRaises(SystemExit):
            build_backbone(None, [], self.counts(), "v9-imaginary")

    def test_a_deck_fit_backbone_without_a_table_is_refused(self):
        """Silently dropping the colour term would leave a model that reports
        itself as v3 while behaving like v2."""
        with self.assertRaises(SystemExit) as caught:
            build_backbone(None, [], self.counts(), "v3-colour-and-pair", fit=None)
        self.assertIn("deck-fit", str(caught.exception))


class EvidenceBucketTests(unittest.TestCase):
    def test_buckets_are_contiguous_and_ordered(self):
        seen = [evidence_bucket(n) for n in (0, 24, 25, 79, 80, 159, 160, 399, 400, 10 ** 9)]
        self.assertEqual(seen, ["evidence 0-24", "evidence 0-24",
                                "evidence 25-79", "evidence 25-79",
                                "evidence 80-159", "evidence 80-159",
                                "evidence 160-399", "evidence 160-399",
                                "evidence 400+", "evidence 400+"])

    def test_support_follows_the_level_base_tendency_actually_used(self):
        """A card seen thousands of times across the format can still rest on a
        handful of observations at this exact pick."""
        counts = CountStore.empty()
        # 40 observations at (pack 0, pick 0): over the exact threshold of 20.
        for index in range(40):
            counts.observe(example(f"d{index}", 0, 0, "thick", ["thick", "other"]))
        # One observation at pick 9, so that position falls back past exact and
        # past pack to the global count.
        counts.observe(example("late", 0, 9, "thick", ["thick", "other"]))
        model = VariantModel(counts, VARIANTS["v2"])
        self.assertEqual(behaviour_support(model, "thick", 0, 0), 40)
        self.assertEqual(behaviour_support(model, "thick", 0, 9),
                         model._count("global_seen", "thick"))


class AwardTests(unittest.TestCase):
    """Log loss says a model ranks better. It does not say what happens to the
    points in a player's run, and those are different questions."""

    def test_the_award_is_the_production_formula(self):
        self.assertEqual(award([0.5, 0.25, 0.25], 0), 95)      # leader
        self.assertEqual(award([0.5, 0.25, 0.25], 1), 48)      # round(95 * 0.5)
        self.assertEqual(award([0.0, 0.0, 0.0], 0), 0)         # degenerate pack

    def test_half_points_round_the_way_production_rounds(self):
        """95 x 0.7 is 66.5. Python's banker's rounding says 66 and JavaScript
        says 67 - a one-point gap in a comparison built to count one-point gaps."""
        self.assertEqual(js_round(66.5), 67)
        self.assertEqual(js_round(-0.5), 0)
        self.assertEqual(award([1.0, 0.7], 1), 67)

    def test_the_display_exponent_cannot_move_a_single_point(self):
        """Calibration raises supports to T and scoring raises the ratio to 1/T,
        so T cancels exactly. This is what makes the display change display-only
        - and it means refitting T for a new model is not a scoring risk. What
        moves points is the model changing the underlying probabilities."""
        raw = [0.52, 0.21, 0.15, 0.07, 0.05]
        for temperature in (1.0, 1.5, 2.0, 2.25, 3.0):
            sharpened = normalize_probabilities(sharpen(
                {i: v for i, v in enumerate(raw)}, temperature))
            calibrated = [sharpened[i] for i in range(len(raw))]
            for index in range(len(raw)):
                ratio = calibrated[index] / max(calibrated)
                with self.subTest(temperature=temperature, index=index):
                    self.assertEqual(js_round(95 * ratio ** (1 / temperature)),
                                     award(raw, index))

    def test_a_sharper_model_awards_less_partial_credit(self):
        """The direction that matters for the product: a more confident model
        puts less probability on the alternatives, so the ratio to the leader
        shrinks and partial credit falls - without anyone changing the formula."""
        flat, sharp = [0.4, 0.3, 0.3], [0.8, 0.1, 0.1]
        self.assertGreater(award(flat, 1), award(sharp, 1))

    def test_the_fitted_exponent_is_the_one_that_calibrates_best(self):
        # A stream where the top card is taken far more often than a flat
        # normalisation claims, so sharpening should be preferred to not.
        pairs = [([0.4, 0.3, 0.3], 0)] * 90 + [([0.4, 0.3, 0.3], 1)] * 10
        fitted, loss = fit_temperature(pairs, [1.0, 2.0, 4.0, 8.0])
        self.assertGreater(fitted, 1.0)
        self.assertGreater(loss, 0.0)


class BlindReviewTests(unittest.TestCase):
    """The sheet is worthless the moment a reviewer can infer the answer from
    it, and nothing else in the suite would catch that."""

    def sheet(self):
        entries = [{"pack": 1, "set": "tst", "position": "pack 1, pick 3",
                    "pool": {"Swamp": 2}, "choices": ["Alpha", "Beta", "Gamma"],
                    "verdict": {"Alpha": "", "Beta": "", "Gamma": ""}}]
        return entries, render_review_sheet(entries)

    def test_the_machine_readable_sheet_carries_no_answer_fields(self):
        """Checked against the entries, not the prose: the rendered page says
        'no model scores appear here', and a substring search over that would
        fail on its own disclaimer."""
        entries, _ = self.sheet()
        blob = json.dumps(entries).lower()
        for leak in ("award", "probabilit", "taken", "stratum", "score", "support"):
            with self.subTest(leak=leak):
                self.assertNotIn(leak, blob)

    def test_a_known_answer_does_not_survive_into_the_rendered_page(self):
        entries, text = self.sheet()
        # Values a reviewer must not be able to read off: the award, the
        # probability, and which card was taken.
        for secret in ("95", "48", "0.6123", "Alpha was taken"):
            with self.subTest(secret=secret):
                self.assertNotIn(secret, text)
        # The cards themselves must of course be there.
        for card in entries[0]["choices"]:
            self.assertIn(card, text)

    def test_the_sheet_asks_for_a_judgement_not_a_guess(self):
        """A reviewer told to guess what someone else took would reproduce the
        population's bias, which is the thing under test."""
        self.assertIn("not being asked to guess", REVIEW_INSTRUCTIONS)
        for verdict in ("BEST", "REASONABLE", "MISTAKE"):
            self.assertIn(verdict, REVIEW_INSTRUCTIONS)

    def test_every_choice_appears_exactly_once(self):
        entries, text = self.sheet()
        for card in entries[0]["choices"]:
            self.assertEqual(text.count(f"| {card} |"), 1)

    def test_thin_evidence_reads_the_least_supported_card(self):
        """Keyed on the median it fired on nothing: measured on hob the minimum
        has p05 = 22 while the median has p05 = 60."""
        counts = CountStore.empty()
        for index in range(200):
            counts.observe(example(f"d{index}", 0, 0, "common", ["common", "rare"]))
        model = VariantModel(counts, VARIANTS["v2"])
        thin = example("x", 0, 0, "common", ["common", "rare", "never-seen"])
        thick = example("y", 0, 0, "common", ["common", "rare"])
        self.assertIn("thin-evidence", pack_strata(thin, _FakeCache(), model, {}, 0, 0))
        self.assertNotIn("thin-evidence", pack_strata(thick, _FakeCache(), model, {}, 0, 0))

    def test_a_pack_with_no_special_feature_still_gets_sampled(self):
        """A review made only of hard cases tells you only about hard cases."""
        counts = CountStore.empty()
        for index in range(200):
            counts.observe(example(f"d{index}", 0, 0, "a", ["a", "b"]))
        model = VariantModel(counts, VARIANTS["v2"])
        plain = example("z", 0, 0, "a", ["a", "b"])
        self.assertEqual(pack_strata(plain, _FakeCache(), model, {}, 50, 50), ["ordinary"])

    def test_a_large_award_change_is_always_sampled(self):
        counts = CountStore.empty()
        for index in range(200):
            counts.observe(example(f"d{index}", 0, 0, "a", ["a", "b"]))
        model = VariantModel(counts, VARIANTS["v2"])
        plain = example("z", 0, 0, "a", ["a", "b"])
        self.assertIn("award-shift",
                      pack_strata(plain, _FakeCache(), model, {}, 95, 60))


class _FakeCache:
    set_id = "tst"


class BootstrapTests(unittest.TestCase):
    def test_identical_variants_produce_an_interval_covering_zero(self):
        rows = [(f"d{i // 4}", 1.0 + (i % 3) * 0.1, 0.5, i % 2) for i in range(400)]
        result = paired_bootstrap(rows, rows, draws=200)
        self.assertEqual(result["log_loss_delta"], 0.0)
        self.assertLessEqual(result["log_loss_ci95"][0], 0.0)
        self.assertGreaterEqual(result["log_loss_ci95"][1], 0.0)

    def test_a_uniform_improvement_is_separated_from_zero(self):
        base = [(f"d{i // 4}", 2.0, 0.6, 0) for i in range(400)]
        better = [(f"d{i // 4}", 1.0, 0.3, 1) for i in range(400)]
        result = paired_bootstrap(base, better, draws=200)
        self.assertAlmostEqual(result["log_loss_delta"], -1.0)
        self.assertLess(result["log_loss_ci95"][1], 0.0)

    def test_clusters_by_draft(self):
        rows = [(f"d{i // 10}", 1.0, 0.5, 1) for i in range(100)]
        self.assertEqual(paired_bootstrap(rows, rows, draws=50)["drafts"], 10)

    def test_mismatched_lengths_are_rejected(self):
        with self.assertRaises(ValueError):
            paired_bootstrap([("a", 1.0, 0.5, 1)], [], draws=10)


class ReportingTests(unittest.TestCase):
    def test_daily_weights_follow_the_published_policy(self):
        weights = daily_weights()
        # Tier one is the three most recently released regular sets.
        self.assertEqual(weights["hob"], 6.0)
        self.assertEqual(weights["msh"], 6.0)
        self.assertEqual(weights["tmt"], 4.0)
        self.assertEqual(weights["stx"], 1.0)
        # ktk released in 2014; recency ranking must not treat it as current.
        self.assertEqual(weights["ktk"], 1.0)

    def test_weighted_headline_uses_daily_exposure(self):
        runs = [
            {"set_id": "msh", "served_slice": {"n": 10, "log_loss": 1.0, "brier": 0.5,
                                               "top1_accuracy": 0.4, "mean_reciprocal_rank": 0.6}},
            {"set_id": "stx", "served_slice": {"n": 10, "log_loss": 2.0, "brier": 0.9,
                                               "top1_accuracy": 0.2, "mean_reciprocal_rank": 0.3}},
        ]
        headline = weighted_headline(runs, "served_slice")
        self.assertEqual(headline["total_weight"], 7.0)
        self.assertAlmostEqual(headline["log_loss"], (6 * 1.0 + 1 * 2.0) / 7, places=5)

    def test_pool_buckets(self):
        self.assertEqual(pool_bucket(0), "pool 0")
        self.assertEqual(pool_bucket(2), "pool 1-2")
        self.assertEqual(pool_bucket(11), "pool 11+")


class ExtractTests(unittest.TestCase):
    def test_extract_round_trips_an_archive(self):
        header = ["draft_id", "pack_number", "pick_number", "pick",
                  "user_n_games_bucket", "user_game_win_rate_bucket",
                  "pack_card_Alpha", "pack_card_Beta", "pool_Alpha", "pool_Beta"]
        rows = []
        for index in range(40):
            rows.append([f"d{index}", "0", "0", "Alpha", "100 - 499", "0.60 - 0.64",
                         "1", "1", "0", "0"])
            rows.append([f"d{index}", "0", "1", "Beta", "100 - 499", "0.60 - 0.64",
                         "0", "1", "1", "0"])
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "archive.csv"
            with archive.open("w", encoding="utf-8", newline="") as handle:
                handle.write(",".join(header) + "\n")
                for row in rows:
                    handle.write(",".join(row) + "\n")
            cache_path = Path(directory) / "cache.json"
            summary = extract(archive, "test", cache_path, 100, 1.0)
            self.assertEqual(summary["eligible_drafts"], 40)
            self.assertEqual(summary["picks"], 80)
            # 17Lands ships zero-indexed packs and picks; offsets restore 1-based display.
            self.assertEqual(summary["pack_offset"], 1)
            self.assertEqual(summary["pick_offset"], 1)

            cache = Cache.load(cache_path)
            loaded = list(cache.examples())
            self.assertEqual(len(loaded), 80)
            second = [e for _, e in loaded if e.raw_pick_number == 1][0]
            self.assertEqual(second.historical_pick, "Beta")
            self.assertEqual(second.pool, {"Alpha": 1})
            self.assertEqual(sorted(second.candidates), ["Beta"])

    def test_rows_whose_pick_is_not_in_the_pack_are_dropped(self):
        header = ["draft_id", "pack_number", "pick_number", "pick",
                  "user_n_games_bucket", "user_game_win_rate_bucket",
                  "pack_card_Alpha", "pool_Alpha"]
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "archive.csv"
            with archive.open("w", encoding="utf-8", newline="") as handle:
                handle.write(",".join(header) + "\n")
                for index in range(10):
                    handle.write(f"d{index},0,0,Missing,100 - 499,0.60 - 0.64,1,0\n")
                    handle.write(f"d{index},0,1,Alpha,100 - 499,0.60 - 0.64,1,0\n")
            cache_path = Path(directory) / "cache.json"
            summary = extract(archive, "test", cache_path, 100, 1.0)
            self.assertEqual(summary["picks"], 10)


if __name__ == "__main__":
    unittest.main()
