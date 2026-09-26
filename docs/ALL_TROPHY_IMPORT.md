# Complete Premier trophy import

The canonical importer is `scripts/import_all_trophies.py`. The former trophy extractor intersected archive IDs with `data/<set>/shards`, limiting trophy coverage to the 300-replay sample. Those shards remain appropriate for the older replay modes; they must never select Draft Run's trophy population.

## Reproduce and load

```sh
python scripts/import_all_trophies.py --sets all --workers 3
node scripts/load_all_trophies.mjs unused generated/trophy-import --validate-only
node scripts/load_all_trophies.mjs /path/to/development.connection generated/trophy-import
# Verify the development backend, then use the production connection.
```

`all` discovers PremierDraft links from the same official CMS document used by https://www.17lands.com/public_datasets. It does not use our local set catalog to choose what to scan. Powered Cube stays a separate environment. Other event types are excluded. Environments with no public draft archive are reported in `discovery.json`. A newly discovered environment is imported, but the loader requires serving-catalog registration before exposing its puzzles.

Every source draft is examined. Every seven-win draft gets a ledger entry with qualification and inclusion status, counts of included and skipped decisions, and reasons. Modern qualifications remain at least 100 prior games and the elite cutoff (at least .60, no lower than the existing set threshold). Legacy qualifications use actual earliest-game Diamond/Mythic rank plus 100 prior games. Unknown experience, outcome conflicts, and failed joins never qualify. Permanently retired environments are filtered before discovery output, downloads, or qualification.

Output is uncapped. Training remains independently selected from the broader elite cohort, capped at 5,000 drafts with five-fold holdout by draft ID. A trophy does not need to be in that training cohort or in the replay sample. No scoring formula changes.

Each output decision has a source-verified contiguous opening history, exact historical choice and pack identities, and an HTTPS image for every candidate and prior pick. Missing later picks do not discard a valid earlier prefix. Missing images exclude affected decisions, with exact unresolved names retained for remediation. No fuzzy card substitutions are allowed.

After every requested set has loaded and passed accounting, the loader refreshes PostgreSQL statistics for the two serving tables' scalar metadata columns, then verifies their presence. This runs once per completed import, not per batch or player request. It excludes large JSON payloads and changes no puzzle, score, schedule or selection rule. A failed refresh fails the load command; rerun the idempotent loader after correcting the cause. Automatic analyze alone did not populate the defaulted `pack_number` column after its migration. See [serving maintenance](BACKEND-RELIABILITY.md#planner-statistics).

## Persistence and resume

Raw archives, image caches, and per-set checkpoints live under `generated/trophy-import`. Archive cache reuse verifies remote ETag, size, and local SHA-256. A checkpoint also binds source/game archives, importer/model code, baseline manifest, and supplemental card metadata. Changed inputs rebuild the set. `--refresh` forces a rebuild. Interrupted artifacts fail checksum validation and are rebuilt; successful sets are reusable.

Each set produces `manifest.json`, `puzzles.jsonl.gz` (additional decisions), and `trophies.jsonl.gz` (all trophy dispositions). The final catalog is complete only when every requested archive succeeds. `discovery.json` records the official source inventory, including unavailable archives. The manually dispatched GitHub Actions workflow preserves all output manifests, image caches, decision files, and ledgers as a downloadable artifact for 90 days, including partial diagnostic output after failure.

The existing v6 corpus is an immutable baseline. Its decisions are reverified against source and preserved with the same payloads, IDs, scores, schedules, and challenge links. The new loader validates every file and all ledger/decision counts before writing. It streams bounded batches, refuses conflicting existing payloads, and only inserts additional puzzles. Reruns are idempotent. It records each completed set's import manifest in `draft_run_verified_sets.manifest.full_import`; the database is the durable serving copy. On a new empty database, load the checked-in baseline first, then these supplements.

The old backend reads all interesting decision metadata using keyset pagination. PR #84 replaces the runtime full-pool download with bounded SQL selection over the same eligible population; see [serving implementation and deployment status](BACKEND-RELIABILITY.md). The exhaustive loader remains an offline reference. Browsers still receive only the current unanswered puzzle. A complete archive import is not a claim that every source trophy is high quality or renderable: use qualified, included, and exclusion counts in the report.

## Verification

Run `npm test` with required replay shards in CI, validate artifacts with the loader, and load development first. Verify per-set counts, old-payload preservation, rerun idempotency, backend health and mixed/Cube starts, rerolls and completions. Measure cold/warm serving at the expanded size for the function version actually being deployed. Keep the import report alongside release evidence. The old `extract_trophy_evidence.py` and `build_verified_trophy_corpus.py` commands reproduce only the frozen baseline and are not the complete importer.


## Corpus health evidence and Neon egress

Health evidence is a pre-flight inspection, not a heartbeat. Serving reads only the environment status and its `active_snapshot_id`; it never reads health rows, so a Live corpus keeps serving however old its last check is. Evidence younger than seven days, for the exact manifest and gate version, is required only when an administrator acts: activating a Candidate snapshot, publishing a Candidate environment for the first time, or returning a Paused environment to Live. Source snapshots are immutable, so an unchanged snapshot is never rescanned on a timer.

- **New snapshot:** Corpus Operations deep-scans it once, immediately after ingestion. Activating within seven days needs no second scan.
- **Older evidence at activation or reactivation:** the admin gate refuses the action. Run `Corpus snapshot health check` (`.github/workflows/corpus-health-refresh.yml`) with the exact `snapshot_id` shown in the admin Corpus area or the evidence report, then act. It is manual only and scans exactly one snapshot.
- **Evidence report:** `Corpus health evidence report` (`.github/workflows/corpus-health-report.yml`) runs daily against production. It reads snapshot, policy and health metadata only, never puzzle payloads, and never writes. Waiting Candidate and Paused snapshots whose evidence is stale, failed, or expiring within 48 hours are listed in the run summary and as warnings; old evidence on Live snapshots is informational. The run does not fail because evidence is old.
- **Image refresh:** it may change only display fields, requires HTTPS images, and cannot blank a stored type line, so it cannot change any health gate and does not invalidate evidence. Current-version source exclusions have no automated writer; the frozen audit loader writes only its own historical corpus version.
- **Gate or serving-policy code change:** a new gate version makes all evidence non-current. Run `Reviewed full corpus health` once, deliberately.

No scheduled workflow deep-scans retained corpus payloads; recurring payload egress is limited to newly ingested sets. `tests/corpus-operations-egress.test.mjs` enforces that contract.

`Reviewed full corpus health` remains a manual-only workflow. Use it when an operator intentionally wants a complete deep audit; do not add a schedule to it.

## Unattended operation

After an owner explicitly dispatches **Run workflow**, GitHub Actions performs the entire backfill without an AI session: discover all archives, import, validate, load development, complete mixed/Cube practice smoke tests, load production, and test production. It does not trigger on importer code pushes. It saves archive checkpoints in Actions cache and the compact results as 90-day artifacts; database rows and per-set completion manifests persist in Neon. Failed validation blocks later steps, and idempotent inserts make rerunning safe. Repository owners can follow the job summary and GitHub's normal failure notifications. The separately scheduled legacy replay backlog is a different workflow, documented in the repository README.

Actions does not receive a database password. `/v1/trophy-import` accepts only a GitHub-signed, short-lived OIDC identity with the exact repository/owner IDs, main branch, import workflow path, allowed event, and dedicated audience. Pull requests and other workflows are rejected. The endpoint exposes bounded, validated, immutable trophy insertion, per-set status/finalization, and a fixed `refresh-statistics` action; it exposes no arbitrary SQL. The separate Cube image-refresh identity cannot request statistics maintenance. Deploy the compatible import endpoint on development and production before dispatching the updated import workflow. Production loading follows the development gameplay gate. A new environment still requires explicit catalog registration, and source conflicts still stop rather than silently replacing published puzzles.

OIDC trust follows [GitHub's documented claims](https://docs.github.com/en/actions/reference/security/oidc). No recurring model task or new long-lived credential is involved.
