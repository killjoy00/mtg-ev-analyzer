# Pick-policy research closeout

Date: 2026-09-29

## Final position

Pick-policy research is closed. Production remains on deployed A: `strong-player-colour-stage-v4` in the `elite-trophy-colour-stage-v8` corpus/scoring path. No production scoring, corpus, database, or deployment change is authorized by this closeout.

Do not replace deployed A with research A. Do not resume R-LCB or other retrospective challenger tuning under #529/#756. Any future pick-policy research requires an explicit new issue and a materially stronger identification/data design; the preferred definitive test is a prospective randomized recommendation experiment with adequate power.

## Why research A and deployed A disagreed

The transfer audit established that research A was not a different model family. It used the same `OutOfFoldModel` implementation, the same strong-player rule (at least 100 games; top 15% by win rate), the same colour-stage scoring construction, and the same deterministic card-name tie-break. The material difference was training-set size.

| Set | Research A strong training drafts | Deployed A training drafts | Held-out strong-pick top-1: deployed / research | Held-out log loss: deployed / research |
| --- | ---: | ---: | ---: | ---: |
| FIN | 752 | 5,000 | 57.64% / 53.45% | 1.3288 / 1.5120 |
| DFT | 653 | 5,000 | 56.63% / 52.32% | 1.3006 / 1.5082 |
| EOE | 631 | 5,000 | 58.97% / 53.68% | 1.2460 / 1.4463 |
| TDM | 597 | 5,000 | 54.02% / 50.12% | 1.3462 / 1.5664 |
| SOS | 262 | 5,000 | 50.29% / 43.02% | 1.3921 / 1.7786 |
| TLA | 245 | 5,000 | 53.06% / 42.86% | 1.3765 / 1.7991 |
| ECL | 179 | 5,000 | 53.76% / 36.09% | 1.3766 / 1.8195 |
| MSH | 100 | 5,000 | 55.77% / 42.31% | 1.3214 / 1.8786 |

Deployed A predicts held-out strong-player picks better in every set and has lower log loss in every set. The smallest-set rows have only 208-344 held-out decisions and should be treated as rougher estimates; the later-set rows have much larger held-out samples.

The transfer audit's frozen >=95% recommendation-agreement gate assumed research A would be a near-copy of deployed A. Given the 100-752 versus 5,000 training-draft mismatch, that gate was unattainable by construction and its failure is not informative about policy value. The audit retains the literal label `does not transfer` because that was the frozen gate result, but it must not be read as "the #529 research does not apply to production." The Step-4 value diagnostic is the informative transfer result.

Durable transfer-audit record: `reports/ISSUE-529-A-TRANSFER-AUDIT-RESULT.md`.

## Policy-value evidence

On the exact spent 45k FIN/TDM/DFT cohort, the two A fits cannot be distinguished in wins:

- deployed A minus research A: **-0.007920 wins/decision**, CI95 **[-0.020981, +0.005429]**;
- frozen alternative evaluator: **-0.009463**, CI95 **[-0.022509, +0.003796]**.

The one frozen challenger re-tested against literal deployed A also shows no actionable gain:

- R-LCB minus deployed A: **+0.008600 wins/decision**, CI95 **[-0.005029, +0.021874]**;
- alternative evaluator: **+0.010492**, CI95 **[-0.003385, +0.023748]**.

Therefore substituting literal deployed A for research A does not change the #529 practical conclusion: nothing tested supports replacing deployed A.

## Randomized P1P1 evidence is already aligned with A

The #529 randomized EOE P1P1 study found familywise-significant positive pack-receipt effects for Elegy Acolyte and Genemorph Imago. Research A already strongly favored those cards in the spent cohort (Elegy 81/81 top-1; Genemorph 53/68 top-1 and 67/68 top-two).

A separate deployed-A reconstruction supplied for closeout likewise has deployed A taking Elegy in 1,687/1,687 offered P1P1 packs and Genemorph in 1,645/1,674 (98%). Treat those deployed-A counts as approximate supporting evidence rather than an exact production replay: the EOE snapshot may differ from the production snapshot and the reconstruction used all 5,000 training drafts rather than the production fold-specific graders.

Nothing in the randomized P1P1 result argues for replacing deployed A.

## Historical-data resolution limit

#756's corrected null-calibration follow-up invalidated the original regret statistic as evidence of a deployable remaining gap. In the preregistered independent selection/evaluation simulation, power for a true +0.02 wins/decision gain was only **21.4%-31.5%** across the tested scenarios; no scenario reached 80% power. The original 0.02 gate could not pass even under exactly-optimal-A calibration scenarios, and the original claims of a statistically supported remaining value gap were withdrawn.

Combined with the A-transfer result -- two reasonable fits disagreeing on many picks while remaining indistinguishable in observed win value -- and the failure of every preregistered challenger to advance, the practical inference is that the currently available retrospective 17Lands history has reached its resolution limit for choosing among reasonable pick policies at product-relevant effect sizes.

This is an inference about the available retrospective designs, not proof that no better pick policy exists.

Relevant records:

- #529: https://github.com/killjoy00/mtg-ev-analyzer/issues/529
- #756 correction: https://github.com/killjoy00/mtg-ev-analyzer/issues/756#issuecomment-5896585472
- A-transfer Step 4: https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/36608499362

## Product fit

The product already behaves consistently with this uncertainty. The historical trophy choice receives 100; alternatives are scored from model support and capped below the trophy choice (documented as `round(95 x r)` in the scoring report). Near-ties therefore receive near-full credit rather than being presented as categorical proof that one card is uniquely correct.

Keep that product posture. Model support is a comparison signal, not a claim of causal optimality.

## Closed decisions

1. **Production policy:** deployed A (`strong-player-colour-stage-v4`).
2. **Research A:** do not ship; its small positive point estimate versus deployed A is not statistically distinguishable from zero, and it is the same model trained on substantially less strong-player data.
3. **R-LCB:** closed; do not retune or promote.
4. **#529 / #756 retrospective pick-policy program:** closed.
5. **Production changes from this research:** none.
6. **Restart condition:** explicit owner authorization in a new issue, with a design capable of resolving product-relevant effects; prefer a prospective randomized recommendation experiment over another retrospective challenger search.
