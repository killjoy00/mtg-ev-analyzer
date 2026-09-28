# Contextual Value v1 — frozen R-LCB independent confirmation result

Date: 2026-09-28  
Issue: #529  
PR: #674  
Branch: `research/contextual-value-v1-h-freeze-audit-529`

## Status

This is the result of the separately authorized independent confirmation of the exact frozen R-LCB policy.

It does **not** change or reinterpret the historical development result. The earlier development study remains:

- run `36447316564`, artifact `10981088306`;
- cap-20 DR R-LCB minus A: **+0.047798 wins**;
- CI95: **[-0.006084, +0.103488]**;
- frozen advancement gate was not met;
- formal historical conclusion: **R did not advance**.

No R coefficient, covariance, feature, scale, support rule, fallback, tie-break or `c=2.49` was refit for this confirmation.

Production remains unchanged. No merge or deploy is authorized by this result.

## Frozen transfer boundary

Outcome-free transfer freeze run **36475098718** completed successfully for FIN, TDM and DFT, including the aggregate invariant check.

Aggregate transfer-freeze artifact:

- artifact `10996764141`;
- digest `sha256:d7d7d86f09ee214150219b5552e3df4b8c97bce51702d7891e4a6037f038b3e4`.

All three frozen contexts:

- used exactly 15,000 previously unused confirmation drafts per environment;
- reproduced the retained development R actions exactly before transfer;
- froze R/A actions, behavior probabilities and Q predictions before confirmation outcomes were joined;
- preserved the exact R-LCB `c=2.49` policy and both-action primary support rule;
- used only previously authorized prior-training IDs for environment nuisance fits.

## Final confirmation execution

The R job inside run **36475283530** completed successfully.

Final artifact:

- `10997250713` — `contextual-value-v1-r-independent-confirmation-45k-final`;
- artifact digest: `sha256:e3dc1385819f2c33eb8088bda4813fcbf3abfc0250bb43a96d29bd1525006b4c`.

Frozen sample:

- FIN: 15,000 drafts;
- TDM: 15,000 drafts;
- DFT: 15,000 drafts;
- total: **45,000 drafts**;
- environment weight: exactly one-third each.

Primary estimand and weighting remained exactly preregistered: average one-step R-LCB versus A effect over available P1P1-P1P8 decisions, equal total weight per draft, followed by natural downstream drafting/play.

## Primary result

Primary paired cap-20 DR:

**+0.000680 wins**

Environment-stratified 10,000-draw paired draft bootstrap CI95:

**[-0.005418, +0.006931]**

Therefore:

- the preregistered statistical-success criterion, CI95 strictly above zero, is **not met**;
- the entire CI is below the predeclared +0.03 practical/planning effect, so the study **excludes a +0.03 average benefit** for this frozen three-environment mixture;
- the point estimate is practically near zero.

The primary classification is:

`interval_excludes_+0.03_benefit`.

This is not a claim of literal zero effect; it is a tightly estimated near-zero average result for this exact frozen policy, estimator and FIN/TDM/DFT mixture.

## Alternative evaluator

The sole frozen alternative behavior evaluator used the exact same R/A actions.

Cap-20 DR:

**+0.001029 wins**

CI95:

**[-0.005087, +0.007205]**

The primary and alternative conclusions agree. The result is **not evaluator-sensitive** under the preregistered criterion.

## Estimator diagnostics

Primary R minus A:

| estimator | cap 10 | cap 20 | cap 50 |
|---|---:|---:|---:|
| DR | +0.000929 | +0.000680 | +0.000680 |
| direct | +0.002057 | +0.002057 | +0.002057 |
| residual correction | -0.001128 | -0.001377 | -0.001377 |
| SNIPS | -0.003434 | -0.004153 | -0.004167 |
| IPW | +0.088147 | +0.095908 | +0.095908 |

Alternative-behavior DR is similarly stable across caps: +0.001236 / +0.001029 / +0.001104.

The large raw-IPW estimate is not used to override the preregistered paired DR result. Its disagreement with DR/SNIPS is retained as an evaluator diagnostic rather than selected post hoc.

## Environment slices

Primary cap-20 DR:

- FIN: **+0.000930**
- TDM: **+0.010348**
- DFT: **-0.009237**

No environment-level pattern supports a broadly positive transfer effect.

Leave-one-environment-out primary cap-20 DR:

- omit DFT: **+0.005639**
- omit FIN: **+0.000556**
- omit TDM: **-0.004154**

The aggregate conclusion is not driven by a single environment.

## Support and calibration

On actual primary R overrides, the frozen primary support rule held exactly:

- FIN: 6,841 override decisions, 5.70%; both R and A propensity >= .05 on **100%**;
- TDM: 8,569 overrides, 7.14%; both >= .05 on **100%**;
- DFT: 5,924 overrides, 4.95%; both >= .05 on **100%**.

Primary cap-20 target-weight normalization for R:

- FIN: **1.1672**
- TDM: **1.1368**
- DFT: **1.0818**

For A:

- FIN: **1.1202**
- TDM: **1.1083**
- DFT: **1.0531**

These are materially closer to one than the earlier development warning values, but still show some residual miscalibration. The alternative evaluator leaves the result effectively unchanged and preserves >99% both-action support on overrides in every environment.

## Hidden-confounding sensitivity

Equal-environment primary DR outer bounds:

| Gamma | lower | upper |
|---:|---:|---:|
| 1.00 | +0.000680 | +0.000680 |
| 1.10 | -0.016266 | +0.017630 |
| 1.22352 | -0.035128 | +0.036500 |
| 1.25 | -0.038930 | +0.040308 |
| 1.50 | -0.071820 | +0.073072 |
| 2.00 | -0.126258 | +0.127493 |
| 3.00 | -0.210397 | +0.211284 |
| 5.00 | -0.325185 | +0.326641 |

These are sensitivity bounds, not confidence intervals. `Gamma=1.22352` remains only the preregistered recorded-skill scale reference, not an estimate of actual hidden confounding.

Because the primary estimate is already near zero with a narrow sampling interval, the hidden-confounding analysis does not rescue a +0.03 practical benefit.

## Final interpretation

The independently reserved 45,000-draft confirmation does **not** reproduce the positive magnitude seen in R development.

For this exact frozen R-LCB policy:

- average one-step improvement versus A is estimated near zero;
- the 95% interval includes zero;
- the interval excludes +0.03 wins;
- the primary and alternative evaluators agree;
- cap sensitivity is negligible for DR;
- per-environment and leave-one-environment-out results do not reveal a hidden broadly positive effect.

The original development verdict remains unchanged: **R did not advance**.

Do not retune R, reinterpret the old result as a pass, or promote R from this confirmation. A remains the incumbent comparator for this research program.

This remains observational OPE evidence and does not prove individual card-ranking optimality or whole-draft policy value.
