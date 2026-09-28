# Candidate-advantage R immutable pre-outcome freeze manifest — 2026-09-28

Issue: #529
PR: #674
Branch: `research/contextual-value-v1-h-freeze-audit-529`

This manifest records the final amended R-LCB pre-outcome freeze before any R validation outcome is opened.

## Immutable source artifact

- Finalizer workflow run: **36442998592**
- Artifact: **10979437898** (`contextual-value-v1-r-prerun-freeze-final`)
- Artifact digest: `sha256:2cea54be195eb4d1f78af3413db104dfb2ef82cd3aadaf9035147b9f581c83da`
- `prerun-freeze-report.json` SHA-256: `9b351ee6ca0a3dd8d676c18d2eed3f847ca34b8f7c619c797e76c193df234b66`
- `r-policy-bundle.npz` SHA-256: `8191ef8ef3eb0de5cbd963392b5e11c86b31f82984ec39b8701e6b5c107ac520`

The retained artifact is the complete generated pre-run report and policy bundle. This repository manifest records its immutable identity plus the frozen values needed to audit the one-time outcome launch.

## Boundary

The generated report states:
- `validation_outcomes_loaded = false`
- `assessment_outcomes_loaded = false`
- `r_result_seen = false`

No R validation result existed when this manifest was committed.

## Frozen policy / sensitivity

- R-LCB `c = 2.49`
- null deviation rate: **0.019654497470859907**
- null target maximum: **0.02**
- null draws: **5,000**, seed **529**
- primary validation intervention rate vs A: **0.0910490433252694**
- A-leader propensity below 0.05: **169 / 9,094 = 0.018583681548273587**
- recorded-skill confounding benchmark `Gamma p95 = 1.2235201359752903`
- frozen Gamma grid: **1.0, 1.1, 1.22352, 1.25, 1.5, 2.0, 3.0, 5.0**

## Frozen development sample / power

- training drafts: **4,789**
- training decisions: **194,842**
- validation drafts: **1,218**
- validation decisions: **49,498**
- eligible P1P1-P1P8 validation decisions: **9,094**
- validation identity SHA-256: `4bdc01211e841841441cad3bd03cfc4f2bbd03342d88842522c016c3903b4767`
- 80%-power pre-run MDE: **0.1555427239853002 event wins**
- planning variance: **3.7543868017860915**
- development SE: **0.055519540501454856**
- alpha: **0.05 two-sided**
- existing advancement point threshold remains **+0.05 wins**

Spent-20k all-eligible variance diagnostic:
- Q-A variance: **3.7543868017860915**, single/all ratio **7.311378803666477**
- Guard-10-A variance: **0.598752939010806**, single/all ratio **7.136375258924456**
- registered 20k result remains unchanged.

## Nuisance / feature parity

All training folds 0..4:
- candidate mismatches: **0**
- selected pseudo-value recompute max error: **0**
- unselected `phi_simple == q_simple` max error: **0**
- maximum behavior normalization error <= **4.440892098500626e-16**

Validation:
- candidate mismatches: **0**
- stored behavior max error: **0**
- stored q max error: **0**
- maximum behavior normalization error: **3.3306690738754696e-16**

Frozen feature cleanup removed **21** predeclared zero/duplicate residualized features and kept **82** candidate features. The five predeclared `packrel:*:present` residualized columns were exactly identical where required.

## Final-stage fit diagnostics

- design width: **581**
- rank: **581**
- solver: Moore-Penrose pseudoinverse, `rcond=1e-12`
- condition number: **516549.8106364223**
- global Gram diagonal min/median/max: **4788.999999999987 / 4788.999999999998 / 4789.000000000024**
- global L2 penalty: **100**
- penalty / median Gram: **0.020881186051367726**
- covariance clusters: **4,789 drafts**
- covariance: CR1 cluster-by-draft empirical sandwich
- global covariance trace: **0.006611094114164131**
- max eigenvalue: **0.0006311738831647658**
- raw minimum eigenvalue: **-1.3782878752540024e-17** (numerical-scale only; no counted negative eigenvalues after tolerance)

## Recorded balance diagnostics

Draft-level residualized candidate-feature balance:
- skill R^2: **0.06947635688991649**
- skill permutation null p95: **0.021010659693322702**
- experience R^2: **0.05675046488945268**
- experience permutation null p95: **0.021139548554821263**
- 200 permutations, seed 529

These are diagnostics, not a claim that residual confounding is absent. The amended sensitivity analysis remains required in the one-time R outcome report.

## Alternative behavior evaluator freeze

- prior rich-behavior run: **36323128790**
- all training pick lambdas are one: **true**
- reconstructed validation selected-action NLL: **1.1079816928532122**
- prior retained validation NLL: **1.1079704735235874**
- NLL parity error: **1.1219329624889696e-05**

Frozen R-LCB actions are not recomputed under this alternative behavior evaluator.

## Launch rule

The next allowed R action is exactly one evaluation of the already-frozen R-LCB policy on the already-spent core validation outcomes using `research/contextual_value_candidate_advantage_r_outcome.py`.

The launch must:
1. download the exact finalizer artifact/run above;
2. verify the report and policy-bundle SHA-256 values above;
3. use the retained Phase A2 fold -1 validation shard and frozen `strong_offset_only` validation nuisance;
4. produce the amended all-eligible P1P1-P1P8 primary evaluator plus the frozen sensitivity/secondary diagnostics;
5. keep assessment outcomes unopened;
6. make no tuning or policy changes from the result.

If any identity/parity assertion fails, the run must stop rather than repair or refit.
