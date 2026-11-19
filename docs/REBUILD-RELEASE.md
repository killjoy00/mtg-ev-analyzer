# Rebuild release preparation

This is a staged backend release, separate from the automatically published browser. Main's previous production audit reported backend release 18f625f, corpus v6 and selection v3. Do not claim main equals live.

1. Merge the release-preparation PR after unit, browser and disposable Neon SQL gates. Its reviewed request dispatches `prepare-rebuild.yml` for development.
2. The job downloads the exact complete artifact from successful development import 35289844612, checks every source ledger and puzzle checksum, applies only additive migrations 0017/0018/0019 and verifies schema. It stages baseline/supplements under versioned manifests, retaining old single-version serving manifests for the old API. No puzzle is overwritten, no historical corpus is deleted, and no function is deployed.
3. Verify the development artifact's complete signatures/counts before an equivalent reviewed production staging request. This is necessary before deploying the v7 runtime; it is not publication of a new set. Existing Live policy is retained; Candidates remain non-serving.
4. Review frozen-model scoring results before choosing the final release revision. Deploy that reviewed main SHA to development using the established deployment workflow. Its HTTP acceptance uses unranked QA guest Dailies, checks denied anonymous practice, universal packs, no Daily rerolls, completion retries, scoring caps, universal result links and resume. SQL gates separately test authenticated capabilities and shared practice.
5. Deploy the identical verified revision to production. The workflow checks development's revision first and requires the v4-compatible browser. Verify actual release markers and full coverage, complete both guest Dailies, inspect account/leaderboard behavior and record measured latency. Already-created v3 Dailies remain v3 for that date; never replace them to make a smoke test pass.

Do not apply destructive migration 0016 to production. Do not restore the development branch over production. The `--stage-only` loader flag is required while the previous backend still reads single-version manifests. An existing file/ledger with missing losses remains unknown; artifact reuse does not constitute a complete source-outcome audit.

If staging fails, keep the previous functions serving their untouched corpus, diagnose the exact artifact/schema failure, and resume additive staging. After v4 sessions exist, rollback must retain v4 and historical compatibility; use a compatible reviewed revision or fix forward.

## Replay-shard persistence invariant

Replay shards under `data/*/shards/` are intentionally gitignored and must never be treated as ordinary working-tree output. A Git commit that contains rebuilt manifests, catalog entries, ledgers or path models is **not** a complete rebuild checkpoint by itself.

For any multi-job model/corpus rebuild:

1. Rebuild and validate the environment locally on the current runner.
2. Upload that environment's replay shards to the model-versioned R2 namespace using `scripts/r2_replay_shards.sh` with an explicit `REPLAY_MODEL_VERSION` and `REPLAY_SETS` scope while the checkout is still mixed-model.
3. Verify the scoped remote shard count exactly matches the local shard count before the runner is allowed to exit.
4. Commit and push the git-tracked outputs to the rollout branch.
5. On the final fresh runner, hydrate the complete model-versioned shard namespace from R2 **before** full provenance/audit checks, corpus construction, publication or rollout-PR creation.

GitHub-hosted runners are ephemeral. If a job ends before both the R2 shard checkpoint and the git-tracked checkpoint succeed, that stage is not durable and must be considered incomplete.

The rebuild workflow is intentionally covered by `tests/test_data_pipeline_workflows.py`. Changes that remove scoped R2 checkpointing, exact shard verification, or final hydration must fail CI rather than silently returning to runner-local shard storage.

