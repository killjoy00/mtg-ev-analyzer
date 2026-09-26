# contextual-value-v1 checkpoint recovery

**Issue:** #529  
**Scope:** development only; locked assessment remains sealed

The pooled development workflow intentionally binds every reusable checkpoint to:

- the immutable source archive SHA-256 values;
- the exact globally selected draft cohort and split assignments;
- the code revision;
- the five-fold nuisance configuration and regularization settings;
- the outer-fold training and held-draft ID hashes; and
- the deterministic inner feature-complement hash.

A checkpoint whose metadata is missing, corrupt, duplicated, incomplete, or incompatible is rejected before fitting or scoring.

## Current dependency barrier

GitHub Actions expands the feature-shard matrix before the nuisance-fold matrix. The current all-shards dependency means fold assembly does not begin until all feature-shard matrix jobs finish.

This is conservative and wastes latency when one unrelated shard is delayed, but it does not make a failed shard statistically interchangeable with another shard.

## Safe recovery

For an active run:

1. Do not start a duplicate bounded run.
2. Let compatible successful shard artifacts remain untouched.
3. Inspect any failed job log and its stage/progress telemetry.
4. Once GitHub permits job reruns, rerun only the failed/cancelled job when possible.
5. Before assembly, require all four MSH/SOS/ECL/TLA shard payloads and provenance sidecars for that fold.
6. Reject artifacts from another cohort, code revision, configuration, fold, expansion, training complement, or payload hash.
7. Do not manually copy a successful artifact into a missing shard slot.

If GitHub's run-level retry mechanism cannot preserve successful matrix jobs in a particular failure mode, prefer a focused follow-up workflow change that makes each fold a reusable workflow/artifact boundary rather than disabling provenance checks.

## Measurement before more sharding

The historical feature-shard attempt on run 36242228385 reached the feature materialization command and then terminated after approximately:

- SOS: 27.5 minutes;
- MSH: 34.9 minutes;
- TLA: 35.0 minutes;
- ECL: 36.8 minutes.

Raw archive downloads completed in seconds. Those logs did **not** contain stage-level memory or progress telemetry, so they do not establish whether GitHub infrastructure, memory pressure, parsing, aggregate construction, or a combination caused the shutdowns.

The replacement workflow therefore measures elapsed stage time, peak RSS, row counts, and periodic row progress before deciding whether another shard dimension, a numerical optimization, or a different compute environment is justified.
