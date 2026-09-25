# Traditional puzzle admission and publication

Current production status updated September 21, 2026. Historical September 18 v3 evidence is retained below rather than rewritten.

## September 21 v4 release

Issue #164's held-fold stage-reference dependency was corrected in the separately versioned v8/v4 build. Traditional admission was then revalidated against the leakage-corrected Premier-trained `strong-player-colour-stage-v4` grader without using Traditional rows for model training or calibration.

The current additive component identities are:

- regular: `traditional-premier-v4-phase2-v1`
- Powered Cube: `traditional-cube-p2p7-v4-v1`

Both are pinned to Premier parent `elite-trophy-colour-stage-v8`. Historical v3 components remain readable and retain their original v3 model identity.

The v4 regular revalidation passed the same 22 environments as the historical Phase 2 decision: MSH, SOS, EOE, FIN, TDM, DFT, FDN, DSK, BLB, MH3, OTJ, MKM, LCI, WOE, LTR, MOM, ONE, BRO, DMU, SNC, NEO and SIR. HBG, HOB, KTK and PIO remain blocked. There were no regular v3-to-v4 admission flips.

Production publication is complete. Twenty-one regular v4 components are Live; SIR remains Candidate because its parent environment is Candidate. Powered Cube v4 is Live only for P1P2-P1P7. Traditional P1P8/P1P9 remain excluded.

Publication is supplemental, not a replacement or separate mode. For eligible regular environments, current new-game selection can draw Live Traditional or retained Premier puzzles from the same serving universe under the ordinary set, pick, difficulty, source-uniqueness and serving-quality rules. Powered Cube Traditional inventory joins only the Powered Cube environment.

The reviewed lifecycle is development stage -> development publish -> production stage -> production publish. Production publish requires matching development publication eligibility; a development Candidate under a Live parent must block production publication. This prerequisite stopped run 35678284122 before production mutation and was preserved rather than weakened.

Final accepted runs:
- development stage: 35675750660 (regular), 35676281911 (Cube)
- production stage: 35677378980 (regular), 35678122885 (Cube)
- development publish: 35678556011 (regular), 35678774912 (Cube)
- production publish: 35679143746 (regular), 35679407781 (Cube)
- complete fail-closed promotion chain: 35678538754

All final preservation, serving-quality, Daily coverage and Cube historical-selection checks passed. See [Traditional v4 production release closeout](reports/TRADITIONAL-V4-RELEASE-2026-09-21.md) for the full evidence trail.

## Historical September 18 v3 admission record

Puzzle sources and model training are independent. Keep the frozen Premier-trained v3 evidence, coefficients, display calibration and linear partial-credit curve. The observed trophy decision always earns 100; alternatives remain capped at 95.

## Powered Cube priority decision

The owner approved a restricted P2–P7 admission after reviewing Phase 2. This is a subsequent product decision, not a claim that the original P2–P9 protocol passed. The excluded P8–P9 late window fails its predeclared disagreement gate; P8 and P9 also fail separately. No thresholds were relaxed and no new individual-pick selection rule was invented.

The pinned research artifact is [10564446647, run 35386149822](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/35386149822), from research revision `8fbedc3ac1962874cb00d84a1e40796dfdf16b68`. Both public archives belong to 1 December 2025 and have the same 545 card columns. The Premier grader reproduced all 9,344 stored serving-window supplement decisions exactly. Traditional contributes no training or calibration data.

`prepare-cube-admission.py` verifies frozen file hashes and re-evaluates the unchanged gates on the existing measurements. The whole P2–P7 window and its actual interesting subset both pass. It converts 220 qualified 3–0 trajectories into **1,320 decisions, 1,295 interesting**. Qualification remains at least 100 games and the existing event-specific strong cohort (0.64 for this archive). The real first card stays in P2 context. Metadata and HTTPS image references are complete.

The converter excludes Traditional P8/P9 entirely from database import. Premier puzzles remain untouched at P2–P9. New Cube runs retain eight decisions, source uniqueness and ordinary difficulty selection. At P2–P7 both sources share one set/pick/difficulty pool; P8/P9 contain only the retained Premier inventory. There are no event-type quotas, weights or fallback branches in the selector. Event type is operational provenance.

[Reproducible admission measurements](../results/rebuild-2026-09-18/CUBE-P2P7-ADMISSION.json) include rejected late-pick evidence. Images are verified as complete references, not a promise that every third-party host will always respond.

## Regular source decision

BLB, DFT and FIN pass the separate frozen-model puzzle gates, including late and interesting subsets. Together they provide 2,907 complete qualified trajectories and 23,256 potential decisions. HOB fails low-support-tail uncertainty gates and stays outside Candidate publication. Exact support parity covers 87,271 decisions for the three passing sets; the four-set total is 91,511. The earlier email's reference to 87,271 across four sets was a wording error.

## Additive architecture and publication

Versioned source components extend the retained v7 parent corpus independently of the model. `traditional-cube-p2p7-v3-v1` is the restricted Cube component; `traditional-premier-v3-v1` identifies the original regular study. Existing Premier manifests and payloads are not copied or replaced. Source hashes include event identity; all source trophies, exclusions and fingerprints remain traceable.

Import validates complete trajectories, qualification, support normalization, artifact checksums, frozen model signatures, metadata/images and accounting before mutation. Only passing sources enter Candidate. Failed research sources are visible as blocked before Candidate. Publication requires a separate authenticated administrative action and a fresh passing report for the exact manifest; parent set must be Live. Pause/retirement affects only newly generated inventory.

Schedules and sessions retain exact IDs, parent version and component snapshots. Historical reads allow retained components regardless of current publication state; current generation uses Live components only. Existing Dailies are never regenerated. Admin decision measurements add source-event groups for score distributions, trophy matches and abandonment; the original decision-quality reports remain intact.

## Premier source audit

The full pinned 32-environment audit verifies **93,752** legal sources: 12,499 at 7–0, 32,631 at 7–1 and 48,622 at 7–2. Nine archived 7–3 records were admitted by the older wins-only importer (FIN 1, OTJ 1, DFT 2, TDM 2, ECL 1, FDN 2), representing 97 retained decisions across their original windows. Reviewed exclusions prevent new selection without deleting or rescoring old decisions. The current importer verifies losses and source consistency. [Machine-readable audit](../results/rebuild-2026-09-18/frozen-premier-outcomes.json).

### Administrative release automation

The separate `publish-puzzle-components.yml` workflow supports explicit staging and publication requests on reviewed main. It uses the existing Neon administrative credential and verifies a GitHub-signed OIDC token restricted to this repository, main, this exact workflow and the publication audience. It does not impersonate a Neon Auth user. Audit rows retain the workflow, subject, initiating actor, run and SHA separately from app-admin account IDs. Public admin routes still require a valid Neon Auth admin session. Staging cannot publish; a subsequent explicit publication request must pass the same exact-manifest health and lifecycle checks. Production additionally requires matching verified development inventory, Live for publication. Each operation checks existing Premier Cube payload hashes and universal Daily contents before and after.
