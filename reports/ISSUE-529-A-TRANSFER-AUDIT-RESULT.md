# Issue #529 — deployed A vs research A transfer audit — final closeout

Date: 2026-09-29

## Frozen decision rule and identity

- Step-0 decision-rule commit: `84d08a6364015fc7624c5ddbc49934b6918e9b8f`
- Production v8 release commit: `31fef96eb59599a31fe7cb431f128d549030b6ed`
- Authoritative Step-3 run: `36603461542`
- Scope: MSH, SOS, ECL, TLA, EOE, FIN, TDM, DFT; P1P1-P1P8.
- Step 1-3 boundary: scoring only; no outcome field was accessed.

## Exact deployed-A reproduction

All eight sets passed the reproduction gate: exact snapshot/cohort identities matched, every served top pick matched, and maximum absolute stored-probability reproduction error remained below `1e-6`.

| Set | candidate probabilities checked | served decisions checked | max abs probability error | top-pick mismatches |
| --- | ---: | ---: | ---: | ---: |
| MSH | 7,227 | 803 | 5.000e-07 | 0 |
| SOS | 6,336 | 704 | 4.997e-07 | 0 |
| ECL | 4,896 | 612 | 5.000e-07 | 0 |
| TLA | 4,589 | 540 | 5.000e-07 | 0 |
| EOE | 5,865 | 690 | 4.999e-07 | 0 |
| FIN | 5,841 | 649 | 5.000e-07 | 0 |
| TDM | 5,148 | 572 | 4.998e-07 | 0 |
| DFT | 5,940 | 660 | 4.999e-07 | 0 |

## Recommendation agreement

The frozen Step-0 rule required >=95% top-1 agreement in every set. It failed decisively on both the served-v8 distribution and the research-decision populations.

| Set | served-v8 top-1 | served N | combined research-decision top-1 | research N | served disagreement margin p90 (max of two) |
| --- | ---: | ---: | ---: | ---: | ---: |
| MSH | 52.91% | 584 | 55.28% | 4,656 | 0.426327 |
| SOS | 64.45% | 512 | 62.51% | 7,320 | 0.285204 |
| ECL | 50.00% | 476 | 50.70% | 6,083 | 0.309079 |
| TLA | 62.96% | 378 | 57.90% | 5,915 | 0.307958 |
| EOE | 70.65% | 552 | 71.34% | 40,000 | 0.266366 |
| FIN | 73.73% | 472 | 72.46% | 160,000 | 0.236321 |
| TDM | 72.84% | 416 | 70.05% | 160,000 | 0.248103 |
| DFT | 72.71% | 480 | 72.52% | 159,575 | 0.273768 |

The disagreement rates are too large to characterize the difference as a handful of tie-breaks or isolated close calls. Per the frozen rule, this required exactly one Step-4 diagnostic on the already-spent 45k FIN/TDM/DFT cohort.

### Construction caveat: the >=95% agreement gate was not a valid parity test

The authoritative Step-3 run report shows that research A and deployed A were not comparably trained models. In each set, deployed A used the production strong-player cohort cap of **5,000 training drafts**, while the research-A fit used only **100-752 strong training drafts**, depending on set/fold scope (`per_set[*].research_A.fits[*].strong_training_ids` versus `per_set[*].production_cohort.training_drafts` in run 36603461542).

That mismatch is structural rather than a small implementation difference. The frozen >=95% top-1 agreement gate was therefore **unattainable by construction** for this comparison and its failure is **uninformative** about whether the deployed production policy transfers to the research setting. The verdict label below remains `does not transfer` because that is the literal frozen gate result, but the gate failure should not be interpreted as evidence that deployed A is meaningfully different in policy value.

The secondary held-out strong-player prediction diagnostic is more informative about the two fits themselves. On held-out strong-player decisions, deployed A had higher top-1 accuracy and lower log loss in all eight sets:

| Set | decisions | deployed top-1 | research top-1 | deployed log loss | research log loss |
| --- | ---: | ---: | ---: | ---: | ---: |
| MSH | 208 | 55.7692% | 42.3077% | 1.321394 | 1.878619 |
| SOS | 344 | 50.2907% | 43.0233% | 1.392130 | 1.778582 |
| ECL | 266 | 53.7594% | 36.0902% | 1.376563 | 1.819532 |
| TLA | 343 | 53.0612% | 42.8571% | 1.376544 | 1.799127 |
| EOE | 3,480 | 58.9655% | 53.6782% | 1.245956 | 1.446279 |
| FIN | 17,664 | 57.6370% | 53.4477% | 1.328827 | 1.512027 |
| TDM | 10,648 | 54.0195% | 50.1221% | 1.346217 | 1.566353 |
| DFT | 15,671 | 56.6333% | 52.3196% | 1.300644 | 1.508232 |


## Step 4 — spent 45k value diagnostic

- Step-4 run: `36608499362`
- Historical R-LCB minus research-A estimator reproduction: **PASS (primary point exact; bootstrap endpoints reproduced to ~1e-17; alternative point to ~7e-19)**
- Cohort: 45,000 drafts, 15,000 each FIN/TDM/DFT; all available P1P1-P1P8; equal draft and environment weighting.
- Primary estimator: paired draft-weighted cap-20 DR with 10,000-draw environment-stratified paired bootstrap, seed 529.

| Contrast | cap-20 DR wins | 95% CI |
| --- | ---: | --- |
| Deployed A - research A | -0.007920 | [-0.020981, +0.005429] |
| R-LCB - deployed A | +0.008600 | [-0.005029, +0.021874] |
| R-LCB - research A (historical reproduction) | +0.000680 | [-0.005418, +0.006931] |

Step-4 value-classification changed under literal deployed comparator: **NO**.

**This Step-4 value diagnostic is the informative result for the transfer question.** Unlike the structurally mismatched top-1 agreement gate, it directly asks whether substituting literal deployed A for research A changes the already-spent #529 policy-value interpretation. It does not: deployed A - research A is **-0.007920** with CI95 **[-0.020981, +0.005429]**, and R-LCB - deployed A is **+0.008600** with CI95 **[-0.005029, +0.021874]**. This leaves the practical conclusion unchanged: the #529 challenger evidence does not support replacing deployed A.

The frozen alternative behavior evaluator agrees: deployed A - research A = **-0.009463** (95% CI **[-0.022509, +0.003796]**) and R-LCB - deployed A = **+0.010492** (95% CI **[-0.003385, +0.023748]**). Both primary and alternative comparisons remain in the same `interval_excludes_+0.03_benefit` classification as the historical R-LCB - research-A result. The prespecified hidden-confounding sensitivity grid was also reported; at the recorded-skill reference Gamma=1.22352, both new contrasts' conservative DR outer bounds include zero.

## Final verdict

**does not transfer.** This label is retained as the literal frozen gate verdict. However, the >=95% agreement failure is uninformative because research A was trained on only 100-752 strong drafts per set while deployed A used 5,000, making the parity gate unattainable by construction. The informative Step-4 value diagnostic shows that substituting literal deployed A for research A does **not** change the practical #529 conclusion. This audit authorizes **no production change**.
