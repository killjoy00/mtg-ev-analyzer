# Corpus Operations

The authenticated `/admin/?area=corpus` area complements the existing decision-quality reports. Both require a valid Neon Auth session and `pack1_admins` membership. Guest identities and ordinary accounts cannot inspect or change corpus operations.

## Lifecycle and preservation

Every registered corpus set has one operational status: Candidate, Live, Paused or Retired. Discovery records without an ingested corpus are displayed as “Awaiting corpus.” A newly ingested set becomes Candidate only after the complete quality report passes. Failed or unfinished imports remain discovery/import records and appear as Awaiting corpus with their blocking reasons. Candidate health can subsequently expire or fail a later check; promotion always requires current passing evidence. A discovered archive never grants publication.

Allowed actions are Candidate → Live, Live → Paused, Paused → Live, and any non-retired state → Retired. Retirement is terminal in the admin UI. Promotion/reactivation requires passing, fresh health evidence for the serving corpus and exact manifest. Freshness is a pre-flight requirement only: serving never reads health evidence, and an unchanged Live corpus is not rescanned. When an action finds evidence older than seven days, run `Corpus snapshot health check` for that one snapshot, then act. `Corpus activation serving smoke` runs daily against development and then production for every environment activated in the previous 26 hours (first publication, reactivation or snapshot switch); with no recent activation it reads only status events. It can also be dispatched for one set and expected snapshot ID immediately after an activation. It drives the production selectors (serving cache, single-set practice, pack reroll, and the Latest Set and mixed Daily when the set is the newest release) and fails unless every selected Premier decision comes from the active snapshot. It writes no sessions, schedules or results. The Candidate gameplay canary remains the pre-activation payload check. A conditional update and audit insertion execute atomically; stale dashboard actions fail with 409. Events retain the administrator account ID, timestamp, previous/new status and optional reason.

No lifecycle action deletes or changes puzzles, results, shares, sessions or schedules. New games filter Live sets; existing Daily schedules and sessions resolve their pinned versions and IDs. Historical sources are retained. The destructive retirement migrations from the former product are not the production migration path for this rebuild.

`corpus_set_versions` retains manifests across model/corpus staging. The existing verified-set record is still maintained for older infrastructure, and a database trigger mirrors each version. Historical versions with no recoverable manifest are explicitly marked unavailable; missing evidence is not fabricated. Current serving eligibility cannot disappear merely because a newer manifest has been staged.

## Automated ingestion

The reviewed-main **Corpus Operations** workflow runs daily and can be dispatched for development or production. It discovers official 17Lands Premier archives, checks source ETag/last-modified metadata, obtains Scryfall set identity and release date, records non-serving discoveries, runs the existing qualified-trophy/context-model importer, verifies checksums and ledger accounting, loads immutable puzzles, records source dispositions and executes health verification. Only passing imports become Candidate. The workflow never promotes a set to Live.

Existing versions are frozen: discovery records source freshness, but an updated archive does not automatically retrain a model or replace decisions in an existing corpus version. Such changes need a reviewed versioned regeneration. New-set models use the current frozen model implementation and qualified-player standard. Reviewed Traditional v4 playable components are a separate additive source lifecycle: stage Candidate in development, explicitly publish eligible components in development, stage the identical artifacts in production, then explicitly publish production. Production publish requires matching development publication eligibility and fails closed otherwise. Traditional data still does not train or calibrate the Premier model.

Completed rebuild checkpoints are split by storage contract: git retains manifests, ledgers, hashes, path models and other tracked outputs, while gitignored replay shards are checkpointed to the model-versioned R2 namespace and verified before each ephemeral Actions runner exits. Final validation hydrates those shards from R2 on a fresh runner before publication. Source archives remain disposable downloads; historical database records are retained. The importer no longer invokes historical data-purge commands.

Regular chronology comes from set release metadata and Live eligibility. Powered Cube has a separate policy. Every new regular run uses P1P1–P1P8; Cube uses P1P2–P1P9, its first eight complete archived decisions. Old selection versions retain their old windows. Older source decisions remain stored for historical/model uses.

## Publication gates (`corpus-gates-v2`)

Thresholds are code-defined in `corpus-quality.mjs`, returned by the admin API and displayed with observed values and individual failure reasons. A check used for promotion, activation or reactivation must be no older than seven days and match the exact manifest hash and gate version. The admin table shows a Live corpus whose last check passed as Verified however old the check is; Check needed marks an action waiting on a fresh check. The daily `Corpus health evidence report` lists waiting Candidate and Paused snapshots from metadata only, without reading puzzle payloads. See [corpus health evidence and Neon egress](ALL_TROPHY_IMPORT.md#corpus-health-evidence-and-neon-egress).

| Gate | Requirement |
|---|---|
| Archive/schema | Official archive checksum, verified schema and import signature |
| Versions | Current corpus and context-model versions match |
| Qualified trophies | At least 50 |
| Usable decisions | At least 200 within the first-eight serving windows |
| Pick coverage | At least 16 distinct source drafts at every served pick for both medium and hard bands; easy can use the existing medium fallback |
| Accounting | Manifest, trophy ledger and database counts agree |
| Trajectories | Zero invalid included puzzle trajectories |
| Exclusions | At most 25% of qualified trophies excluded; no increase over 10 percentage points versus the preceding verification |
| Card metadata | 100% of included cards have identity, name and type metadata |
| Images | 100% of included cards have HTTPS image references |
| Support | All probabilities finite, within [0,1], summing to one within 0.01 |
| Model validation | At least 200 source-held-out first-eight examples; log loss, top-1, mean rank, calibration bins; ECE ≤0.15 |

The current validation cohort is qualified trophy decisions. Its calibration summary is labeled accordingly; it is not population-wide calibration or a score-curve recommendation. Image coverage verifies resolved references, not a network fetch of every image on each run. These distinctions are visible in reports and are limitations of the operational checks.

Previously reviewed Live sets are grandfathered at migration. Missing modern health evidence is displayed and blocks a subsequent promotion/reactivation; it does not silently pause an already published corpus. Failures require diagnosis, not lowering a threshold to make a release pass.

Premier trophies include 7–0, 7–1 and 7–2 with the existing experience/skill standard. New ledgers store wins/losses separately from immutable puzzle payloads. Imported older ledgers without losses report unknown; they must not be described as audited 7–0-only data. Outcomes and qualified/source/included/excluded totals appear wherever recorded.

Custom-set practice requires complete P1P1–P1P8 coverage with at least 16 independent medium/hard sources at each position. Live sets with incomplete opening-pack archives can still contribute valid later decisions to mixed runs; they are not offered as self-contained custom-set runs. The full historical inventory is retained.


## Card-image maintenance

Card-image repair is a separate explicit corpus mutation, not part of ingestion or lifecycle promotion. It is display-only, fail-closed, and serialized with other corpus writers. Regular environments prefer ordinary/base art from the intended set; Powered Cube uses the earliest ordinary/base printing globally. An original/only special-frame printing is allowed only when no ordinary alternative exists, while avoidable cosmetic selections remain publication blockers.

Backend propagation is paged in idempotent 250-puzzle requests with an explicit cursor. Do not restore whole-environment refresh requests: large environments can exceed the authenticated import request timeout.

The guarded release deploys the same reviewed code revision to development and production before running the Pack One-wide image refresh. Live propagation must pass normalization, tests, dataset audit, exact backend-revision verification, R2 publication, development/production backend refreshes, and gameplay verification. The checked-in corpus is then published separately through a generated branch because protected `main` does not accept workflow direct pushes. An authorized operator/app opens that branch as the pull request; GitHub Actions itself is not currently allowed to create PRs in this repository.

If live propagation succeeded but the final source PR was not published, use the card-image source recovery workflow to regenerate from normalized R2 state and push a recovery branch, then have an authorized operator/app open that branch as the PR. Do not rerun a successful production backend refresh solely to recover repository bookkeeping.

See [Card image maintenance](CARD-IMAGE-MAINTENANCE.md) and [the September 23 rollout closeout](reports/CARD-IMAGE-ROLLOUT-CLOSEOUT-2026-09-23.md).


## Supplemental Traditional components

Current v4 supplemental identities are `traditional-premier-v4-phase2-v1` for regular environments and `traditional-cube-p2p7-v4-v1` for Powered Cube. They are pinned to parent `elite-trophy-colour-stage-v8` and model `strong-player-colour-stage-v4`.

Component publication is parent-aware. A ready component under a Live parent can move Candidate -> Live; a ready component under a Candidate parent remains Candidate. In the September 21 release this leaves SIR staged but non-serving. HBG, HOB, KTK and PIO failed the reviewed regular v4 admission gates and have no v4 component. Powered Cube v4 serves only P1P2-P1P7.

Live Traditional components extend the same environment-level serving universe as retained Premier inventory. They do not replace the Premier parent or create a separate player-facing Traditional mode. Current new games use Live components only; existing schedules and sessions keep their pinned IDs and remain readable regardless of later component status.

The complete September 21 release evidence, including the safe blocked production publish that exposed the required development-publication prerequisite, is in [Traditional v4 production release closeout](reports/TRADITIONAL-V4-RELEASE-2026-09-21.md).

## Serving score floor

The owner’s September 19 update excludes new puzzles whose trophy choice has an implied model score below 20. The formula is the same rounded integer partial-credit calculation: `round(95 × trophy raw support / maximum raw support)`. A rounded score of 20 qualifies. Missing evidence fails closed. This is a selection filter, not a change to the model, probability calibration, corpus payloads, difficulty ratings or trophy-100 scoring. The version `trophy-implied-score-20-v1` is pinned on new sessions/schedules; shared recipients inherit the original run’s version. Earlier schedules and runs retain `legacy-interesting-v1` and their exact decisions. Rerolls select only currently eligible replacements.

The Corpus area uses a searchable, sortable table with serving status, release chronology, actual post-filter serving counts, exclusions below 20, health and import state. Selecting a set opens detailed archive/model evidence, per-pick coverage, source-component admission, quality gates and authenticated status controls.
Full verification checks ordered prior-pool inheritance across all retained decisions in each source. Source exclusions are retained in accounting but excluded from newly playable coverage and probability diagnostics. Frozen v7 manifests predate the explicit schema flag: their exact input signature, source checksum, source/draft accounting and successful loss-aware 32-set archive audit provide separate recorded source evidence; manifests are not relabeled or rewritten. Probability diagnostics use the frozen v3 display calibration (1.75), report raw log loss separately, and never change the partial-credit curve. A reviewed full-health workflow can refresh reports without discovery, reimport or Live publication.

The v2 gates count only decisions meeting the new serving score floor for usable/pick coverage. Historical fingerprint variants are reported separately: the baseline and full importer used different serialization/scope recipes and preserved prior rows, while source identity, actual prior-pool inheritance and pick ordering are independently checked. A fingerprint difference alone is not a broken trajectory.

The September 19 full-corpus scan found six card identities with missing type metadata. `corpus/card-metadata-repairs.json` records exact Scryfall identities and source links; the public-puzzle mapper supplies only a missing type line. Frozen stored cards, images, supports and grades are not rewritten. Health reports distinguish stored metadata coverage from effective display coverage and count repaired occurrences. Future ingestion re-fetches incomplete metadata even when an image was already cached.
