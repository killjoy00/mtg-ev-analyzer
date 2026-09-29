# Issue #756 — P1P1 randomized-offer A-regret result

**Date:** 2026-09-29 PT  
**Run:** 36583791463  
**Frozen workflow commit:** `d121aa4b63f738ea039e15a21f839d97cbafb427`  
**Production impact:** none

## Decision rule

The preregistered product-materiality ceiling was **0.02 event match wins per decision**.

A could be called optimal-enough at P1P1 only if the upper 95% confidence endpoint for average regret was below 0.02.

## Prior-use boundary

EOE was excluded because #529 already consumed its 91,377 previously untouched P1P1 outcomes.

The final five-set #756 supply excluded all retained #529 prior-use IDs, including:
- FIN/TDM/DFT original 13k boundaries plus their later exact 15k R-confirmation reserves;
- MSH pooled-core IDs plus 1,146 additional early-exploratory IDs recovered from the retained spent-draft ledger;
- SOS pooled-core IDs.

Unused P1P1 rows:
- FIN 112,237
- TDM 73,323
- DFT 115,504
- MSH 66,003
- SOS 105,197

All exact archive hashes matched.

## Identification

Every environment passed every frozen outcome-free identification gate in all five draft folds:
- supported-card floor;
- instrument rank fraction;
- median own-card first stage;
- p10 own-card first stage.

No environment was dropped or replaced.

## Primary result

Supported held-out decisions: **448,218**

Average regret of research A relative to the best statistically supported offered card in the frozen randomized-offer IV projection:

**0.1552391 wins / decision**

10,000-draw environment-stratified held-row bootstrap CI95:

**[0.1546613, 0.1558308]**

This is far above the frozen 0.02 ceiling.

The row-bootstrap upper endpoint is already above 0.02, so the preregistered gate cannot pass even before adding model-refit uncertainty. The 200-refit bootstrap is therefore not required for a no-pass verdict.

### By environment

| Set | Eligible decisions | Coverage | Mean regret | Bootstrap CI95 |
|---|---:|---:|---:|---:|
| FIN | 106,734 | 95.10% | 0.16059 | [0.15937, 0.16183] |
| TDM | 69,767 | 95.15% | 0.14494 | [0.14338, 0.14653] |
| DFT | 113,298 | 98.09% | 0.14262 | [0.14154, 0.14372] |
| MSH | 61,632 | 93.38% | 0.13764 | [0.13605, 0.13923] |
| SOS | 96,787 | 92.01% | 0.18274 | [0.18147, 0.18402] |

## Close-call audit

Regret is largest where A is least decisive, but it does not disappear when A is confident.

| A top-two probability margin | n | Mean regret | Share regret > .02 |
|---|---:|---:|---:|
| <= .02 | 80,529 | 0.1931 | 63.65% |
| .02–.05 | 93,600 | 0.1851 | 62.43% |
| .05–.10 | 94,927 | 0.1636 | 58.72% |
| > .10 | 179,162 | 0.1182 | 46.90% |

Additional slices:
- A vs IV-best disagreement: n=260,740, mean regret **0.2669**.
- A vs historical drafter disagreement: n=190,088, mean regret **0.1922**.
- A vs both IV-best and historical drafter: n=125,178, mean regret **0.2919**.

Therefore residual opportunity is concentrated in close/disagreement decisions but is not confined to them.

## Interpretation boundary

This result does **not** identify literal omniscient drafting.

It measures regret relative to the best statistically supported action in the frozen card-action IV projection using randomized collated P1P1 offer variation. Card presence also changes the rest of the pack, downstream passed-card information, and possible P1P9 returns, so the exclusion restriction remains approximate.

Within that frozen design, however, the answer to the product question is unambiguous:

> **A is not demonstrated to be optimal-enough at P1P1 at a 0.02 wins/decision materiality threshold.**

The next registered stage is the secondary P1P2–P1P8 recentered-instrument extension.
