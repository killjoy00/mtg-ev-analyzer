# Corpus Operations

The authenticated `/admin/?area=corpus` area complements the existing decision-quality reports. Both require a valid Neon Auth session and `pack1_admins` membership. Guest identities and ordinary accounts cannot inspect or change corpus operations.

## Lifecycle and preservation

Every registered corpus set has one operational status: Candidate, Live, Paused or Retired. Discovery records without an ingested corpus are displayed as “Awaiting corpus.” Candidate is the non-serving staging state; its quality report explicitly distinguishes ready Candidates from blocked/incomplete ingestion. Only a ready Candidate can be promoted. A discovered archive never grants publication.

Allowed actions are Candidate → Live, Live → Paused, Paused → Live, and any non-retired state → Retired. Retirement is terminal in the admin UI. Promotion/reactivation requires passing, fresh health evidence for the serving corpus and exact manifest. A conditional update and audit insertion execute atomically; stale dashboard actions fail with 409. Events retain the administrator account ID, timestamp, previous/new status and optional reason.

No lifecycle action deletes or changes puzzles, results, shares, sessions or schedules. New games filter Live sets; existing Daily schedules and sessions resolve their pinned versions and IDs. Historical sources are retained. The destructive retirement migrations from the former product are not the production migration path for this rebuild.

`corpus_set_versions` retains manifests across model/corpus staging. The existing verified-set record is still maintained for older infrastructure, and a database trigger mirrors each version. Historical versions with no recoverable manifest are explicitly marked unavailable; missing evidence is not fabricated. Current serving eligibility cannot disappear merely because a newer manifest has been staged.

## Automated ingestion

The reviewed-main **Corpus Operations** workflow is scheduled daily and can be dispatched for development or production. It discovers official 17Lands Premier archives, checks source ETag/last-modified metadata, obtains Scryfall set identity and release date, registers non-serving Candidates, runs the qualified-trophy/context-model importer, verifies checksums and ledger accounting, loads immutable puzzles, records source dispositions and executes health verification. The workflow never promotes a set.

The workflow's code path is implemented, but operational closure requires successful end-to-end exercise against the intended environment and verification of a real Candidate/new-set lifecycle. Treat “workflow exists” separately from “new-set ingestion has been demonstrated in production.”

Existing versions are frozen: discovery records source freshness, but an updated archive does not automatically retrain a model or replace decisions in an existing corpus version. Such changes need a reviewed versioned regeneration. New-set models use the current frozen model implementation and qualified-player standard.

Completed build artifacts/checkpoints survive retries in Actions cache and artifacts. Source archives are disposable downloads; manifests, ledgers, hashes, puzzles and historical database records are retained. The importer no longer invokes historical data-purge commands.

Regular chronology comes from set release metadata and Live eligibility. Powered Cube has a separate policy. Every new regular run uses P1P1–P1P8; Cube uses P1P2–P1P9, its first eight complete archived decisions. Old selection versions retain their old windows. Older source decisions remain stored for historical/model uses.

## Premier source exclusions

The completed frozen 32-set audit verifies included Premier source outcomes against pinned archives and identifies nine blocked source trajectories. PR132 adds `corpus_source_exclusions` as an append-only operational registry. New selection and practice rerolls omit registered exclusions; historical IDs, schedules, results, shares and scoring payloads remain readable.

This mechanism is merged but not yet active in production: migration 0020 is not present there and the reviewed audit report has not been loaded. Merging the code is not equivalent to applying the exclusions.

## Traditional Candidate inventory

Traditional model-training policy and Traditional puzzle publication are independent.

The model-training experiment did not establish every pooling criterion, so Premier-only v3 remains the production grader. A separate puzzle-source workflow then evaluated qualified Traditional 3-0 trajectories with that unchanged model and no Traditional training contribution.

BLB, FIN and DFT passed the predeclared support/calibration/difficulty/source-quality gates; HOB failed. The result explicitly authorizes Candidate inventory for reviewed operational publication, not automatic serving. Production currently contains no Traditional trajectories.

If published, Traditional inventory must retain event provenance, include only individually passing sets, satisfy the applicable serving gates and enter Live state only through an authenticated reviewed action.

## Publication gates (`corpus-gates-v1`)

Thresholds are code-defined in `corpus-quality.mjs`, returned by the admin API and displayed with observed values and individual failure reasons. A check must be no older than seven days and match the exact manifest hash and gate version.

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

Premier trophies include 7–0, 7–1 and 7–2 with the existing experience/skill standard. New ledgers store wins/losses separately from immutable puzzle payloads. Imported older ledgers without losses report unknown unless subsequently covered by a pinned-source audit. Outcomes and qualified/source/included/excluded totals appear wherever recorded.
