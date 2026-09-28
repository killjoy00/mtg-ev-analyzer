# Contextual Value v1 — separately authorized frozen R-LCB independent confirmation

Date frozen: 2026-09-28  
Issue: #529  
PR: #674  
Branch: `research/contextual-value-v1-h-freeze-audit-529`

## Status and authorization boundary

This is a **separately authorized independent confirmation** of the exact frozen R-LCB policy after the original development stopping rule had already concluded that R **did not advance**.

The historical result is not changed or reinterpreted:

- final R development execution: run `36447316564`, artifact `10981088306`;
- R-LCB minus A, cap-20 DR: **+0.047798 wins**;
- paired CI95: **[-0.006084, +0.103488]**;
- alternative-behavior DR: **+0.045964**;
- intervention rate: **9.10%**;
- frozen development advancement gate required point estimate **> +0.05**, so R **did not advance**.

The exact pre-outcome policy is retained from run `36442998592`, artifact `10979437898`:

- `r-policy-bundle.npz` SHA-256  
  `8191ef8ef3eb0de5cbd963392b5e11c86b31f82984ec39b8701e6b5c107ac520`;
- `prerun-freeze-report.json` SHA-256  
  `9b351ee6ca0a3dd8d676c18d2eed3f847ca34b8f7c619c797e76c193df234b66`;
- frozen R-LCB (c): **2.49**.

No historical model search will be rerun. No R coefficient, covariance, scale, feature ordering, feature subset, support gate, fallback, tie-break or (c) may be changed from confirmation outcomes.

Production remains unchanged. This research does not authorize merge or deploy.

## Data-use ledger and new confirmation cohort

A single prior-use ledger is created before any new confirmation outcome is analyzed. It records every draft previously used for training, validation, assessment reservation/opening, confirmation, diagnostics or P1P1 outcomes where retained evidence permits exact reconstruction. Outcome-free archive inventories are not themselves treated as outcome use.

EOE is excluded from the R confirmation because the separately frozen EOE P1P1 study consumes the complete remaining EOE cohort after the prior 13k boundary.

For each of **FIN, TDM and DFT**, reserve exactly **15,000** previously unused eligible drafts:

[
operatorname{select_global_draft_ids}(28000)
setminus
operatorname{select_global_draft_ids}(13000).
]

The retained first-13k boundary must reproduce exactly as the union of the prior 8k fresh cohort and the prior 5k Q/Guard confirmation cohort. Any mismatch, prior-use overlap, archive hash mismatch, count mismatch or cross-environment ID collision fails closed.

Frozen sample size:

- FIN: 15,000 drafts;
- TDM: 15,000 drafts;
- DFT: 15,000 drafts;
- total: **45,000 drafts**.

No sample extension, optional stopping or interim outcome inspection is permitted.

## Power calculation

Planning effect: **+0.03 event wins**.  
Already-spent conservative draft-level difference variance: **3.7543868**.  
Two-sided alpha: **0.05**.  
Power: **0.90**.

Normal approximation:

[
n =
rac{sigma^2 (z_{0.975}+z_{0.90})^2}{0.03^2}
approx 43{,}832.2.
]

The required integer size is **43,833**; the study freezes **45,000**.

This calculation powers detection of a +0.03 effect against zero under variance-transfer and approximately independent draft-level sampling assumptions. It **does not** power proof that the true effect exceeds +0.03.

The public archive does not provide a stable player identifier suitable for clustering repeated drafts by player, so repeated-player dependence cannot be estimated directly. This limitation is reported rather than ignored.

## Frozen policy transfer

The challenger is exactly **R-LCB(c=2.49)**.

Retain unchanged:

- global coefficients;
- global covariance;
- training feature scales;
- feature ordering;
- retained `keep_indices`;
- both-action support requirement;
- fallback to A;
- deterministic card-name tie-breaking;
- all frozen feature construction.

Before transfer, the code must reproduce the retained development R actions exactly from the immutable bundle and retained validation shard.

For each new environment, all nuisance and aggregate artifacts are fit **only from the environment's previously authorized prior training IDs**. No confirmation draft outcome may contribute to these fits.

### Comparator A

A is the established leakage-safe research incumbent analogue reconstructed from prior-training strong-player evidence. It is described as a **complement-refitted incumbent analogue** unless literal production-artifact parity can be established without contaminating the holdout.

### Primary behavior evaluator

Primary behavior is the established **strong-offset conditional-logit** nuisance:

- leakage-safe prior-training strong-player probabilities enter as the fixed offset;
- learned strong-choice fields are removed from the fitted conditional-logit feature rows;
- fit once per environment using prior training IDs only.

### Alternative behavior evaluator

Before confirmation outcomes, spent-development calibration showed the prior rich behavior correction substantially degraded local R/A override support and target-action weight normalization. It is therefore not used as the transfer alternative.

The sole frozen alternative evaluator is a **skill × rich-candidate conditional-logit correction over the primary behavior**:

- L2 = 1000;
- candidate schema and ordering fixed to the retained 103 rich candidate features;
- trained only on prior-training P1P1–P1P8 decisions;
- no confirmation outcomes;
- R and A actions remain exactly fixed;
- the primary R support gate is **not recomputed** under the alternative evaluator.

The alternative exists only as a robustness check. It cannot replace the primary result after outcomes are seen.

### Outcome nuisance

The DR direct-Q nuisance is the existing fixed simple ridge model family:

- ridge L2 = 10;
- trained once per environment on prior training IDs only;
- leakage-safe aggregate features from the same prior-training complement;
- strong-choice fields removed from Q inputs;
- no hyperparameter selection on confirmation data.

All confirmation policy actions, behavior probabilities and Q predictions are materialized and hashed before confirmation outcomes are joined.

## Primary estimand

For each draft, use every available eligible **P1P1–P1P8** decision.

The estimand is the average **one-step recommendation effect** of frozen R-LCB versus A at those positions, followed by natural subsequent drafting and play.

Weighting:

1. each eligible decision within a draft receives (1 / n_d), so each draft contributes total weight one;
2. each environment contributes exactly one-third to the final mixture.

This is **not** the sum of eight hypothetical interventions and does not treat picks as independent samples. It is not a whole-draft policy-value estimand.

## Primary estimator and inference

Primary estimator: **paired cap-20 doubly robust** R minus A.

Primary interval: two-sided **95% paired draft bootstrap**, stratified by environment, **10,000 draws**, seed **529**. Each bootstrap draw resamples drafts within FIN/TDM/DFT separately and then averages the three environment means equally.

Primary statistical success criterion:

> The primary 95% interval lies strictly above zero.

There is no additional post-result point-estimate cutoff.

Separately report the practical +0.03 planning target:

- **supports +0.03** if the entire interval is above +0.03;
- **excludes +0.03** if the entire interval is below +0.03;
- otherwise **compatible with +0.03**.

## Prespecified robustness and credibility reporting

For the exact same frozen R/A actions report:

- primary and alternative-behavior results;
- direct and residual-correction components;
- DR caps 10 / 20 / 50;
- SNIPS and IPW;
- target-action calibration;
- cap-20 and uncapped target-weight normalization;
- both-candidate support on actual R overrides;
- override frequency;
- matched-action counts;
- propensity and weight tails;
- largest per-draft influences;
- per-environment results;
- leave-one-environment-out results;
- the frozen hidden-confounding sensitivity grid.

Sensitivity grid:

[
Gamma in {1.0, 1.1, 1.22352, 1.25, 1.5, 2.0, 3.0, 5.0}.
]

These sensitivity bounds are **not confidence intervals**. Sampling uncertainty is reported separately. The recorded-skill (Gamma=1.22352) benchmark is a scale reference from spent development data, not a measurement of actual hidden confounding.

If primary and alternative evaluator conclusions disagree materially, the conclusion is labeled **evaluator-sensitive**. The primary result is not replaced.

## Decision language

The final R report must distinguish among:

- statistically supported positive average improvement;
- a small positive effect whose practical value remains uncertain;
- an interval excluding a +0.03 benefit;
- meaningful harm;
- inconclusive evidence;
- evaluator-sensitive evidence.

A positive result remains observational evidence for this equal FIN/TDM/DFT mixture. It is not proof of optimal card rankings, individual card superiority, or whole-draft policy value.

## Separation from the EOE P1P1 study

The EOE P1P1 randomized-pack study is a separate frozen study. Its findings:

- cannot change R;
- cannot change the R cohort;
- cannot change R features, (c), support or evaluator selection;
- cannot add environments to the R study;
- cannot be pooled into the R confirmation.

The P1P1 study estimates effects of **receiving packs containing frozen focal cards** and separately reports a more assumption-dependent Wald estimate of **taking** a focal card. It does not directly compare A and R recommendations.
