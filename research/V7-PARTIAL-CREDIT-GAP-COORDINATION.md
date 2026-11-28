# V7 partial-credit audit: binding coordination hold

Owner amendment: [#1863 coordination addendum](https://github.com/killjoy00/mtg-ev-analyzer/issues/1863#issuecomment-7241663357).

## Status and quarantined data

- Previous run 46159835947 used original validation windows; cancelled, four completed per-format artifacts (DFT, FRA, HOB, Powered Cube). Do not download, aggregate, inspect for selection, or reuse as evidence for any design choice. Earlier synthetic-only run 46159791821 failed. Replacement quarantine-only run 46161194529 completed; no historical data accessed by that replacement.
- The old script's data-loading and aggregation entry points are disabled. Its pure pairwise and clustered-interval helpers may be reused after integration. No global support temperature, exponent or support-scale correction is permitted. No general extra mana term duplicating A/B.
- The currently reviewed contrast refit, run 46107297635, remains the fallback.

## Required inputs before restarting this audit

1. Complete residual-only second-color A/B trigger, using the same training-only reference and shared 70/30 split. Freeze the feature implementation and record its digest, including A/B status.
2. Complete the stage and rarity holdout decisions on that exact feature implementation. Preserve any selected stage interactions (including established_support if A fires) and conditional rarity means. Record the decision artifact hashes and all 31 source/split/feature identities.
3. Reconstruct the reference from the shared residual 70% training drafts only, using the selected structure, frozen v6 baseline and training-only eligibility. Use the shared `pool_aware_v7_context_stage.split` helper or its canonical successor, with one cutoff for both cohorts, timestamp ties kept together. Require exact cutoff, cohort counts, input pin and selected-fit parity with the upstream reports. The residual 30% is the sole audit holdout. No original validation labels may be read. Fail closed if any required upstream decision or identity is missing.

## Audit and decision

- Full eligible Pack 1 window plus P1–8, report coverage and Strict/Legacy/Cube separately. Use all experienced strong-cohort drafts without outcome/trophy filtering. Include model disagreements. Use unrounded support to compute pairwise expectations and original rounded linear model-only grade for bands. Favorite ties use the existing deterministic name ordering. The pair enters the sample only when the actual pick is favorite or alternative; retain whole-draft clusters.
- Report grade bands 0–19, 20–39, 40–59, 60–79, 80–89, 90–95, expected and observed alternative pick shares, comparisons, draft counts and clustered uncertainty. Analyze 90–95 and 40–69 directional errors by stage, prior-pool/color-state and card class. Use public historical card names and prior pools, recurring comparable drafts, no raw source IDs or Pack One player data.
- Uniform under/over-credit is descriptive and is an owner generosity/exponent decision, not a correction. Established-second-color under-prediction goes exclusively through change A. Do not propose another overlapping feature. A distinct context-specific pattern, if observed on training-side drafts, can nominate at most one precisely defined correction before the audit holdout is opened. Fit only on the 70%, evaluate on the 30% and across formats, with exact original support and scoring parity; preserve the trophy 100, alternative max 95, linear formula and existing stability/guardrails. No correction if no separately recurring qualifying pattern.
- No individual promotion. Freeze the audit decision in the common manifest with all other adopted/rejected decisions. Exactly one combined full-residual refit, one original-window reviewed acceptance and read-only production shadow, all predeclared card-term arms evaluated together. If the combination fails any required gate, use the current reviewed refit. No subset rescue or second combination.

The old workflow has been replaced by a no-data quarantine job, isolated in its own concurrency group. Re-enable only after the dependency lock is satisfied; no automatic fallback to a superseded feature set.
