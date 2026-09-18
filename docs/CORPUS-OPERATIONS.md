# Corpus Operations

The authenticated `/admin/?area=corpus` area complements the existing decision-quality reports. Both require a valid Neon Auth session and `pack1_admins` membership. Guest identities and ordinary accounts cannot inspect or change corpus operations.

## Lifecycle and preservation

Every registered corpus set has one operational status: Candidate, Live, Paused or Retired. Discovery records without an ingested corpus are displayed as “Awaiting corpus.” A newly ingested set becomes Candidate only after the complete quality report passes. Failed or unfinished imports remain discovery/import records and appear as Awaiting corpus with their blocking reasons. Candidate health can subsequently expire or fail a later check; promotion always requires current passing evidence. A discovered archive never grants publication.

Allowed actions are Candidate → Live, Live → Paused, Paused → Live, and any non-retired state → Retired. Retirement is terminal in the admin UI. Promotion/reactivation requires passing, fresh health evidence for the serving corpus and exact manifest. A conditional update and audit insertion execute atomically; stale dashboard actions fail with 409. Events retain the administrator account ID, timestamp, previous/new status and optional reason.

No lifecycle action deletes or changes puzzles, results, shares, sessions or schedules. New games filter Live sets; existing Daily schedules and sessions resolve their pinned versions and IDs. Historical sources are retained. The destructive retirement migrations from the former product are not the production migration path for this rebuild.

`corpus_set_versions` retains manifests across model/corpus staging. The existing verified-set record is still maintained for older infrastructure, and a database trigger mirrors each version. Historical versions with no recoverable manifest are explicitly marked unavailable; missing evidence is not fabricated. Current serving eligibility cannot disappear merely because a newer manifest has been staged.

## Automated ingestion

The reviewed-main **Corpus Operations** workflow runs daily and can be dispatched for development or production. It discovers official 17Lands Premier archives, checks source ETag/last-modified metadata, obtains Scryfall set identity and release date, records non-serving discoveries, runs the existing qualified-trophy/context-model importer, verifies checksums and ledger accounting, loads immutable puzzles, records source dispositions and executes health verification. Only passing imports become Candidate. The workflow never promotes a set to Live.

Existing versions are frozen: discovery records source freshness, but an updated archive does not automatically retrain a model or replace decisions in an existing corpus version. Such changes need a reviewed versioned regeneration. New-set models use the current frozen model implementation and qualified-player standard. Traditional data remains outside production pending the separate research decision.

Completed build artifacts/checkpoints survive retries in Actions cache and artifacts. Source archives are disposable downloads; manifests, ledgers, hashes, puzzles and historical database records are retained. The importer no longer invokes historical data-purge commands.

Regular chronology comes from set release metadata and Live eligibility. Powered Cube has a separate policy. Every new regular run uses P1P1–P1P8; Cube uses P1P2–P1P9, its first eight complete archived decisions. Old selection versions retain their old windows. Older source decisions remain stored for historical/model uses.

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

Premier trophies include 7–0, 7–1 and 7–2 with the existing experience/skill standard. New ledgers store wins/losses separately from immutable puzzle payloads. Imported older ledgers without losses report unknown; they must not be described as audited 7–0-only data. Outcomes and qualified/source/included/excluded totals appear wherever recorded.

Custom-set practice requires complete P1P1–P1P8 coverage with at least 16 independent medium/hard sources at each position. Live sets with incomplete opening-pack archives can still contribute valid later decisions to mixed runs; they are not offered as self-contained custom-set runs. The full historical inventory is retained.

Full verification checks ordered prior-pool inheritance across all retained decisions in each source. Source exclusions are retained in accounting but excluded from newly playable coverage and probability diagnostics. Frozen v7 manifests predate the explicit schema flag: their exact input signature, source checksum, source/draft accounting and successful loss-aware 32-set archive audit provide separate recorded source evidence; manifests are not relabeled or rewritten. Probability diagnostics use the frozen v3 display calibration (1.75), report raw log loss separately, and never change the partial-credit curve. A reviewed full-health workflow can refresh reports without discovery, reimport or Live publication.
