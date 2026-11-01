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

**Verdict: v6 passes.** Every one of the 30 environments was scored once on the harness test split. Over 1,164,217 served decisions from 106,921 held-out drafts, v6 minus v5:

| Metric | Change | 95% interval |
| --- | ---: | --- |
| Log loss | -0.0166 | [-0.0169, -0.0163] |
| Top-1, percentage points | +0.65 | [+0.60, +0.70] |
| Brier | -0.0059 | [-0.0061, -0.0058] |

The Daily-weighted mean log-loss change is -0.0165. Log loss improved with an interval below zero on 26 sets and worsened with an interval above zero on 3: SNC, TDM and KTK. Top-1 was significantly worse on 1 set, KTK. As preregistered, per-set results do not gate the uniform model.

| Set | Decisions | v5 log loss | Log-loss change [95% CI] | Top-1 change, pp [95% CI] | Leader changes | Mean point change |
| --- | ---: | ---: | --- | --- | ---: | ---: |
| BLB | 46,061 | 1.1950 | -0.0221 [-0.0234, -0.0207] | +0.81 [+0.62, +1.01] | 6.6% | 2.20 |
| BRO | 21,846 | 1.3210 | -0.0157 [-0.0175, -0.0139] | +0.54 [+0.26, +0.80] | 5.9% | 1.73 |
| DFT | 52,189 | 1.2124 | -0.0226 [-0.0241, -0.0211] | +0.83 [+0.61, +1.04] | 9.5% | 2.77 |
| DMU | 50,836 | 1.2870 | -0.0149 [-0.0169, -0.0128] | +0.77 [+0.51, +1.04] | 14.5% | 4.21 |
| DSK | 52,542 | 1.1969 | -0.0217 [-0.0231, -0.0204] | +0.55 [+0.34, +0.76] | 8.2% | 2.48 |
| ECL | 28,440 | 1.2413 | -0.0108 [-0.0130, -0.0088] | +0.72 [+0.40, +1.02] | 10.5% | 3.55 |
| EOE | 35,783 | 1.1463 | -0.0205 [-0.0221, -0.0189] | +1.02 [+0.77, +1.26] | 7.7% | 2.38 |
| FDN | 36,887 | 1.1713 | -0.0228 [-0.0244, -0.0211] | +0.67 [+0.43, +0.92] | 7.6% | 2.27 |
| FIN | 56,001 | 1.2275 | -0.0174 [-0.0188, -0.0160] | +0.73 [+0.51, +0.93] | 9.0% | 2.71 |
| HBG | 9,033 | 1.2453 | -0.0146 [-0.0170, -0.0122] | +0.68 [+0.33, +1.03] | 4.9% | 1.51 |
| HOB | 10,824 | 1.2083 | -0.0113 [-0.0139, -0.0087] | +0.65 [+0.26, +1.03] | 5.4% | 1.54 |
| KTK | 7,093 | 1.2614 | 0.0208 [0.0168, 0.0249] | -0.70 [-1.34, -0.10] | 11.0% | 3.17 |
| LCI | 53,504 | 1.2422 | -0.0121 [-0.0133, -0.0110] | +0.41 [+0.25, +0.57] | 5.4% | 1.60 |
| LTR | 75,671 | 1.1512 | -0.0130 [-0.0140, -0.0120] | +0.36 [+0.23, +0.50] | 5.1% | 1.62 |
| MH3 | 50,448 | 1.3117 | -0.0123 [-0.0138, -0.0108] | +0.53 [+0.30, +0.76] | 9.0% | 2.70 |
| MKM | 59,552 | 1.1912 | -0.0204 [-0.0219, -0.0189] | +0.91 [+0.70, +1.10] | 9.1% | 2.92 |
| MOM | 80,269 | 1.2472 | -0.0148 [-0.0159, -0.0138] | +0.40 [+0.24, +0.55] | 6.9% | 1.98 |
| MSH | 26,983 | 1.2259 | -0.0318 [-0.0341, -0.0295] | +1.43 [+1.07, +1.73] | 10.1% | 3.12 |
| NEO | 42,622 | 1.2229 | -0.0123 [-0.0136, -0.0108] | +0.60 [+0.39, +0.83] | 8.1% | 2.04 |
| ONE | 26,910 | 1.2150 | -0.0151 [-0.0165, -0.0136] | +0.47 [+0.28, +0.68] | 3.7% | 1.18 |
| OTJ | 59,158 | 1.2336 | -0.0291 [-0.0308, -0.0276] | +1.22 [+1.00, +1.47] | 11.3% | 3.24 |
| PIO | 13,557 | 1.4655 | -0.0311 [-0.0355, -0.0268] | +0.95 [+0.46, +1.48] | 13.4% | 4.24 |
| Powered Cube | 13,480 | 1.5672 | -0.0229 [-0.0267, -0.0191] | +0.53 [-0.04, +1.08] | 16.3% | 5.33 |
| SIR | 13,910 | 1.3949 | -0.0064 [-0.0083, -0.0046] | +0.18 [-0.11, +0.47] | 5.0% | 1.40 |
| SNC | 50,914 | 1.2002 | 0.0065 [0.0050, 0.0080] | -0.16 [-0.37, +0.05] | 8.0% | 2.43 |
| SOS | 43,053 | 1.2435 | -0.0225 [-0.0248, -0.0203] | +1.29 [+0.97, +1.61] | 14.3% | 3.97 |
| TDM | 33,264 | 1.2688 | 0.0092 [0.0073, 0.0110] | -0.10 [-0.39, +0.20] | 10.3% | 3.12 |
| TLA | 41,570 | 1.2409 | -0.0263 [-0.0283, -0.0242] | +0.83 [+0.56, +1.09] | 11.6% | 3.77 |
| TMT | 7,790 | 1.1939 | -0.0031 [-0.0086, 0.0027] | -0.42 [-1.21, +0.32] | 15.7% | 5.07 |
| WOE | 64,027 | 1.2055 | -0.0226 [-0.0240, -0.0214] | +0.94 [+0.74, +1.15] | 9.4% | 2.75 |

Display calibration, fitted on the validation calibration partition only (228,598 decisions): the best exponent is 1.5 for v5 and 1.5 for v6, against the 1.75 that `-colour-stage-` corpora use. v6 does not change that comparison, and points never depend on the exponent.

### Interpretation

- v6 predicts strong players' served picks better overall and in 26 of 30 environments. This is the quantity Pack One's partial credit is defined from; it is not a measurement of contextual fairness.
- The three worse sets, SNC, TDM and KTK, are all formats built around three-colour factions. A plausible but unverified explanation is that counting splash colours there makes too many cards look multicoloured. The owner chose one uniform model regardless.
- Points move: the model leader changes on 3.7–16.3% of served decisions by set, and mean model-only points move by 1.18–5.33. A v6 release needs a new corpus version; existing puzzles keep their stored scores.
