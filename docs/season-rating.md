# Season performance rating

Season boards use every eligible first-attempt Daily score in the current season
and scoring corpus. One completed Daily is enough to appear. Unplayed days do
not contribute scores or observations. Today and weekly best-3 scoring remain
unchanged; legacy `month` and `all` requests still resolve to the season.

For score sum S, completed days n, and raw average A = S/n:

```
adjusted = min(A, (S + m * B) / (n + m))
rating = max(0, adjusted - c * sigma / sqrt(n + m))
```

| Environment | Baseline B | Prior weight m | Variability sigma | Multiplier c |
| --- | ---: | ---: | ---: | ---: |
| Draft Run (mixed) | 70 | 5 | 15 | 1.645 |
| Powered Cube | 80 | 5 | 8 | 1.645 |
| Latest Set | 80 | 5 | 8 | 1.645 |

These are initial ranking policy settings, not a claim that the rating is a
calibrated 95% confidence bound or an exact Bayesian posterior quantile. The
cap deliberately prevents the baseline from lifting a weak observed average.
The deduction still uses n + m below the baseline, so m is a policy weight,
not five observed games. The rating measures conservative demonstrated
performance, not predicted next-game score.

The pure calculation and immutable policy live in `worker/season-rating.mjs`.
Policies are selected by the persisted season start date, not today's date or
how long the season is expected to last. Future tuning must add a new version
effective at a future season boundary; do not edit an existing version. A model
change needs explicit review of corpus eligibility and rating policy together.
This rollout intentionally replaces the current season's best-10 formula; it
does not modify stored scores or season boundaries and needs no schema migration.

## Behavior and limits

- More days at the same average cannot lower the rating. A higher average at
  the same number of days cannot lower it. These comparisons apply within one
  environment and policy, not across environments.
- A poor additional result can lower a rating. Scores after the tenth day
  continue to count; no cherry-picked best-10 subset remains.
- A low-volume exceptional player can eventually outrank a more experienced
  player. The objective is to discount sparse evidence, not impose a hidden
  minimum or guarantee attendance always wins.
- Missing a day leaves a player's own rating unchanged. Players can stop while
  ahead. The formula does not claim to remove optional stopping, account abuse,
  unequal day difficulty, or correlation between repeated scores.
- Six-, eight-, and twelve-week seasons use the same formula. More observed
  days reduce the deduction; calendar duration alone does not. Scores across
  seasons or environments are not necessarily comparable.
- The settings need prospective validation as independent player histories
  accumulate. Do not fit five policy parameters to a small initial sample.
  Check ranking stability and accidental one-result leaders across 6/8/12-week
  windows; assess predictive error on a separate point estimate. Report a
  conservative rating's intentional downward bias separately from prediction.

Run `node scripts/compare-season-ratings.mjs` for reproducible synthetic examples
comparing m=2/5/10, the uncapped formula, and `A - c*sigma/sqrt(n)`. Changing m affects both baseline shrinkage and the deduction, so its net effect
is not uniformly more or less conservative. Below the baseline, higher m always
reduces the deduction. Keep m=5 provisionally; these examples do not establish
an empirically optimal value.

## API and display

Season responses carry `scoring` (version and parameters). Rows include
`rating` at full precision, `average_score` rounded to one decimal, and `days`.
Ranks and ordering use the full rating. Exact ties share a rank; ratings that
merely round to the same displayed tenth can have different ranks. The existing
`score` field remains the rounded ranking value for older clients.

Profile season standings use the same query and policy. They expose `rating`,
`average_score`, `days`, and `scoring`; the historical `average` field remains
the rounded ranking value for compatibility. Web and new native clients label
rating and raw average separately. New clients fall back to the old presentation
when an older backend supplies no rating metadata. Older native builds receive
the new ranking through their existing score fields; updated labels require a
new native build.

Validation covers monotonicity, one-day inclusion, the cap, all-score inclusion,
short/long seasons, full-precision SQL ranks, exact ties, profile parity, legacy
aliases, unchanged daily/weekly scores, and mobile/web presentation. SQL fixture
tests must only run on the existing disposable backend-gate databases.
