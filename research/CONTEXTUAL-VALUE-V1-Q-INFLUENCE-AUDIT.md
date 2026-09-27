# Frozen Q-vs-A influence/support audit — post-assessment diagnostic

**Issue:** #529  
**Scope:** diagnostic-only recomputation of the already-open locked assessment  
**Primary comparison:** frozen Q versus incumbent A  
**Assessment source:** run 36344151426  
**Locked assessment artifact digest:** sha256:9451d7a6dcb7134313410260eaf8d4a215fff0770d108f0e29f29e0ce721c832  
**Locked report SHA-256:** cab250488d85e485a17b4cac4a03898740cebb4314a22f49bb3e1ad81d45ebd5  
**Frozen score fingerprint:** d1f3cb78d1674b1424805b33637c89d3f3977baa890db61ff534fa7700cb5f33

## Purpose

This audit asks whether Q's locked-assessment cap-20 DR advantage versus A is broadly distributed or is driven by a small number of high-influence / low-support drafts.

This is not a new model-selection step. Q and A remain exactly frozen. Assessment membership, features, ranking rules, nuisance specifications, support rules, clipping caps, and the primary one-pick estimand remain unchanged. No assessment outcome may be used for fitting or tuning.

## Required aggregate parity

Before emitting any influence/support diagnostic, the audit must recompute Q-versus-A DR deltas at caps 10, 20, and 50 from the same frozen assessment and match the retained locked report within a numerical-only tolerance.

### Administrative numerical-tolerance addendum

The first diagnostic run, 36351861300, halted before emitting any audit result because cap-20 aggregate parity error was **1.0094147739891923e-12** against an initially frozen tolerance of **1e-12**. The excess was about **9.4e-15** and no diagnostic report or artifact was produced.

Before any influence/support result is viewed, the parity tolerance is changed to **5e-12** solely to accommodate floating-point recomputation drift. This does not alter any model, score, sample, estimator, clipping cap, nuisance, or diagnostic definition. All three caps must still pass this parity check before results are emitted.

## Frozen diagnostics

If parity passes, report:

1. Contribution of the most influential 1% and 5% of assessment drafts to the cap-20 Q-minus-A DR mean.
2. Single-draft leave-one-out range and whether omitting any one draft changes the sign of the pooled cap-20 delta.
3. Q-versus-A disagreement support: observed-action propensity, importance weights, ESS, clipping, and calibration diagnostics on disagreement decisions.
4. Per-environment Q-versus-A cap-20 results for MSH, SOS, ECL, and TLA.
5. Leave-one-environment-out cap-20 Q-versus-A results.
6. Weight-cap sensitivity at 10, 20, and 50 plus unclipped-weight diagnostics.
7. Planning-only sample-size calculations based on the observed draft-level cap-20 delta variance for detecting +0.18 and +0.10 expected wins at two-sided alpha 0.05 and 80% power.

These diagnostics may explain uncertainty or instability. They do not authorize deleting observations, selecting a favorable cap/estimator, changing Q, or reinterpreting the locked assessment gate.

## Next-step boundary

Only after this audit may a separate, preregistered frozen Q-versus-A confirmation be sized and launched on genuinely unused drafts. The locked assessment remains spent and may not be reused for model tuning.
