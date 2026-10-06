# CI and merging

Pack One protects `main` with two required GitHub status checks: `test` and `browser`. Those check names stay present for every pull request so branch protection never waits on a conditionally omitted workflow.

## Shared change classification

Both required workflows use `scripts/ci-change-scope.mjs` against the complete merge-base-to-head diff. The classifier does not trust branch names, labels, authors, or PR titles. Mixed diffs receive the union of relevant browser domains, while unknown paths, dependency changes, CI-selection changes, empty diffs, or classifier failures fall back to broad validation.

The current profiles are:

- **publication** — only an exact validated generated campaign/creator registry + route/card diff. Generator/output checks, metadata/privacy/retirement contracts, and one focused Chromium route smoke run. Replay hydration is forbidden.
- **docs** — diff integrity only; no product browser suite.
- **mobile** — the required checks stay green/reporting-compatible while native/store workflows own the affected validation.
- **ci** — workflow/helper syntax and CI contract tests; selection/shared-execution infrastructure itself falls back to broad validation.
- **static** — focused editorial/static contracts plus the core browser smoke.
- **standard** — ordinary application/backend tests run without replay hydration. Browser tests are selected by affected domain (core, gameplay, account, admin, ads, corpus); shared execution paths escalate to the full browser matrix.
- **heavy** — replay/model/scoring/data changes hydrate replay shards, require shard-dependent regression tests, audit datasets, and run full browser coverage.
- **broad** — fail-closed/full validation. This is also used by the scheduled full-coverage runs and manual required-workflow dispatches.

## Replay hydration

Replay hydration is an explicit heavy capability, not a side effect of ordinary testing.

`scripts/run-js-tests.mjs` already identifies the shard-dependent distribution suites. Standard application changes therefore run the ordinary repository tests without downloading the replay corpus; those shard-dependent tests are skipped when shards are absent. Heavy and broad same-repository runs call `scripts/hydrate-replay-shards.sh`, set `REQUIRE_REPLAY_SHARDS=1`, and fail if the required shards are unavailable.

The hydration helper keeps the #1025 protection: classic S3 transfer, one concurrent request per runner, and bounded retry only for the specific transient R2 same-object read throttle. Browser CI does not hydrate replay shards because its local browser suites do not consume the private replay corpus.

Fork PRs never receive private R2 credentials. Heavy/broad fork runs execute the public test surface without requiring private shards.

## Generated publication fast path

A generated publication PR qualifies only after the classifier validates the actual diff and registry transition:

- exactly one ordinary campaign or creator slug changes;
- only that registry and its generated route/card files may change;
- published creator routes must include their social card;
- retirement/privacy removal must remove the personalized creator card;
- creator identity is immutable across retirement;
- ordinary campaign attribution mutation is not treated as generated publication.

The `test` job reruns deterministic campaign/creator output checks and focused publication/privacy contracts. The `browser` job runs `tests/publication-route-e2e.mjs` with small intercepted fixtures rather than starting the application or loading replay data.

`.github/scripts/publication-pr-checks.mjs` still freezes the exact repository, PR, branch, and head SHA. It accepts only genuine `pull_request` runs for that PR/head and now also inspects the successful jobs to prove that the publication-specific unit and browser steps actually ran. A green workflow that skipped the selected publication validation cannot authorize the publisher to merge.

The publisher's own pre-PR source check is also focused; it no longer runs the whole repository test suite before opening the generated PR.

## Required-check completion

Every required workflow ends with an assertion that the classifier-selected validation path actually completed. A skipped or mismatched path cannot report a successful required check merely because unrelated steps were green.

Branch protection continues to require the same `test` and `browser` job contexts. Publication authorization, exact commit/run identity, protected `main`, and normal campaign behavior are unchanged.

## Release-only secrets

Generic PR CI no longer verifies account-deletion/Apple production credentials. Those checks live in the guarded release/control workflows that actually consume the credentials, including `secure-auth-release.yml` and `account-deletion-controls.yml`.

## Scheduled full coverage

Both required workflows have a daily scheduled broad run. This preserves periodic full repository, replay/dataset, and browser coverage without charging every small pull request for it.

## Stacked pull requests

Required workflows listen for `opened`, `synchronize`, and `reopened`. If a stacked PR is retargeted after its parent merges, close/reopen it or otherwise synchronize the head so fresh required checks run against the new base. Do not merge a stale required result from the old base.

## Optional and path-specific checks

A check being visible in the pull-request UI does not make it a branch-protection requirement. Native build/store workflows, the isolated Neon backend gate, and other specialized checks remain authoritative for paths they cover.

Do not wait for unrelated optional checks merely because they are still running. Do not ignore a failing path-specific check that validates files in the pull request.
