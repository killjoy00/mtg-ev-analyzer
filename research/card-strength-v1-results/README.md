# Card strength benchmark v1 — results

Run date: October 25, 2026. Public 17Lands data only.

**Carry forward Model C, adjusted outcome strength, as the development candidate.** It is the empirical leader and the operational recommendation under the frozen one-standard-error rule. It clearly improves on the no-strength baseline and beats IWD. Its advantage over smoothed GIH is **not statistically conclusive** under the preregistered multiple-comparison rule; there is no demonstrated winner over both alternatives.

For new sets, the important qualification is that **A narrowly leads at 500 training drafts**. C leads at 2,000 drafts and in the full-training condition. Do not treat 2,000 as a validated deployment switch or automatically use C on day one.

## Results

Primary score: held-out game log loss, averaged within draft, then equally across six sets and three training budgets. Lower is better. These differences are predictive accuracy, not an increase in actual game win rate.

| Candidate | Overall log loss | Brier score |
|---|---:|---:|
| No-strength baseline | 0.6683087 | 0.2381166 |
| A: smoothed GIH | 0.6674571 | 0.2376987 |
| B: smoothed IWD | 0.6682793 | 0.2381021 |
| C: adjusted outcome | 0.6667689 | 0.2373722 |

| Training drafts per set | Baseline | A: GIH | B: IWD | C: adjusted |
|---|---:|---:|---:|---:|
| 500 | 0.6683741 | 0.6680855 | 0.6683450 | 0.6681599 |
| 2000 | 0.6682802 | 0.6676176 | 0.6681487 | 0.6672695 |
| Full fitting partition | 0.6682717 | 0.6666683 | 0.6683441 | 0.6648772 |

| Set, averaged across budgets | Baseline | A: GIH | B: IWD | C: adjusted |
|---|---:|---:|---:|---:|
| FRA | 0.6634077 | 0.6624825 | 0.6624760 | 0.6614475 |
| HOB | 0.6667512 | 0.6655601 | 0.6680174 | 0.6649862 |
| MSH | 0.6696832 | 0.6689552 | 0.6696330 | 0.6702108 |
| SOS | 0.6704255 | 0.6705794 | 0.6711116 | 0.6688228 |
| BLB | 0.6672509 | 0.6661774 | 0.6664618 | 0.6653193 |
| ECL | 0.6723334 | 0.6709883 | 0.6719757 | 0.6698268 |

C leads among candidates in five of six sets. MSH is the exception: C is worse than the baseline on the budget-averaged score, and its full-training log loss is 0.6720767 versus baseline 0.6695842. More data does not guarantee better transfer to the later metagame. This requires investigation on new validation data before a hard puzzle filter is considered.

## Uncertainty and secondary checks

The 2,000 paired hierarchical bootstrap replicates resample sets and source drafts, keeping model and budget comparisons paired. Candidate comparisons use 98.333% intervals (three-comparison Bonferroni adjustment).

| Difference, lower favors left candidate | Estimate | Interval |
|---|---:|---|
| A: smoothed GIH minus B: smoothed IWD | -0.0008221 | [-0.0017964, -0.0001923] |
| A: smoothed GIH minus C: adjusted outcome | 0.0006882 | [-0.0003797, 0.0014366] |
| B: smoothed IWD minus C: adjusted outcome | 0.0015104 | [0.0002543, 0.0025974] |

C minus baseline: -0.0015398, 95% interval [-0.0021709, -0.0006569].

Adding opening-hand strength relative to deck strength gives secondary log losses of A: smoothed GIH 0.6664893, B: smoothed IWD 0.6676656, C: adjusted outcome 0.6660253. This does not replace the primary decision rule.

A post-assessment diagnostic reconstructed the C strength coefficient from each frozen prediction vector. All 18 coefficients are positive, so the evaluation is not rewarding an inverted strength scale. Maximum reconstruction error was below 3e-11 in log-odds. This diagnostic did not select or tune the models.

## Data and safeguards

The archives contain 3,049,302 games; 3,049,301 valid games from 545,085 source drafts remain after parsing. One malformed ECL row was excluded; there were no duplicate game-key exclusions. The final test contains 598,152 games from 109,020 drafts. 10,405 drafts crossing chronological boundaries were purged.

- Each source draft belongs to one chronological partition only. The earliest 60% fit strengths, the next 20% supply calibration data, and the last 20% are held out, with boundary purging.
- For each target set, calibration uses only the other five sets. Neither target-set validation nor target-set assessment labels can affect its predictions.
- The three models use the same shared evaluation controls. Drawn/tutored counts and game duration never enter evaluation predictors.
- All 18 prediction files were frozen and hashed before opening the assessment. Source archive, protocol, and code hashes are in `provenance.json`.
- Unseen cards are explicitly neutral. At the 500-draft budget, their mean test-deck copy fractions range from 0.0096% to 0.1247%. Seen does not imply precisely estimated; per-card support counts must still be respected.
- No Pack One choices, player accounts, trophy matches, or scores were used. No production scoring, selection, or leaderboard code changed.

## Interpretation for Pack One

Use C as the candidate independent strength feature in the next offline puzzle-quality comparison, and keep A as the simple early-data comparator. Reject B as the default strength estimator for this purpose. Do not blend A/C, tune a switch threshold, or tune strength cutoffs against this assessment set.

Next, test whether packs contain at least two contextually viable, meaningfully strong alternatives before rewarding a close predicted choice split. Keep pool fit and predicted debate separate from strength. Historical Pack One decisions may train or validate that general selection model, but its serving inputs must remain available for puzzles with zero Pack One responses.

This benchmark does not prove which card causally wins a game, which card should be drafted, or which puzzle players enjoy. It uses observed completed decks and cannot identify the counterfactual value of an unchosen card. It has no card-text fallback for zero 17Lands evidence and no claim about Cube or Traditional Draft. The 500-draft regime measures evidence volume, not data publication latency or a release-day guarantee.

Calibration transfer is retrospective leave-one-set-out, not a simulation that restricts every other set to calendar-time availability at the target release. Intervals are conditional on the fitted models and these six sets; they do not refit strength tables inside each bootstrap or cluster repeated players across drafts. Exported player skill buckets are imperfect controls. Deck archetype, play skill, and card interactions can still confound every estimator. Per-card uncertainty intervals and context-specific strength remain follow-up work.

## Reproduce and inspect

From the repository root:

```sh
python3 -m venv .venv-strength
. .venv-strength/bin/activate
python -m pip install -r research/card-strength-requirements.txt
python -m unittest discover -s tests -p test_card_strength_benchmark.py -v
python -m unittest discover -s tests -p test_card_outcomes.py -v
python scripts/card_strength_benchmark.py download
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 python scripts/card_strength_benchmark.py run --final-test
```

Use `run` without `--final-test` to fit models and freeze predictions without reporting assessment results. All raw data and working arrays go to ignored `raw-data/` and `artifacts/` directories. Existing sources are accepted only when their hashes match; if an upstream archive changes, a new download is a new dataset and must not be described as reproducing these exact results.

`report.json` contains every set/budget metric. `provenance.json` contains public source hashes, exclusions, sample sizes, and prediction hashes. `diagnostics.json` records the post-assessment sign check. The `strengths-SET.csv` snapshots contain all three methods fitted on the original fitting partition, with support counts; they were not refitted on validation/test data and are research snapshots, not production policy. Raw A is centered GIH; add the training baseline in `strength-table-manifest.json` to recover the smoothed GIH win rate. `_z` columns are format-relative standardized scores, not win probabilities.

Validation: 9 benchmark tests and 14 existing outcome tests pass locally and in the dedicated GitHub job. Tests cover overlap/purging, invalid outcomes, corrupted-cache recovery, target-label leakage, consistency with existing GIH/IWD, absolute strong-versus-weak comparisons, paired uncertainty, and avoiding a forced superiority claim.

Execution note: an initial attempt stopped before assessment because two saved array caches were incomplete. Atomic checked serialization and cache recovery were added, along with independent draft resampling when a bootstrap chooses the same set twice. Those corrections were committed before the first completed assessment; no candidate or hyperparameter was changed after seeing test results.

## Attribution

Source: [17Lands public datasets](https://www.17lands.com/public_datasets), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Derived estimates and aggregate evaluation by Pack One. See also [17Lands on interpreting win-rate data](https://blog.17lands.com/posts/using-win-rate-data/) for contextual and observational limitations.

Protocol SHA-256: `0f9966f4812bc0cf4cf94275785f5f9d67538c9f42a561407d22f8fdb372809a`.
Benchmark code SHA-256: `2d9bb1219bee4a35b5ef46544637ff59279d1a4d3eaa3050383ca2d84ebc408a`.
