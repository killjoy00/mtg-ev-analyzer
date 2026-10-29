# Context challenger contrasts: preregistration

Status: frozen before scoring any new arm or pairwise contrast. Append findings only below `## Results`; never rewrite the design after inspecting outcomes. This is a secondary pick-prediction experiment, not a decision-quality or release gate.

## Arms

The `v5`, `splash`, `explicit` and `explicit-fixing` definitions in [CONTEXT-CHALLENGERS.md](CONTEXT-CHALLENGERS.md) are unchanged. All use the uncapped harness train split, `v3-colour-and-pair` backbone, temperature 1.0 and independently refitted commitment, stage and marginal tables. Counts, pair expectations and evaluation decisions are shared.

Add `explicit-matched`: start with `explicit`, then make a card unknown wherever `v5` has no color judgment (absent or `None`). The known-empty flexible value counts as a v5 judgment. For supported spells use printed cast colors; supported lands are flexible, exactly as in `explicit`. Unsupported metadata retains the known v5 value. This holds the set of cards eligible for a color judgment equal to v5, including prior-pool cards, and separates explicit representation from expanded coverage. The fit can still differ because its commitment observations are refitted. No hybrid arm is included.

## Data

FRA, HOB, MSH, SOS, ECL and TMT validation results have already been seen. All their new results are development-only and cannot count toward any verdict. First reproduce the four existing arms' committed outputs on these six sets, without changing them.

Fresh confirmation is the next five most recent `category: expansion` entries by descending `source_date` in the inherited `corpus/draft-run/catalog.json`, after HOB/MSH/SOS/ECL/TMT:

| Set | Catalog source date |
| --- | --- |
| TLA | 2026-01-10 |
| EOE | 2025-09-03 |
| FIN | 2025-07-19 |
| TDM | 2025-05-20 |
| DFT | 2025-03-23 |

Use official 17Lands PremierDraft draft/game archives and checksum-pinned card metadata. Record SHA-256 for both archives, metadata and cache identity. Raw archives/caches remain ignored. Default extraction cohort is at least 100 games and the top 15% win-rate bucket. Train on the harness training split; score only validation, Pack 1 picks 1–11. The test split is reserved: do not score, inspect examples from it, tune against it or report its performance. Archive extraction may mechanically serialize it, as in the existing harness.

No set substitutions after seeing results. A source/checksum failure leaves the comparison incomplete until the pinned data is available. Describe these sets as fresh for these contrasts, not as never previously used anywhere in the repository.

## Contrasts and metrics

Every unordered pair among the four non-v5 arms is preregistered, in this fixed order: `splash`, `explicit`, `explicit-fixing`, `explicit-matched`. There are six comparisons. Each stored comparison is the later arm minus the earlier arm; negative log loss favors the later arm. Report v5-reference comparisons separately.

Primary metric: served-slice log loss. Guardrail: top-1 accuracy. Use the harness `paired_bootstrap` on identical decisions, clustering by draft, 2,000 draws and seed 20260915. Report 95% intervals. Also report Brier score, leader changes, mean absolute model-only point changes and color-judgment coverage; these do not determine the verdict.

## Frozen decision rule

A beats B in this secondary check if A minus B has a log-loss interval strictly below zero on at least four of the five fresh confirmation sets, and its top-1 interval is strictly below zero on none. Apply the same symmetric rule for B beating A; otherwise report inconclusive. A zero boundary is not significant. Missing results mean incomplete, not inconclusive or a win. The harness's five-decimal interval endpoints are the decision inputs, as in the previous experiment.

Six pairs across five sets create multiple comparisons. The intervals are pointwise and not adjusted for family-wise error; the cross-set consistency rule does not turn them into simultaneous 95% guarantees. Report every comparison, not just favorable ones. No omnibus winner is selected unless one arm beats all other non-v5 arms under the frozen rule. Do not choose by pooled point estimates or add a hybrid after seeing outcomes. Even a winner establishes pick-prediction evidence only, not contextual fairness, causal win value or release readiness.

## Validation and reporting

- Existing four-arm results must reproduce the committed six-set JSON, excluding file-encoding-dependent cache byte hashes if caches must be regenerated; source archive hashes, training ID identity and all numeric results must match. Document any unavoidable cache-byte difference rather than silently ignoring it.
- Keep the guard proving the deck scan reproduces the harness table.
- Synthetic tests cover the matched-coverage mask, unsupported metadata, all six pairs, contrast direction and decision-rule boundaries.
- Commit aggregate-only JSON containing every source checksum and preregistration commit. Generate result tables from JSON and verify them programmatically. Keep player/draft-level rows out of public outputs.
- Do not change production models, point formulas, data, gates or release protections.

## Results

Pending. No new scoring has run at this preregistration commit.
