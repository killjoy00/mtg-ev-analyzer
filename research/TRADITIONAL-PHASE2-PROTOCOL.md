# Traditional puzzle expansion — Phase 2 frozen-Premier protocol

Predeclared 2026-09-18 before the all-environment Phase 2 measurement.

## Question

For every environment that passed Phase 1 availability, can qualified Traditional 3-0 trophy trajectories be used as playable Pack One puzzle sources without changing the existing Premier-trained v3 grader?

This is a puzzle-source experiment. It is **not** a model-training experiment. Traditional data contributes no training picks, decks, colour estimates, pair counts, calibration fits, or model selection.

## Fixed scope

Phase 2 environments:

`hob, msh, sos, eoe, fin, tdm, dft, fdn, dsk, blb, mh3, otj, mkm, ktk, lci, woe, ltr, mom, one, bro, dmu, snc, neo, hbg, sir, pio, powered-cube`.

Excluded before measurement because Phase 1 did not establish a usable current-product cohort:

- TMT, ECL, TLA: qualified Traditional trophies exist, but no complete P1P1-P1P8 public trajectory.
- MID, VOW: no public TradDraft draft archive.
- STX: public TradDraft archive lacks the current skill-bucket fields and the environment is retired.

No threshold or product-window change will be made after seeing Phase 2 results to admit an excluded environment.

Candidate/Retired lifecycle status remains independent of research results. HBG/SIR/PIO may contribute evidence but do not become Live from this workflow.

## Frozen grader

For each environment:

1. Download the immutable verified v7 artifact used by the existing production release.
2. Read that environment's exact source archive hashes, training cap, input signature, model version and frozen puzzle checksum.
3. Reconstruct the historical Premier-only v3 model from the pinned Premier draft/game archives.
4. Require exact six-decimal probability parity for every immutable v7 decision in the environment's eight-decision serving window.
5. Stop that environment on any parity mismatch.

Regular environments use P1P1-P1P8. Powered Cube uses P1P2-P1P9 because public Cube data omits the complete P1P1 pack while preserving the real P1P1 card in P1P2 pool context.

The current stricter loss-aware Premier eligibility audit is applied separately from frozen model reconstruction. Invalid/unverified Premier trophy sources are not used in the comparison cohort. Historical puzzle payloads are never rewritten.

## Traditional cohort

Traditional sources must:

- be TradDraft 3-0 trophies,
- satisfy the existing >=100 games and top-15%-with-0.60-floor strong-player rule,
- have consistent source metadata,
- contain a complete internally consistent eight-decision serving trajectory.

Every qualifying complete Traditional source is unseen by the frozen Premier model.

For Powered Cube, additionally require:

- Premier and Traditional public archives belong to the same late-2025 Cube snapshot family,
- identical draft card-column universe,
- P1P2 is the first complete visible decision,
- its pool contains exactly the historical P1P1 card,
- P1P2-P1P9 is complete and contiguous.

Failure of these Cube checks is a data/snapshot failure, not evidence that Traditional drafting differs.

## Unchanged gates

Apply the existing Phase 2 gates per environment, and separately to the last two serving decisions (P1P7-P1P8 for regular sets; P1P8-P1P9 for Powered Cube):

| Check | Limit |
| --- | --- |
| Independent source trajectories | >=100 in each event |
| Top-choice confidence ECE at existing display exponent | <=0.15 and Traditional increase <=0.04 |
| Trophy/model disagreement increase | 95% source-bootstrap upper bound <=10 percentage points |
| Trophy raw-support score under 25 increase | upper bound <=3 percentage points |
| Mean trophy support-only score decline | lower bound >=-8 points |
| Non-trophy alternatives under 25 increase | upper bound <=5 percentage points |
| Non-trophy alternatives at 95 change | entire interval within +/-5 percentage points |
| Difficulty-band distribution total variation | <=0.15 |
| Otherwise complete Traditional trajectories unusable due to pack/metadata/image quality | <=5% |

Apply the same gates to the production-interesting/servable subset and its late picks.

The actual historical trophy choice always remains 100. Score-only diagnostics omit the trophy override only to measure model support.

Bootstrap by whole source draft using the existing deterministic 500-draw procedure.

## Residuals and regression checks

Repeat matched residual analysis by card, set, pick range and colour commitment. A directionally consistent >=3 percentage-point category residual whose interval excludes zero in at least three environments blocks automatic expansion pending investigation.

Powered Cube participates in card-level residuals; cross-set card-category persistence is evaluated on environments with compatible set metadata.

The generalized pipeline must reproduce the already measured reference decisions:

- BLB: pass
- DFT: pass
- FIN: pass
- HOB: fail

If any reference result changes, the all-environment Phase 2 report is invalid until the discrepancy is explained.

## Output and authority

Each environment emits:

- exact parity count,
- Premier source audit,
- Traditional cohort/accounting,
- all/late/servable/servable-late gate results,
- quality result,
- immutable Traditional Candidate puzzles and trophy ledger,
- archive/model/component signatures.

The summary reports individually passing environments, failures and reasons, regression status, persistent residual patterns, total candidate inventory and Powered Cube separately.

All output is Candidate-only research evidence. The workflow has no database credentials and performs no publication, corpus mutation, model deployment, scoring rewrite, schedule change, or production write.
