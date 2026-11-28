# Final v7: one outcome-based card-term comparison (#1863)

> **Owner coordination override (2026-11-28):** [binding addendum on #1863](https://github.com/killjoy00/mtg-ev-analyzer/issues/1863#issuecomment-7241663357) supersedes the standalone execution described below. Run 46160300756 is informational only and is quarantined from all selection. The outcome arm must not open validation choices or make a separate adoption decision. Reuse the Model C implementation and paired evaluation code only after the second-color A/B trigger, stage/rarity holdouts, and calibration/ALSA holdout decisions on the shared chronological residual 70/30 split have been resolved and the single combined manifest has been frozen. In the single combined full-residual refit, fit outcome strength using baseline/residual-linked games under the original strict/legacy rules, and jointly fit its coefficient with **all adopted context features**, including stage interactions if selected (including established_support if A and stage interactions are selected). Evaluate contrast, strong-only and outcome on identical final validation choices in the same reviewed run; retain their respective locked rules and choose higher pooled Strict AUC among qualifying alternatives. The package must pass all incumbent release checks plus the second-color calibration/noninferiority criteria; otherwise retain the completed current refit. No subset rescue, second combination, retuning, separate shadow, or independent promotion. Until that manifest is frozen, only synthetic/data-free checks are permitted on this branch. The original standalone workflow is retained in git history solely as implementation reference, not an executable selection path.

Frozen before any outcome-arm validation metrics. Reference is reviewed-final
contrast run 46107297635, registry
ba978db88bb5b569a100cfbc53103a697e2ee0a496b1ec9a9c2fcba1f90a6bdc.
Use its six final mana/context features (no adopted stage-varying structure
was present in the reviewed refit) and exact validation banks, profile seeds,
choices, source exclusions and paired whole-draft bootstraps.

## Estimator and leakage contract

Model C from CARD-STRENGTH-V1.md: L2 logistic regression C=.1, original
pregame controls and their training-only StandardScaler, nonbasic deck copy
counts, card coefficients standardized over cards seen in fitting decks.
Unseen card values are exactly zero with a coverage flag. All eleven
basic/snow basic names excluded. No outcome data from validation source
drafts; linked source drafts must be baseline/residual. Strict game_time
must precede validation start and not precede its source draft. Legacy
BRO/DMU/HBG/MOM/NEO/ONE/SIR/SNC use source-draft-disjoint evidence only;
exclude ambiguous source/game identities and account for invalid rows
using the benchmark's existing checks. Rarity reporting uses exact IDs
from the frozen rules snapshot; unknown rarity remains unknown and cannot
affect fitting. Powered Cube has a pinned Premier game archive, but
whether it is usable is established by the same schema and fit checks.
Traditional uses the same-set Premier outcome coefficient and strength
table; no Traditional outcomes or simulated AUC are fabricated.

One strong-cohort conditional choice refit: v6 log support offset, same
final six features, one standardized strength feature, all seven coefficients
jointly optimized with .02 penalty. No separate ordinary outcome fit or
card intercepts. Existing half-scale, independent centered clipping at
+/- .5 ln(1.25), grade ratio, 95 cap and trophy-match 100 remain unchanged.
No new variant, optimizer search or coefficient sign constraint.

## Decision

Pooled Strict Mixed (22 non-Cube formats) and Legacy Mixed (eight formats)
must each pass all of the following:
* All available per-format Premier and Traditional guardrails vs v6 pass;
  absent outcome evidence for any required non-Cube format blocks adoption.
  Cube unavailable is an explicit exception; existing non-outcome card
  term retained. Preserve existing movement cap.
* Paired outcome minus contrast AUC lower 95% >= -.002;
  outcome minus v6 AUC lower 95% > 0.
* Paired outcome minus contrast strong raw log loss upper 95% <= .005.
* Paired outcome minus contrast within-skill win correlation lower 95% >= 0.

Preserve the separate strong-only rule and compare pooled Strict AUC only
between qualifying alternatives. If its verified combined result is not
available at aggregation, report outcome-arm qualification separately and
joint selection pending; do not infer its result. If neither alternative
passes, keep contrast. If a Cube strength fit is unavailable and outcome
is selected elsewhere, Cube must retain an available non-outcome term
(strong-only if it passes its own rule, otherwise contrast). No production
writes, CI gate changes, deployments, historical regrades, or release
authorization. Win correlation is less independent than for the other arms
because strength was learned from game outcomes, despite separate sources.
All measurements are associations, not causal card or decision quality.

Public reports: all 31 formats, exact available Traditional coverage,
strict/legacy/standalone/Cube separation, prediction, outcome correlation,
guardrails, movements and leaders; card coverage by rarity and no-strength
offers; top 20 absolute per-card term differences and top 20 absolute mean
grade differences with actual public pack/prior-pool examples. Anonymous
transfer score banks and derived card statistics only; no raw rows or
source IDs published. Existing stored-production shadow and release gates
remain separate if an alternative qualifies.
