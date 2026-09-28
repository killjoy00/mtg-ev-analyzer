# Q+A bounded policy-design study

**Issue:** #529  
**Status:** exploratory policy design only; locked assessment is spent  
**Frozen base policies:** incumbent A and frozen rich-Q bundle fingerprint `d1f3cb78d1674b1424805b33637c89d3f3977baa890db61ff534fa7700cb5f33`

## Purpose

The locked assessment and post-assessment influence audit suggest that Q may contain useful outcome signal but its raw argmax can make lower-support overrides of A. This study asks whether a small, predeclared Q+A policy family can preserve Q's upside while falling back to A on weak or marginal overrides.

This is a **new policy-design phase**. It does not reopen the spent MSH/SOS/ECL/TLA assessment and it cannot use those assessment outcomes to select a hybrid. H/J/N remain descriptive research comparators only and are not eligible to win this study.

## Development data

Use only the already-defined **validation** partitions from the four fresh environments EOE, FIN, TDM, and DFT. Their assessment partitions remain unopened. Fresh-train rows may be used only for leakage-safe aggregate features and the same behavior nuisance fitting used by the prior fresh evaluator.

After this study, EOE/FIN/TDM/DFT validation outcomes are considered development data for any selected hybrid and cannot be described as independent confirmation of that hybrid.

## Frozen primary decision

As in the existing protocol, evaluate exactly one deterministic hashed eligible P1P1-P1P8 decision per draft. Primary estimator is paired DR versus A at weight cap 20; caps 10 and 50, direct, SNIPS, IPW, support and ESS are diagnostics.

## Policy family

Let `a` be A's leader and `q` be Q's leader. Let

`q_advantage = Q(q) - Q(a)`.

The behavior propensity is the same fresh-environment strong-offset behavior nuisance used by the prior four-way evaluator.

The cap-20 support floor is:

`max(0.05, 0.01, 0.10 / candidate_count)`.

The 0.05 component ensures an accepted deterministic target action is not beyond the cap-20 inverse-propensity boundary.

### QA-Guard candidates

If Q and A agree, use that card. If they disagree, use Q only when the Q leader passes the cap-20 support floor and `q_advantage` is at least the frozen threshold; otherwise use A.

Frozen thresholds:

- `guard_005`: +0.05 expected match wins;
- `guard_010`: +0.10;
- `guard_020`: +0.20.

### Normalized Q+A blend sanity checks

Within each offered pack, standardize the frozen Q scores and `log(max(A_probability, 1e-9))` across candidates. Define

`blend = lambda * z(Q) + (1-lambda) * z(log A)`.

Frozen lambdas:

- `blend_025`;
- `blend_050`;
- `blend_075`.

If the blend leader differs from A and does not pass the same cap-20 support floor, fall back to A.

These normalized blends are secondary candidates; they receive no additional tuning.

## Eligibility for a hybrid to enter the larger untouched confirmation

Aggregate the four fresh validation environments only after all four complete.

A hybrid is eligible only if:

1. weighted pooled DR delta versus A is positive at caps 10, 20, and 50;
2. cap-20 DR delta is positive in at least 3 of 4 environments;
3. no environment's cap-20 point estimate is below -0.05 expected wins;
4. no environment has a cap-20 95% CI entirely below -0.05;
5. cap-20 ESS/N is at least 0.10 in every environment;
6. direct and SNIPS pooled cap-20 deltas are both positive;
7. intervention rate is below raw Q's intervention rate.

If no hybrid qualifies, no hybrid advances.

If more than one hybrid qualifies, select the candidate with the **largest minimum environment cap-20 DR delta** (maximin transport rule). If candidates are within 0.01 expected wins on that criterion, prefer the lower intervention rate; if still tied, prefer the simpler QA-Guard candidate, then the more conservative setting (higher guard threshold or lower Q blend weight).

The selected hybrid is exploratory until tested on genuinely unused drafts.

## Next experiment

The later large confirmation should compare A against frozen Q and, only if one qualifies here, the single frozen selected Q+A hybrid. H/J/N may be scored as secondary diagnostics but cannot affect the primary conclusion.

Because there would be two primary challengers if a hybrid advances, the large confirmation protocol must account for two-comparison multiplicity and must size the sample using the frozen policies' observed development variance before outcomes are opened.
