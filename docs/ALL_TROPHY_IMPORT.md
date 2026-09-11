# Complete Premier trophy import

The canonical importer is `scripts/import_all_trophies.py`. The former trophy extractor intersected archive IDs with `data/<set>/shards`, limiting trophy coverage to the 300-replay sample. Those shards remain appropriate for the older replay modes; they must never select Draft Run's trophy population.

## Reproduce and load

```sh
python scripts/import_all_trophies.py --sets all --workers 3
node scripts/load_all_trophies.mjs unused generated/trophy-import --validate-only
node scripts/load_all_trophies.mjs /path/to/development.connection generated/trophy-import
# Verify the development backend, then use the production connection.
```

`all` discovers PremierDraft links from the same official CMS document used by https://www.17lands.com/public_datasets. It does not use our local set catalog to choose what to scan. Powered Cube stays a separate environment. Other event types are excluded. Environments with no public draft archive are reported in `discovery.json`; this currently includes KHM. A newly discovered environment is imported, but the loader requires serving-catalog registration before exposing its puzzles.

Every source draft is examined. Every seven-win draft gets a ledger entry with qualification and inclusion status, counts of included and skipped decisions, and reasons. Modern qualifications remain at least 100 prior games and the elite cutoff (at least .60, no lower than the existing set threshold). Legacy qualifications use actual earliest-game Diamond/Mythic rank plus 100 prior games. Unknown experience, outcome conflicts, and failed joins never qualify. AFR's available archives currently provide no qualifying trophy joins; its exclusion is explicit.

Output is uncapped. Training remains independently selected from the broader elite cohort, capped at 5,000 drafts with five-fold holdout by draft ID. A trophy does not need to be in that training cohort or in the replay sample. No scoring formula changes.

Each output decision has a source-verified contiguous opening history, exact historical choice and pack identities, and an HTTPS image for every candidate and prior pick. Missing later picks do not discard a valid earlier prefix. Missing images exclude affected decisions, with exact unresolved names retained for remediation. No fuzzy card substitutions are allowed.

## Persistence and resume

Raw archives, image caches, and per-set checkpoints live under `generated/trophy-import`. Archive cache reuse verifies remote ETag, size, and local SHA-256. A checkpoint also binds source/game archives, importer/model code, baseline manifest, and supplemental card metadata. Changed inputs rebuild the set. `--refresh` forces a rebuild. Interrupted artifacts fail checksum validation and are rebuilt; successful sets are reusable.

Each set produces `manifest.json`, `puzzles.jsonl.gz` (additional decisions), and `trophies.jsonl.gz` (all trophy dispositions). The final catalog is complete only when every requested archive succeeds. `discovery.json` records the official source inventory, including unavailable archives. The manual GitHub Actions workflow preserves all output manifests, image caches, decision files, and ledgers as a downloadable artifact for 90 days, including partial diagnostic output after failure.

The existing v6 corpus is an immutable baseline. Its decisions are reverified against source and preserved with the same payloads, IDs, scores, schedules, and challenge links. The new loader validates every file and all ledger/decision counts before writing. It streams bounded batches, refuses conflicting existing payloads, and only inserts additional puzzles. Reruns are idempotent. It records each completed set's import manifest in `draft_run_verified_sets.manifest.full_import`; the database is the durable serving copy. On a new empty database, load the checked-in baseline first, then these supplements.

The backend reads all interesting decision metadata using keyset pagination, with no sampling cap. Browsers still receive only the current puzzle. A complete archive import is not a claim that every source trophy is high quality or renderable: use qualified, included, and exclusion counts in the report.

## Verification

Run `npm test`, validate artifacts with the loader, and load development first. Verify per-set counts, old-payload preservation, rerun idempotency, backend health, mixed and Cube starts/rerolls/completions, and cold pool loading at the expanded size before production rollout. Keep the import report alongside release evidence. The old `extract_trophy_evidence.py` and `build_verified_trophy_corpus.py` commands reproduce only the frozen baseline and are not the complete importer.
