# Issue #756 — P1P2–P1P8 recentered-instrument A-regret result

**Date:** 2026-09-29 PT  
**Primary P1P1 run:** 36583791463  
**Initial later-pick run:** 36587913521 (FIN/TDM/DFT retained)  
**MSH/SOS recovery run:** 36602844254  
**Final aggregate run:** 36604499634  
**Final aggregate artifact:** 11050628262  
**Artifact digest:** `sha256:53ed7445e3e24ffeae343925cce7bd24ebf101cfbbbac80376d6ce978d3d8321`  
**Production impact:** none

## Status

The secondary P1P2–P1P8 recentered-instrument extension is complete.

All five predeclared environments and all seven later Pack 1 positions passed every frozen identification/recentering gate. No environment or pick was dropped or replaced.

This analysis is explicitly secondary: the same draft-level outcomes were already opened by the completed P1P1 study.

## Frozen design

The protocol remained unchanged after outcomes:

- environments: FIN, TDM, DFT, MSH, SOS;
- exact #529 prior-use exclusions;
- P1P2–P1P8 only;
- research A trained only from frozen prior-training IDs;
- 5 deterministic folds by source draft;
- passed-pack offer instruments recentered on pre-pick pool H;
- frozen support floors and ridge penalties;
- frozen rank / first-stage / held-out recentering gates;
- regret against the highest-valued statistically supported offered card;
- 10,000 environment-stratified source-draft bootstraps;
- 0.02 wins/decision retained only as the previously frozen materiality reference.

## Execution recovery

The first later-pick run produced successful FIN, TDM and DFT artifacts but stopped MSH/SOS before any later-pick value estimate.

Two execution-only defects were corrected without changing the statistical specification:

1. the implementation incorrectly bounded later-pick rows by P1P1 row coverage; MSH has one and SOS three otherwise valid drafts whose P1P1 row is absent but later picks are logged, so the correct outcome-free bound is exact unused draft IDs (MSH 66,004; SOS 105,200);
2. dense temporary outer-product accumulation was replaced by algebraically identical sparse-index accumulation to avoid unnecessary memory pressure.

FIN/TDM/DFT artifacts were preserved. Only MSH/SOS were rerun through the corrected execution path.

## Aggregate result

Eligible P1P2–P1P8 decisions: **3,183,118**

Average regret of research A relative to the recentered-IV best statistically supported offered action:

**0.2290850 wins / decision**

10,000-draw environment-stratified source-draft bootstrap CI95:

**[0.2288306, 0.2293455]**

Median regret: **0.17565**

P90 regret: **0.55519**

Share of eligible decisions with regret > 0.02: **73.39%**

### By environment

| Set | Eligible decisions | Mean regret |
|---|---:|---:|
| FIN | 766,420 | 0.21675 |
| TDM | 496,221 | 0.24258 |
| DFT | 790,529 | 0.22158 |
| MSH | 415,050 | 0.24435 |
| SOS | 714,898 | 0.23238 |

### By pick, pooled across environments

| Pick | Eligible decisions | Mean regret | Share > 0.02 |
|---|---:|---:|---:|
| P1P2 | 457,427 | 0.25057 | 76.82% |
| P1P3 | 454,039 | 0.22150 | 72.87% |
| P1P4 | 452,462 | 0.22067 | 72.41% |
| P1P5 | 455,702 | 0.23191 | 74.14% |
| P1P6 | 455,684 | 0.25150 | 74.71% |
| P1P7 | 454,861 | 0.21247 | 71.12% |
| P1P8 | 452,943 | 0.21470 | 71.65% |

## Close-call audit

Regret is largest where A is least decisive, but substantial estimated regret remains even when A's top-two probability margin exceeds 0.10.

| A top-two margin | n | Mean regret | Median | P90 | Share > 0.02 |
|---|---:|---:|---:|---:|---:|
| <= .02 | 584,984 | 0.26846 | 0.22102 | 0.61545 | 78.45% |
| .02–.05 | 686,119 | 0.25252 | 0.20372 | 0.58799 | 76.90% |
| .05–.10 | 770,211 | 0.23487 | 0.18407 | 0.56106 | 74.70% |
| > .10 | 1,141,804 | 0.19092 | 0.13175 | 0.48908 | 67.82% |

Disagreement slices:

- A vs recentered-IV best: n=2,419,400, mean regret **0.30140**, 96.56% > 0.02.
- A vs historical drafter: n=1,832,591, mean regret **0.24523**, 75.63% > 0.02.
- A vs both IV-best and historical drafter: n=1,431,290, mean regret **0.31399**, 96.83% > 0.02.

## Combined answer to #756

The preregistered primary P1P1 study already failed the 0.02 optimal-enough gate:

- P1P1 mean regret: **0.1552391**
- P1P1 CI95: **[0.1546613, 0.1558308]**

The secondary P1P2–P1P8 study points in the same direction, with an even larger pooled estimate:

- P1P2–P1P8 mean regret: **0.2290850**
- clustered CI95: **[0.2288306, 0.2293455]**

Therefore the requested empirical stopping argument does **not** support the claim that A is optimal-enough at a 0.02 wins/decision materiality threshold.

This does not establish literal omniscient card values or prove that a deployable policy can capture the full reported gap. The estimates are relative to frozen randomized-offer/recentered-IV projections, and their exclusion restrictions remain approximate because pack composition also affects passed-card information and wheel behavior.

The practical conclusion is narrower but strong:

> Under both predeclared designs, the statistically supported remaining value gap is materially larger than 0.02 wins/decision. The data do not justify stopping on the theory that A has no meaningful room left to improve.

## Randomized recommendation experiment

A prospective randomized recommendation experiment remains the definitive direct policy test.

No retrospective analysis in #756 is treated as equivalent to randomizing recommendations, and no such experiment was fabricated or launched by this research-only issue.

## Production boundary

No production scoring, corpus, puzzle, database, or deployment change is authorized by this result.

Any attempt to turn the identified value gap into a new production recommender requires a separately preregistered model/policy-development issue and prospective confirmation.
