# Frozen 20k A vs Q vs Guard-10 confirmation

**Issue:** #529  
**Purpose:** confirm whether frozen Q and/or frozen Guard-10 improve expected event match wins versus incumbent A on a substantially larger cohort that was unused by all prior EOE/FIN/TDM/DFT #529 experiments.

## Frozen policies

The three policies are fixed before this confirmation cohort is scored.

### A — incumbent comparator

A is the exact strong-player choice-probability ranking already used as the incumbent comparator in the prior four-way and Q+A studies.

### Q — frozen rich outcome model

Q is the exact rich-Q score model from frozen score-bundle fingerprint:

`d1f3cb78d1674b1424805b33637c89d3f3977baa890db61ff534fa7700cb5f33`

No refit, feature change, calibration change, threshold change, or fallback change is permitted.

### Guard-10 — frozen conservative Q-over-A override

Guard-10 is exactly the policy explored in the predeclared Q+A study:

1. if Q and A choose the same card, use that card;
2. otherwise compute `Q(Q_leader) - Q(A_leader)`;
3. use Q's leader only if:
   - the advantage is at least **+0.10 expected match wins**, and
   - the Q leader's frozen behavior propensity is at least `max(0.05, 0.01, 0.10 / candidate_count)`;
4. otherwise fall back to A.

The behavior propensity is reconstructed per environment using the exact prior fresh **train** IDs and the same strong-offset nuisance specification used in the prior fresh and Q+A studies. The new confirmation outcomes may not influence this nuisance fit.

## Fixed archive snapshots

The confirmation must use the exact same closed-set archive bytes used by both the earlier four-way fresh run and the Guard-10 design run.

| Environment | Draft SHA-256 | Game SHA-256 |
|---|---|---|
| EOE | `1dd9d1baf31fa56e06bbd2d9d9bb8c2c87cf342bc15872b5a30dbe9d4ecab648` | `130e7e7580a1cb4b4f635411d187a078bc7bdd9dd3436ef5ff7535e14cadaf1b` |
| FIN | `9d5b2a3e908bb8daf0ea6e951097714b651546370a5c852893dc90a1f2f6ab8b` | `f6452e622976f66dd5420c55741da5b246c7e8d25d63c080e728635e1741a6a6` |
| TDM | `831ba8bc4be5eabe140fac00a8e6eaded3f3f931685be8f91403ad9cfde5cbf5` | `e2e679168818d67d812972343ba541d626d0f57140bc22955e09dd07bc2086e4` |
| DFT | `7812d16e0de78ff7a69faf9981f7ff03be4dfc618a86f14369424ec2204580cd` | `734325afbe5c023245e7769fab66c88dcf241407666becb06b956d7fee13a28b` |

Any archive-hash mismatch stops the run before scoring.

## Exact 20,000-draft cohort

Each environment contributes exactly **5,000** confirmation drafts.

For each environment:

1. reproduce the exact prior 8,000-draft stable-hash cohort with `select_global_draft_ids(..., 8000)`;
2. reproduce the first 13,000 stable-hash eligible drafts with `select_global_draft_ids(..., 13000)`;
3. define the confirmation cohort as `first_13000 - prior_8000`;
4. require exactly 5,000 IDs and zero overlap with the prior 8,000.

Because the archive hashes and stable-hash algorithm are frozen, this deterministically defines the confirmation IDs without using outcome magnitude. Eligibility may require a parseable terminal outcome, as in the existing archive loader, but the outcome value cannot affect ordering or inclusion beyond availability.

The prior 8,000 per environment include all train, validation, and withheld-assessment IDs from the earlier fresh/Q+A studies, so none of those IDs can enter this confirmation.

Total confirmation sample: **20,000 drafts**.

## Nuisance/reference data

For each environment, reconstruct the exact prior 8,000 cohort and use only IDs with the original `draft_split == "train"` as development/reference data for:

- leakage-safe aggregate signals;
- the strong-offset behavior propensity model used for OPE and Guard-10 support;
- any metadata lookup inputs required to reproduce frozen features.

No confirmation draft outcome may be used for fitting, calibration, policy selection, thresholding, or support-model estimation.

The frozen simple-Q nuisance bundled with the existing evaluator remains the outcome nuisance for DR calculations.

## Primary estimand

Same as #529:

> Expected change in event match wins from replacing one deterministic eligible P1P1–P1P8 pick with the target policy's recommendation versus A.

Exactly one deterministic hashed eligible decision is evaluated per draft using the existing primary-decision salt/rule.

## Co-primary comparisons

1. **Q minus A**
2. **Guard-10 minus A**

Both receive the full 20,000 drafts. The sample is not split into arms.

Primary estimator: paired doubly robust (DR) delta at weight cap 20, clustered by draft.

Mandatory sensitivity:

- DR caps 10, 20, 50;
- direct outcome-model delta;
- SNIPS;
- IPW;
- ESS and ESS/N;
- clipped fraction;
- maximum unclipped importance weight;
- per-environment estimates and uncertainty;
- Q vs Guard-10 direct paired comparison.

## Multiplicity

There are exactly two co-primary challenger-versus-A tests.

Family-wise alpha is 0.05 using Bonferroni:

- per-challenger two-sided alpha = 0.025;
- each challenger receives a paired-bootstrap **97.5% confidence interval** for cap-20 DR versus A.

Ordinary 95% intervals are also reported descriptively.

No additional challenger can be promoted into the primary family after outcomes are opened.

## Confirmation gate for each challenger

A challenger is confirmed only if all of the following are true:

1. cap-20 paired DR **97.5% CI is entirely above 0**;
2. direct and SNIPS cap-20 deltas are both positive;
3. DR deltas are positive at caps 10, 20, and 50;
4. pooled cap-20 ESS/N is at least 0.10;
5. no environment has its cap-20 95% CI entirely below **-0.05 expected match wins**;
6. no implementation, archive, cohort-overlap, or frozen-policy identity check fails.

If overlap/support makes a result unreliable, it is inconclusive rather than a win.

## Decision interpretation

- **Only Q confirmed:** Q advances.
- **Only Guard-10 confirmed:** Guard-10 advances.
- **Neither confirmed:** A remains incumbent; this 20k cohort is spent and cannot be used to tune another threshold/model.
- **Both confirmed:** report the paired Guard-10 vs Q cap-20 DR difference with a 95% CI. Do **not** select a winner merely from the larger point estimate. If the pairwise interval does not separate them, carry both forward or make the production choice on a separately frozen criterion / randomized test.

No production behavior changes from this offline confirmation alone.

## Stopping rule

The sample is fixed at exactly 20,000 confirmation drafts. Do not add drafts after seeing results. Any later sequential or live randomized experiment requires a new protocol frozen before its outcomes are observed.
