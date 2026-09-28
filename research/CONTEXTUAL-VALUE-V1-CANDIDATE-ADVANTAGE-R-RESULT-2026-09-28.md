# Candidate-advantage R amended development result — 2026-09-28

Issue: #529  
PR: #674  
Branch: `research/contextual-value-v1-h-freeze-audit-529`

## Immutable execution

- successful workflow run: **36447316564**
- result artifact: **10981088306** (`contextual-value-v1-r-amended-development-final-recovery`)
- artifact digest: `sha256:3230581e42a61468266876240c14d0360e089dcd8e11c3b0cd63e5f36643f41e`
- immutable pre-run freeze run: **36442998592**
- pre-run report SHA-256: `9b351ee6ca0a3dd8d676c18d2eed3f847ca34b8f7c619c797e76c193df234b66`
- frozen policy bundle SHA-256: `8191ef8ef3eb0de5cbd963392b5e11c86b31f82984ec39b8701e6b5c107ac520`

The successful run used the execution-only recovery documented in
`CONTEXTUAL-VALUE-V1-CANDIDATE-ADVANTAGE-R-RECOVERY-2026-09-28.md`.
The two prior failed executions produced no R estimate. The successful recovery
kept the exact frozen policy, sample, evaluator, thresholds, nuisance inputs,
bootstrap settings, and sensitivity grid.

## Formal frozen verdict

**R-LCB does not advance. Retain A.**

The predeclared advancement gate required cap-20 DR improvement strictly
greater than **+0.05 event match wins**.

Observed primary all-eligible P1P1-P1P8 one-step result:

| metric | result |
|---|---:|
| cap10 DR R-LCB - A | +0.0464596 |
| cap20 DR R-LCB - A | **+0.0477980** |
| cap50 DR R-LCB - A | +0.0477980 |
| cap20 DR CI95 | **[-0.0060840, +0.1034877]** |
| cap20 direct | +0.0035719 |
| cap20 residual correction | +0.0442261 |
| cap20 SNIPS | +0.0246936 |
| cap20 IPW | +0.3515313 |
| cap20 R-LCB ESS/N | 0.7096520 |
| cap20 R-LCB clipped fraction | 0.0005571 |
| intervention rate vs A | 0.0910490 |

Every registered gate passed **except**:

`cap20_dr_gt_0_05 = false`

The miss is numerically small (~0.0022 wins) but the frozen rule is not changed
after outcomes.

## Alternative behavior sensitivity

The exact same frozen R-LCB actions evaluated under the predeclared alternative
training-only rich behavior nuisance produced:

- cap20 DR: **+0.0459640**
- CI95: **[-0.0404358, +0.1311866]**
- direct: **+0.0035719**
- SNIPS: **+0.0058722**
- IPW: **-0.0781191**

The required alternative-behavior DR sign remained positive.

## Environment slices

Cap20 DR R-LCB - A:

- ECL: **+0.00660**, CI95 [-0.08848, +0.10317]
- MSH: **+0.06131**, CI95 [-0.03247, +0.16455]
- SOS: **+0.04437**, CI95 [-0.04834, +0.13884]
- TLA: **+0.08617**, CI95 [-0.04954, +0.22935]

No environment crossed the frozen -0.10 point-estimate harm threshold; none of
the environment CIs excludes zero.

## Hidden-confounding sensitivity

Frozen recorded-skill benchmark:

`Gamma_p95 = 1.2235201359752903`

The conservative multi-action DR lower bound is:

- Gamma 1.00: +0.0477980
- Gamma 1.10: +0.0168747
- Gamma 1.22352: **-0.0171049**
- Gamma 1.25: -0.0239584
- Gamma 1.50: -0.0829631

Thus `DR Gamma_zero = 1.22352`: the positive DR conclusion does not survive the
predeclared recorded-skill-sized sensitivity benchmark.

The IPW outer bound crosses zero at Gamma 2.0, but IPW is not used to override
the primary DR gate.

Target-action weight normalization at cap20:

- A: mean **1.22464**, CI95 [1.17752, 1.27200]
- R-LCB: mean **1.33783**, CI95 [1.28919, 1.38497]

These are additional evaluator diagnostics, not promotion evidence.

## Secondary diagnostics — not eligible for selection

- single-hashed R-LCB cap20 DR: +0.03714, CI95 [-0.07150, +0.14988]
- P1P1-P1P8-training-only-fit R-LCB cap20 DR: +0.02357, CI95 [-0.01502, +0.06320]
- legacy R-support cap20 DR: +0.14910, CI95 [-0.02531, +0.32437], direct -0.00243
- unconstrained R cap20 DR: +0.14771, CI95 [-0.02651, +0.32381], direct -0.00283

Do not use the larger secondary point estimates to retune or promote another R
variant. They were prespecified diagnostics after the primary architecture was
frozen.

## Power / interpretation boundary

Pre-run 80% power MDE: **0.1555427 wins** at N=1,218 development drafts.

Therefore this failed gate means the study did not demonstrate the frozen
advancement criterion; it does **not** establish a zero effect. The cap20 point
estimate is small-positive and its CI includes zero.

The observational design still depends on measured-confounding assumptions,
and the predeclared hidden-confounding sensitivity weakens the case further.

## Decision

- **Stop the R architecture under the frozen development protocol.**
- **Do not retune R-LCB c, support floors, penalties, features, blends, or gates.**
- **Retain A as incumbent comparator.**
- Proceed separately to the already-frozen randomized P1P1 pack study, which
  answers a different behavior-model-independent causal question.
