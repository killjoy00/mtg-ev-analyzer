# Issue #756 — P1P1 randomized-offer A-regret result

**Date:** 2026-09-29 PT  
**Original run:** [36583791463](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36583791463)  
**Frozen original workflow commit:** `d121aa4b63f738ea039e15a21f839d97cbafb427`  
**Null-calibration run:** [36608962626](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36608962626)  
**Null-calibration aggregate artifact:** `11053481639`  
**Null-calibration aggregate digest:** `sha256:559bbb01af6a2c2f01962414fda3868b9a087a6cf3c5c9db6b48628cc69f5e50`  
**Per-scenario row-bootstrap supplement:** [36611484019](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36611484019), artifact `11053419212`  
**Production impact:** none

> **CORRECTION / SUPERSEDING INTERPRETATION**
>
> The original #756 P1P1 statistic is **not informative about A's true regret**. A synthetic-outcome null calibration using the exact frozen #756 cohorts, A decisions, folds, support rules, first stage, second stage, penalties, and regret definition shows that the estimator reports large positive "regret" even when A's true regret is exactly zero.
>
> The retained conclusion is only: **A was not demonstrated optimal-enough by #756.**  
> #756 also did **not** demonstrate that A is materially suboptimal, that A is systematically making materially improvable choices, or that a statistically significant remaining value gap exists.

## Why the original interpretation was wrong

#756 defined per-row regret as:

`max(0, V_best - V_A)`

where `V_best` was the offered card with the largest value from the **same fitted coefficient vector** used to measure `V_best - V_A`.

Cross-fitting kept a held-out draft's own outcome out of its coefficient fit, but it did **not** separate:

1. selecting the largest noisy fitted value, from
2. evaluating the selected card with that same noisy fitted value.

The maximum therefore captures the largest favorable estimation error among the offered cards. Truncation at zero makes the statistic positive by construction. The original held-row bootstrap resampled the resulting regret rows while holding fitted coefficients fixed, so its narrow CI did **not** include coefficient-estimation or best-card-selection uncertainty.

This is exactly the failure mode tested by the synthetic calibration below.

## Hard calibration boundary

The correction run never read `event_match_wins`.

Research A was reconstructed without indexing any draft outcome column; for the P1P1 calibration no game outcome data were needed. Reconstructed A card, probability, and margin were validated exactly against every retained #756 scored row before the synthetic results were accepted.

The authoritative pre-result calibration protocol was frozen at commit `a41ed7774a42cc17a7d6ec35a2e2cb7261596034` in:

`research/A-REGRET-NULL-CALIBRATION-PROTOCOL-2026-09-29.md`

## Frozen original cohort

The same five unused #756 P1P1 cohorts were used:

| Set | Unused P1P1 rows |
|---|---:|
| FIN | 112,237 |
| TDM | 73,323 |
| DFT | 115,504 |
| MSH | 66,003 |
| SOS | 105,197 |

The same prior-use exclusions, deterministic five-fold salt `a-regret-v1:<draft_id>`, A definition, support thresholds, first-stage gate, and lambda=10 were retained.

Each calibration scenario used **30 synthetic replicates**, with:

`Y = v[historical pick] + N(0, 2.18^2)`

on the real #756 packs and historical picks.

## Null calibration results

Original #756 statistic: **0.1552391 wins/decision**.

| Scenario | Exact true regret | Mean estimated #756 statistic | SD | 2.5–97.5% replicate range | A/IV-best disagree | Replicate-0 row-bootstrap half-width |
|---|---:|---:|---:|---:|---:|---:|
| Pure null, v=0 | 0.00000 | 0.20472 | 0.01261 | [0.18328, 0.22715] | 71.33% | 0.000625 |
| A exactly optimal, tau=.10 | 0.00000 | 0.14220 | 0.00911 | **[0.12616, 0.15844]** | 57.75% | 0.000570 |
| A exactly optimal, tau=.20 | 0.00000 | 0.10096 | 0.00734 | [0.08737, 0.11205] | 44.37% | 0.000546 |
| tau=.10 + card noise s=.05 | 0.01344 | 0.14414 | 0.00852 | [0.13311, 0.16119] | 57.26% | 0.000525 |
| tau=.10 + card noise s=.10 | 0.04572 | 0.15623 | 0.01187 | [0.13228, 0.17504] | 58.44% | 0.000528 |
| tau=.10 + card noise s=.20 | 0.12839 | 0.19837 | 0.01357 | [0.17521, 0.21912] | 59.16% | 0.000729 |

### Fixed decision rule

The calibration decision rule was frozen before simulation:

> If the observed 0.1552391 falls inside the 2.5–97.5% range of the pure null or either exactly-optimal-A scenario, record the original P1P1 result as uninformative about A's regret.

**Triggered.**

0.1552391 lies inside the **A-exactly-optimal tau=.10** range **[0.1261592, 0.1584382]**, where true regret is exactly zero.

Therefore:

> **The original P1P1 #756 statistic is uninformative about A's true regret.**

The pure-zero null actually produces an even larger statistic on average, **0.20472**, despite true regret being exactly zero.

## The original optimal-enough gate was not capable of validating a perfect A

The product gate required the upper 95% endpoint to be below **0.02 wins/decision**.

Yet when A was exactly optimal:

- tau=.10: all of the calibrated replicate range was **0.126–0.158**;
- tau=.20: all of the calibrated replicate range was **0.087–0.112**.

Thus this design would have failed the 0.02 gate even when A's true regret was exactly zero.

The statement **"A was not demonstrated optimal-enough"** remains formally correct, but it is no longer evidence against A: the test itself was not calibrated to pass a perfect A.

## Conditional row-bootstrap CI

The supplement reran the requested 10,000-draw environment-stratified row bootstrap on replicate 0 for **every scenario**. Half-widths are shown in the table above and range only from **0.000525 to 0.000729**, despite the much larger between-replicate estimator variation.

For pure-null replicate 0:

- point estimate: **0.2030506**
- 10,000-draw environment-stratified row-bootstrap CI95: **[0.2024155, 0.2036764]**
- half-width: **0.0006305**

True regret in that replicate is exactly **0**.

This demonstrates why the original narrow bootstrap CI was misleading for the scientific question: it conditions on the fitted values and therefore measures row-sampling variation around a biased selected maximum. It excludes coefficient-estimation and best-card-selection uncertainty.

## A-margin slices under the null

Even the original qualitative "close-call" pattern can arise under zero true regret.

| A top-two margin | Pure-null mean estimated regret | A-optimal tau=.10 mean estimated regret |
|---|---:|---:|
| <= .02 | 0.22473 | 0.18773 |
| .02–.05 | 0.21587 | 0.16585 |
| .05–.10 | 0.20505 | 0.14209 |
| > .10 | 0.18973 | 0.10944 |

Accordingly, the former inference that "residual opportunity is concentrated in close/disagreement decisions but is not confined to them" is **withdrawn**. The same pattern appears when true regret is zero.

## Take-rate audit of the original IV-best disagreements

On all **260,740** retained original P1P1 rows where IV-best != A, using each row's original fold training complement:

| Metric | A card | Original IV-best |
|---|---:|---:|
| Mean take rate when offered | 44.80% | 18.07% |
| Median take rate when offered | 37.38% | 10.71% |

Paired IV-best minus A take-rate difference:

- mean: **-26.73 percentage points**
- median: **-23.55 percentage points**
- IV-best had a **lower** take rate than A on **82.61%** of disagreement rows
- IV-best had a higher take rate on **17.39%**

This does not prove the crowd is correct, but it is consistent with the selected "IV-best" frequently being an unusually noisy low-take action rather than evidence of a robustly superior card.

## Independent-selection design and power

A valid simulation separated policy selection from evaluation:

- one deterministic half chose B using its fitted values;
- the other half evaluated `V(B)-V(A)`;
- halves were swapped;
- only actions supported in both halves were used.

This removes the specific same-fit winner's-curse mechanism under audit.

| Scenario | Exact true B-A gain | Estimated B-A | Bias | Estimator SD | Power for true +.02 |
|---|---:|---:|---:|---:|---:|
| Pure null | 0.00000 | 0.00085 | +0.00085 | 0.01717 | 21.4% |
| A-opt tau=.10 | -0.04877 | -0.05287 | -0.00409 | 0.01354 | 31.5% |
| A-opt tau=.20 | -0.06593 | -0.06706 | -0.00113 | 0.01379 | 30.5% |
| Perturbed s=.05 | -0.04198 | -0.04687 | -0.00489 | 0.01586 | 24.3% |
| Perturbed s=.10 | -0.02164 | -0.03127 | -0.00963 | 0.01486 | 27.0% |
| Perturbed s=.20 | +0.04664 | +0.03275 | -0.01389 | 0.01741 | 20.9% |

**No scenario reaches 80% power to detect a true +0.02 wins/decision gain.**

The split design is much better calibrated around its target than the original max statistic, but this cohort/noise level does not provide adequate power for a +0.02 policy-gain benchmark under the frozen simulation.

## Historical original result, retained for provenance

The original analysis reported:

- supported held-out decisions: **448,218**
- estimated selected-max "regret": **0.1552391**
- conditional held-row bootstrap CI95: **[0.1546613, 0.1558308]**

Those numbers are not deleted. Their former interpretation is superseded.

The original by-environment selected-max estimates were:

| Set | Eligible decisions | Original statistic |
|---|---:|---:|
| FIN | 106,734 | 0.16059 |
| TDM | 69,767 | 0.14494 |
| DFT | 113,298 | 0.14262 |
| MSH | 61,632 | 0.13764 |
| SOS | 96,787 | 0.18274 |

They should now be read as outputs of an uncalibrated selected-maximum statistic, **not estimates of true policy regret**.

## Corrected conclusion

The scientifically supportable conclusion of #756 P1P1 is:

> **A was not demonstrated optimal-enough, because the preregistered test failed its gate. However, the test was itself incapable of passing a perfect A under realistic synthetic outcomes. Therefore #756 P1P1 provides no reliable evidence that A is materially suboptimal or that a meaningful improvement opportunity exists.**

Claims that A is "systematically making materially improvable choices," that the observed 0.155 represented a remaining value gap, or that the "IV-best" actions were statistically significant improvements are **withdrawn**.

In the #756 protocol, "statistically supported action" referred only to the predeclared **action-support eligibility rule** (appearance/take-rate thresholds). It did **not** mean that an action's advantage over A was statistically significant.

No production change and no model-development issue should be based on the original #756 regret estimate.
