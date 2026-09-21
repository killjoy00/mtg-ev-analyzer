# Traditional playable-puzzle admission — v4 revalidation protocol

Predeclared 2026-09-21 before the corrected-model remeasurement.

## Question

Which Traditional Draft puzzle sources tested by the 2026-09-18 Phase 2 study still satisfy the **same frozen admission gates** when scored by the leakage-corrected Premier-trained model `strong-player-colour-stage-v4` used by `elite-trophy-colour-stage-v8`?

This is a source-admission revalidation. It is not a model-training experiment and it does not authorize production publication.

## Historical evidence preserved

The prior experiment remains immutable historical evidence:

- model: `strong-player-colour-stage-v3`
- parent corpus: `elite-trophy-colour-stage-v7`
- protocol: `research/TRADITIONAL-PHASE2-PROTOCOL.md`
- all-environment run: GitHub Actions run `35386149822`
- historical Phase 2 component: `traditional-premier-v3-phase2-v1`
- historical restricted Cube component: `traditional-cube-p2p7-v3-v1`

No v3 artifact, component, score, game, schedule, or stored puzzle payload is rewritten by this study.

## Corrected production evidence pin

The corrected grader is pinned to the completed all-environment production import:

- GitHub Actions run: `35646313155`
- artifact: `verified-premier-trophies-35646313155-1`
- artifact id: `10661300487`
- parent corpus: `elite-trophy-colour-stage-v8`
- model: `strong-player-colour-stage-v4`
- environments: 32
- production validation reported: 1,007,730 puzzles and 32 complete full-import environments

The revalidation workflow downloads that immutable artifact and requires every selected environment manifest to identify v8/v4 before measurement.

## Frozen scope

Re-evaluate exactly the original Phase 2 testable environments:

`hob, msh, sos, eoe, fin, tdm, dft, fdn, dsk, blb, mh3, otj, mkm, ktk, lci, woe, ltr, mom, one, bro, dmu, snc, neo, hbg, sir, pio, powered-cube`

Preserve the original pre-measurement exclusions:

- TMT, ECL, TLA — Phase 1 did not establish a complete current-product Traditional trajectory cohort.
- MID, VOW — no public TradDraft draft archive in the original source study.
- STX — public TradDraft evidence did not satisfy the current skill-bucket/source requirements and the environment is retired.

No environment is added or removed after seeing v4 results.

## Frozen gates

The gate constants are imported directly from `scripts/traditional_puzzles.py`; the new runner does not define alternative thresholds.

For each environment, and separately for the original late window and production-interesting/servable subsets:

| Check | Frozen limit |
| --- | --- |
| Independent source trajectories | >=100 per event |
| Top-choice confidence ECE | <=0.15 and Traditional increase <=0.04 |
| Trophy/model disagreement increase | 95% source-bootstrap upper bound <=10 percentage points |
| Trophy raw-support score under 25 increase | upper bound <=3 percentage points |
| Mean trophy support-only score decline | lower bound >=-8 points |
| Non-trophy alternatives under 25 increase | upper bound <=5 percentage points |
| Non-trophy alternatives at 95 change | complete interval inside +/-5 percentage points |
| Difficulty-band distribution total variation | <=0.15 |
| Complete Traditional trajectories unusable for source/pack/metadata/image reasons | <=5% |

Bootstrap remains deterministic, 500 draws, by whole source draft.

Residual blocking remains the original rule: a directionally consistent >=3 percentage-point category residual whose interval excludes zero in at least three compatible environments blocks automatic expansion pending investigation.

## Exact v4 construction

For each environment:

1. Read the pinned v8 import manifest and verify its source archive, game/skill archive, training cap, cohort counts, model identity and input signature.
2. Re-download the exact official Premier draft and game archives and require their SHA-256 and compressed byte lengths to match the v8 manifest.
3. Reconstruct the strong-player cohort with the production cap and cutoff rules.
4. Build five fold models with `collect_isolated`, `build_fold_training`, and `build_colour_tables_by_fold`.
5. For each fold, exclude its held IDs **before** direct counts, base tendencies, pair expectations, priors/fallbacks, colour tables and stage references are constructed.
6. Reject any shared/prebuilt deck fit. Every colour/stage table comes from the fold's permitted Premier IDs.
7. Reproduce v8 Premier puzzle probabilities at six decimals for the serving-window decisions before using the grader for Traditional evaluation.
8. Score Traditional trajectories only as evaluation data. Traditional IDs, picks, decks, outcomes and colour evidence never enter Premier model construction.

The runner records the production input signature, v8 manifest checksum, implementation hashes, and all five fold training-ID signatures.

## Powered Cube

Do not fabricate P1P1. The public archive semantics remain P1P2 as the first complete visible decision with the historical P1P1 card already in pool context.

Measure all of the following with the same frozen gates:

- P1P2–P1P9, matching the original full-window experiment;
- P1P2–P1P7, matching the previously owner-approved restricted window;
- the production-interesting/servable subset of P1P2–P1P7;
- P1P8–P1P9 together;
- P1P8 separately;
- P1P9 separately.

A changed Cube result is a research finding, not publication authorization.

## Candidate artifacts

Research output uses new immutable identities:

- regular/full-window research component: `traditional-premier-v4-phase2-v1`
- restricted Cube release candidate, if and only if its frozen v4 gates pass: `traditional-cube-p2p7-v4-v1`

Every candidate manifest must say:

- parent corpus `elite-trophy-colour-stage-v8`;
- model `strong-player-colour-stage-v4`;
- model source event `PremierDraft`;
- source event `TradDraft`;
- publication authorized: false.

Old v3 components remain readable and unchanged. No loader may relabel a v3 component as v4.

## Format-training study audit

The separate four-set Premier/Traditional model-training study is not rerun merely because v4 exists. Its implementation is audited independently:

- draft split is source-draft-level train/validation/test;
- only train IDs feed pick counts, pair expectations, first-game decks, colour evidence and model fitting;
- validation chooses calibration/temperature/event-weight parameters;
- test drafts are skipped during fitting and are scored only after the fit is complete.

If those implementation properties remain true, issue #164 does not invalidate that study because the held validation/test drafts never contribute to their own model inputs. The prior conclusion — retain Premier-only training because the predeclared pooling criteria were not established — remains valid evidence. If any of those properties fail during the audit, the report must mark the old training result invalid rather than silently relying on it.

## Publication boundary

This workflow is research-only. It has no production database credentials and does not publish components, change schedules, rewrite historical puzzles, or alter stored scores.

Passing v4 sources may be packaged as Candidate artifacts and validated against release loaders. Production publication still requires a separate explicit owner authorization.

## Required report

The consolidated report records, for every original environment:

- old v3 result;
- new v4 result;
- changed/not changed;
- qualified Traditional trajectories and usable decisions;
- all, late, servable and servable-late gate details;
- calibration;
- disagreement/support/alternative/difficulty diagnostics;
- residuals and serving-floor effect;
- exact failed gate names.

It also classifies results factually as:

1. previously passing and still passing;
2. previously passing but now failing;
3. previously failing but now passing;
4. still failing;
5. insufficient/unavailable evidence.

Excluded environments remain listed separately. Passing results do not themselves authorize promotion.
