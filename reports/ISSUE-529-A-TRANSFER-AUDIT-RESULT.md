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

The frozen alternative behavior evaluator agrees: deployed A - research A = **-0.009463** (95% CI **[-0.022509, +0.003796]**) and R-LCB - deployed A = **+0.010492** (95% CI **[-0.003385, +0.023748]**). Both primary and alternative comparisons remain in the same `interval_excludes_+0.03_benefit` classification as the historical R-LCB - research-A result. The prespecified hidden-confounding sensitivity grid was also reported; at the recorded-skill reference Gamma=1.22352, both new contrasts' conservative DR outer bounds include zero.

## Final verdict

**does not transfer.** Exact deployed A reproduced across all eight sets, but the frozen >=95% P1P1-P1P8 top-1 agreement gate failed in every set on the research-decision population (and likewise on served v8). Step 4 was run exactly once on the precommitted spent-45k cohort to determine whether substituting literal deployed A for research A changes the #529 value interpretation; that diagnostic is reported above. This audit authorizes **no production change**.
