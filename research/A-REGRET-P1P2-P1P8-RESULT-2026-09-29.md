# Issue #756 — P1P2–P1P8 recentered-instrument A-regret result

**Date:** 2026-09-29 PT  
**Original initial later-pick run:** [36587913521](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36587913521)  
**Original MSH/SOS recovery run:** [36602844254](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36602844254)  
**Original aggregate run:** [36604499634](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36604499634)  
**Original aggregate artifact:** `11050628262`  
**Original aggregate digest:** `sha256:53ed7445e3e24ffeae343925cce7bd24ebf101cfbbbac80376d6ce978d3d8321`  
**Null-calibration run:** [36609131738](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36609131738)  
**Null-calibration aggregate artifact:** `11053676156`  
**Null-calibration aggregate digest:** `sha256:16f824c12d0790887fe6b7239aa50c68caa3f74bef39f4020c73c1afd7d69211`  
**Production impact:** none

> **CORRECTION / SUPERSEDING INTERPRETATION**
>
> The original later-pick statistic, like the P1P1 statistic, selects the largest fitted candidate value and measures its gap to A using that same fitted value vector. Synthetic calibration confirms that this selected-maximum statistic can be very large when true regret is exactly zero.
>
> The predeclared later-pick decision rule does **not** label the observed 0.2290850 statistic "uninformative," because it lies *below*, not inside, the pure-noise replicate range. That narrow rule result is retained.
>
> However, the original 0.2290850 must **not** be interpreted as an estimate of true A regret, a statistically significant remaining value gap, or proof that A is systematically making materially improvable choices. The original bootstrap CI conditions on the fitted coefficients and excludes coefficient-estimation / best-card-selection uncertainty.

## Original frozen design

The secondary P1P2–P1P8 extension used:

- environments FIN, TDM, DFT, MSH, SOS;
- exact #529 prior-use exclusions;
- P1P2–P1P8 only;
- the same frozen research A;
- 5 deterministic source-draft folds;
- passed-pack offer instruments recentered on pre-pick pool state H;
- frozen support floors and ridge penalties;
- frozen rank / first-stage / recentering gates;
- candidate value `V(c,H) = beta_c + gamma * s_A(c,H)`;
- regret `max(0, V_best - V_A)`, where `V_best` is selected from the same fitted values used to measure the gap.

All 35 environment × pick cells passed the frozen outcome-free identification/recentering gates.

The original analysis was explicitly secondary because the same draft-level real outcomes had already been opened by the P1P1 analysis.

## Original selected-maximum result, retained for provenance

Across **3,183,118** eligible P1P2–P1P8 decisions, the original selected-maximum statistic was:

**0.2290850 wins / decision**

The original 10,000-draw environment-stratified source-draft bootstrap CI95 was:

**[0.2288306, 0.2293455]**

That interval resampled draft-level realized regret values while holding the fitted IV coefficients fixed. It therefore **does not include coefficient-estimation uncertainty or uncertainty from selecting the maximum fitted candidate value**.

Original by-environment values:

| Set | Eligible decisions | Original selected-max statistic |
|---|---:|---:|
| FIN | 766,420 | 0.21675 |
| TDM | 496,221 | 0.24258 |
| DFT | 790,529 | 0.22158 |
| MSH | 415,050 | 0.24435 |
| SOS | 714,898 | 0.23238 |

Original by-pick values:

| Pick | Eligible decisions | Original selected-max statistic |
|---|---:|---:|
| P1P2 | 457,427 | 0.25057 |
| P1P3 | 454,039 | 0.22150 |
| P1P4 | 452,462 | 0.22067 |
| P1P5 | 455,702 | 0.23191 |
| P1P6 | 455,684 | 0.25150 |
| P1P7 | 454,861 | 0.21247 |
| P1P8 | 452,943 | 0.21470 |

These values remain useful as provenance for the original computation, but they are **not calibrated estimates of true policy regret**.

## Later-pick null calibration

The follow-up used the frozen #756 later-pick code path and cohorts with one change only: the outcome source was synthetic.

No `event_match_wins` value was read by the calibration. The aggregate explicitly records:

`outcome_columns_read: []`

Scenario:

`Y = N(0, 2.18^2)`

with one synthetic outcome draw per source draft, so **true regret is exactly zero**.

The requested minimum was 10 replicates; the run used **12**.

Research-A card, probability, and margin reconstruction was checked against all retained original scored rows. Maximum absolute probability and margin differences were 0 in every environment.

### Pure-noise scenario

| True regret | Mean #756 statistic | SD | 2.5–97.5% replicate range | A / recentered-IV-best disagreement |
|---:|---:|---:|---:|---:|
| 0.00000 | **0.331658** | 0.006600 | **[0.321684, 0.342061]** | **88.67%** |

The original observed later-pick statistic was **0.2290850**.

### Frozen decision rule

The later-pick rule was:

> If 0.2290850 falls inside the 2.5–97.5% pure-noise range, record the later-pick result as uninformative about A's regret.

It does **not** fall inside [0.321684, 0.342061].

Therefore the frozen decision-rule result is:

> **later null calibration did not trigger the predeclared "uninformative" rule.**

This is a statement about that specific decision rule only. It does **not** rescue the original statistic as a valid true-regret estimator. The calibration still demonstrates that the estimator has a large positive selected-maximum baseline under zero true regret.

## A-margin slices under pure noise

The same qualitative margin pattern is present when true regret is exactly zero:

| A top-two margin | Mean selected-max statistic under pure noise |
|---|---:|
| <= .02 | 0.33840 |
| .02–.05 | 0.33544 |
| .05–.10 | 0.33216 |
| > .10 | 0.32559 |

Thus the original later-pick claim that the close-call pattern itself demonstrated residual improvement opportunity is **withdrawn**.

## By-pick null baseline

Pure-noise mean selected-max statistic by raw later-pick index:

| Display pick | Mean under true regret = 0 |
|---|---:|
| P1P2 | 0.31338 |
| P1P3 | 0.32621 |
| P1P4 | 0.33828 |
| P1P5 | 0.34318 |
| P1P6 | 0.34504 |
| P1P7 | 0.33788 |
| P1P8 | 0.31766 |

Every pick position therefore shows a substantial positive statistic under a zero-regret data-generating process.

## Corrected combined interpretation of #756

The P1P1 correction is decisive for the original primary gate:

- observed P1P1 statistic: **0.1552391**;
- when A is exactly optimal at tau=.10, the same frozen estimator produced **[0.126159, 0.158438]** across synthetic replicates;
- therefore the frozen P1P1 decision rule classifies the original result as **uninformative about A's true regret**;
- the P1P1 design could not have passed the 0.02 optimal-enough gate even with a perfect A.

Accordingly, the statement:

> **A was not demonstrated optimal-enough**

is retained as the literal outcome of the preregistered gate, but that failure is **not evidence that A is materially suboptimal**, because the primary test was not calibrated to pass a perfect A.

For later picks, the specified pure-noise decision rule did not trigger because the observed selected-max statistic is below the null range. Even so, the null calibration shows that the statistic has a large nonzero baseline and the original CI omits coefficient / selection uncertainty.

The following former conclusions are therefore **withdrawn**:

- that #756 showed A is systematically making materially improvable choices;
- that 0.1552 or 0.2291 measured a "remaining value gap";
- that the "statistically supported" action set implied statistically significant card advantages;
- that the close-call / disagreement patterns themselves demonstrated genuine residual opportunity.

In the #756 protocols, **supported** meant only that an action passed predeclared appearance / take-rate support thresholds. It did **not** mean its fitted advantage over A was statistically significant.

## What #756 does and does not establish

#756 establishes that the original optimal-enough gate was not passed.

After null calibration, #756 does **not** establish:

- the magnitude of A's true regret;
- that A is materially worse than an attainable alternative policy;
- that the original IV-best actions are better than A;
- that a production challenger should be developed from the selected-max results.

A prospective randomized recommendation experiment, or another design with policy selection separated from evaluation and adequate power, remains the appropriate direct test.

No model-development issue should be opened on the basis of #756.

## Production boundary

No production scoring, corpus, puzzle, database, or deployment change is authorized or made by this correction.
