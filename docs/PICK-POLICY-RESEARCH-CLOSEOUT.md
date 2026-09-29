# Pick-policy research closeout

**Date:** 2026-09-29  
**Status:** final research position  
**Production impact:** none  
**Scope:** closeout of the #529 / #756 A-versus-challenger research program; no new outcome analysis

## Final position

The production pick policy remains **deployed A: `strong-player-colour-stage-v4`**.

That is the current production scoring model for the `elite-trophy-colour-stage-v8` corpus, as recorded in [CURRENT-STATE](CURRENT-STATE.md).

The research program does not establish that A is optimal. It establishes a narrower operational position:

- no tested challenger cleared its predeclared advancement / confirmation requirements;
- the deployed-vs-research-A value diagnostic does not change that conclusion;
- the behavior-model-independent randomized evidence is limited to P1P1 pack receipt and is largely consistent with A on the two detected cards;
- corrected #756 does not provide a valid estimate of A's regret.

Accordingly, there is no research basis here for a production pick-policy change.

## Evidence

### Challenger policies versus A

The main frozen challenger tests did not establish a replacement for A.

| Comparison | Frozen result | Interpretation | Evidence |
| --- | --- | --- | --- |
| Q - research A | cap-20 DR **-0.02795**; registered CI97.5 **[-0.10994, +0.05498]** | did not confirm | [#529 Q / Guard-10 confirmation](https://github.com/killjoy00/mtg-ev-analyzer/issues/529#issuecomment-5863287621) |
| Guard-10 - research A | cap-20 DR **+0.00414**; registered CI97.5 **[-0.02830, +0.03741]** | did not confirm | [#529 Q / Guard-10 confirmation](https://github.com/killjoy00/mtg-ev-analyzer/issues/529#issuecomment-5863287621) |
| R-LCB - research A, development | cap-20 DR **+0.04780**; CI95 **[-0.00608, +0.10349]** | failed frozen advancement rule; R architecture stopped | [R amended-development result](https://github.com/killjoy00/mtg-ev-analyzer/issues/529#issuecomment-5873741967) |
| R-LCB - research A, independent 45k confirmation | **+0.000680**; CI95 **[-0.005418, +0.006931]** | did not reproduce the development magnitude; interval excludes the preregistered +0.03 planning effect | [#529 research closeout](https://github.com/killjoy00/mtg-ev-analyzer/issues/529#issuecomment-5879413584) |
| R-LCB - **deployed A**, spent-45k diagnostic | **+0.008600**; CI95 **[-0.005029, +0.021874]** | substituting literal deployed A does not change the practical challenger conclusion | [A-transfer audit, Step 4](https://github.com/killjoy00/mtg-ev-analyzer/blob/a5840323ab146325d851ccdf3340a4a414de3fa1/reports/ISSUE-529-A-TRANSFER-AUDIT-RESULT.md) |

The post-confirmation evaluator-trust audit found no hard reconstruction defect that would reopen Q / Guard-10; it instead reinforced weak local support for Q and essentially zero confirmed Guard-10 value. See the [trust-audit closeout](https://github.com/killjoy00/mtg-ev-analyzer/issues/529#issuecomment-5864161529).

### Deployed A versus research A

The literal deployed-A Step-4 value diagnostic on the already-spent 45k cohort estimated:

**deployed A - research A = -0.007920 wins**, CI95 **[-0.020981, +0.005429]**.

That is the informative result for the deployed/research comparator question. See the [amended transfer audit](https://github.com/killjoy00/mtg-ev-analyzer/blob/a5840323ab146325d851ccdf3340a4a414de3fa1/reports/ISSUE-529-A-TRANSFER-AUDIT-RESULT.md) and the [#529 correction note](https://github.com/killjoy00/mtg-ev-analyzer/issues/529#issuecomment-5898862349).

The audit's literal verdict label remains **"does not transfer"**, but its >=95% top-1 agreement gate is not informative: run 36603461542 shows research A was trained on only **100-752 strong drafts per set**, while deployed A used **5,000** per set. That parity gate was unattainable by construction for the unequally trained fits. The held-out strong-player prediction diagnostic favored deployed A on top-1 accuracy and log loss in all eight sets.

### Randomized P1P1 evidence

The frozen EOE randomized-pack study used 91,377 untouched P1P1 drafts. Two of the ten preregistered focal-card reduced-form intervals were above zero after familywise correction:

- **Elegy Acolyte:** +0.3121 wins, 99.5% CI **[+0.1478, +0.4764]**
- **Genemorph Imago:** +0.1732 wins, 99.5% CI **[+0.0144, +0.3321]**

The other eight familywise-corrected intervals included zero. See the [#529 randomized-study closeout](https://github.com/killjoy00/mtg-ev-analyzer/issues/529#issuecomment-5879413584).

A subsequent outcome-free A check found:

- A ranked Elegy Acolyte #1 on **81/81** observed opportunities;
- A ranked Genemorph Imago #1 on **53/68 (77.9%)** and top two on **67/68 (98.5%)**.

Those findings are largely consistent with A rather than evidence for replacing it. They are not head-to-head causal comparisons between A's selected card and alternatives. See the [P1P1 focal-card A check](https://github.com/killjoy00/mtg-ev-analyzer/issues/529#issuecomment-5879661008).

### #756 after null calibration

#756 originally reported large positive selected-maximum "regret" statistics. The follow-up null calibration showed that the P1P1 estimator could produce the observed magnitude even when A's true regret was exactly zero.

The corrected #756 position is therefore:

> **A was not demonstrated optimal-enough**, but #756 does not demonstrate that A is materially suboptimal, does not estimate a statistically supported remaining value gap, and does not justify model development from its selected-maximum results.

The P1P1 gate was shown to be incapable of passing a perfect A under the calibrated scenarios. The later-pick selected-maximum estimator also had a large positive pure-noise baseline. The originally narrow row-bootstrap intervals condition on fitted coefficients and omit coefficient / best-card-selection uncertainty.

See the [#756 correction closeout](https://github.com/killjoy00/mtg-ev-analyzer/issues/756#issuecomment-5896585472), the [corrected P1P1 result](https://github.com/killjoy00/mtg-ev-analyzer/blob/9877f2d8ee72e54ce4a31e38aa27f07fcc8a3fe3/research/A-REGRET-P1P1-RESULT-2026-09-29.md), and the [corrected later-pick result](https://github.com/killjoy00/mtg-ev-analyzer/blob/9877f2d8ee72e54ce4a31e38aa27f07fcc8a3fe3/research/A-REGRET-P1P2-P1P8-RESULT-2026-09-29.md).

## What the evidence does not resolve

### 0.02 wins per decision

No retrospective design completed in this program resolves whether another attainable policy is better than deployed A by **0.02 event match wins per decision**.

The independent split-selection/evaluation calibration used during the #756 correction was far better behaved than the selected-maximum estimator, but its simulated power for a +0.02 effect was only about 21-32%. More retrospective reuse of the same spent outcomes is not a solution.

### Observational OPE

The challenger comparisons based on off-policy evaluation require observational identification assumptions, including **no hidden confounding conditional on the modeled state / behavior information**. Recorded-skill sensitivity analyses show that modest confounding can matter. Agreement between DR, direct, SNIPS or IPW is useful robustness evidence, not independent randomization.

### Randomized evidence

The behavior-model-independent randomized evidence here covers **P1P1 randomized pack receipt only**. It does not identify later picks, full-draft policy value, or a clean head-to-head intervention between A's chosen card and another candidate. Pack composition also means the Wald card-taking interpretation requires additional exclusion / monotonicity assumptions.

## Conditions for reopening pick-policy research

This program should stay closed unless at least one of the following becomes available.

1. **A new identification source.** New exogenous variation, instrumentation, data structure or experimental access that materially improves identification beyond the observational OPE already exhausted here.

2. **A preregistered challenger on a new set's untouched drafts.** The challenger must be frozen before evaluation outcomes are opened. Policy selection must be separated from evaluation by split-sample design, and advancement must use a predeclared **lower-bound gate** rather than a same-fit selected maximum. The untouched confirmation cohort must not be extended or retuned after results are seen.

3. **A randomized recommendation experiment.** Randomly assign A versus a frozen challenger recommendation in real drafts with known assignment probabilities, adherence recorded, and downstream event outcomes. Report ITT separately from adherence-based effects.

## Process rule for any future gate

Before a future research gate is frozen, its statistical behavior must be demonstrated with **outcome-free or fully synthetic / semi-synthetic simulation**.

The simulation must show that the proposed design can reach the appropriate decision in both:

- a world with **no true policy difference**; and
- a world with a **plausible real policy difference** of the magnitude the project cares about.

A gate that mechanically fails under a true null, as #756's optimal-enough gate did, or that has inadequate power for a plausible worthwhile effect, must not be used as the decision rule.

Selection and evaluation uncertainty must be represented in the simulation. A narrow resampling interval conditional on an already-selected fitted maximum is not sufficient.

## Closeout

The A research program is closed.

- **Production policy:** deployed A / `strong-player-colour-stage-v4`.
- **No new outcome analysis is authorized by this closeout.**
- **No production scoring, corpus, database or deployment change is made.**
- Future work must satisfy one of the reopen conditions above and begin with an outcome-free calibration of its decision gate.
