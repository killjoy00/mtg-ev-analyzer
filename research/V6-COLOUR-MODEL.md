# v6 colour model: frozen held-out assessment

Status: preregistered before any test-split decision was scored. Results are appended below `## Results` and must not change anything above it.

## Change under test

`strong-player-colour-stage-v6` (corpus `elite-trophy-colour-stage-v10`) keeps v5's architecture, uncapped training, five-fold isolation, scoring and display calibration. Its colour policy differs in two ways:

- Each game's `splash_colors` count as deck colours. Reading `main_colors` alone filed splashed cards under decks outside their colour and dropped printed colours from the inferred affinity ([PR #1437](https://github.com/killjoy00/mtg-ev-analyzer/pull/1437)).
- A 0.0 rate cell is data, as in the evaluation harness, rather than missing.

The `splash` research arm beat v5 on 8 of 10 validation confirmation sets and beat every other challenger ([PR #1442](https://github.com/killjoy00/mtg-ev-analyzer/pull/1442)). It was worse on TDM. The owner chose one uniform model for every set, so no per-set exception is allowed and per-set results do not gate the decision.

## Method

- Arms: the production `OutOfFoldModel` under each model's `colour_policy`, via `scripts/assess_v6_colour_model.py`. Both use the same uncapped harness train-split counts and stage-matched pair expectations. Each colour table is rebuilt on the train split from the same game archive.
- Sets: all 30 environments in `corpus/draft-run/catalog.json`: the 26 regular sets, HBG, SIR, PIO and Powered Cube. Current 17Lands Premier archives retrieved on 2026-10-29; every checksum is recorded. All 30 are required; if any source cannot be obtained, the result is incomplete, not a pass.
- Split: the harness test split, scored once. Earlier, unrelated model experiments read the test split of some sets ([model evaluation](../docs/MODEL-EVALUATION.md)); this is its first use for any colour-representation comparison. Nothing is fitted on test.
- Scope: the served slice, Pack 1 picks 1–11, for every set.

## Decision rule

Primary: pooled served-slice log loss, v6 minus v5, over every test decision in all 30 sets. The 95% interval comes from one cluster bootstrap over drafts across all sets: 2,000 draws, NumPy seed 20260915, `scripts/report_v6_colour_model.py`.

**v6 passes** if the pooled log-loss interval lies entirely below zero and the pooled top-1 interval does not lie entirely below zero. Otherwise **v6 does not pass**, and it should not be released.

Reported without gating:

- Per-set log loss, top-1 and Brier deltas with the harness per-set bootstrap.
- Counts of sets better, worse and unchanged.
- The Daily-weighted mean delta, using `eval_model.daily_weights()`.
- How often the model's leader changes, and the mean absolute change in model-only points.
- Colour-judgment coverage.
- The display exponent that minimises log loss on the validation calibration partition, pooled across sets, for each arm. Corpora named `-colour-stage-` currently display at 1.75. Points never depend on this exponent.

This is pick prediction against strong players' choices. It is the quantity the game's partial credit is defined from, but it does not show that alternatives are judged fairly in context.

## Reproduce

```sh
python scripts/eval_model.py extract --archive raw-data/SET/draft.csv.gz --set-id SET --cache raw-data/SET/cache.json
python scripts/assess_v6_colour_model.py --cache raw-data/SET/cache.json \
  --games raw-data/SET/games.csv.gz --games-sha256 GAME_SHA256 --draft-sha256 DRAFT_SHA256 \
  --split test --final-test --output artifacts/v6/reports/SET.json --draft-deltas artifacts/v6/deltas/SET.json.gz
python scripts/report_v6_colour_model.py --reports artifacts/v6/reports --deltas artifacts/v6/deltas \
  --output research/data/v6-colour-model-assessment.json
```

The per-draft delta files contain 17Lands draft identifiers and stay under ignored `artifacts/`. Public data attribution: [17Lands datasets](https://www.17lands.com/public_datasets), CC BY 4.0.

## Results

Amendment, 2026-10-29, before any pooled computation or any reading of a test-split result: the pooled bootstrap uses Python's `random.Random(20260915)` and the harness's percentile rule (`eval_model._interval`) instead of NumPy, because CI does not install NumPy. The resampling unit, draw count and decision rule are unchanged. At the time of this change one of the 30 per-set test runs (HOB) had finished; its output was not opened.
