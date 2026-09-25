# CI and merging

Pack One protects `main` with two required GitHub status checks: `test` and `browser`. Those checks must report for every pull request targeting `main`; specialized workflows may also run when their path filters match.

## Required checks

The required checks deliberately stay present on every pull request so branch protection never waits for a status that was omitted by a workflow-level path filter.

For ordinary browser, worker, backend, data, script, migration, or repository-infrastructure changes, both required jobs run their full suites. The full `test` job verifies release bundles, hydrates replay shards for same-repository changes, runs JavaScript/Python tests, audits production datasets, and keeps the account-deletion release-secret guard. The full `browser` job installs Playwright and runs the browser regression suite.

Native-mobile and mobile-release-only pull requests use a narrow fast path. When every changed path is limited to the native `mobile/` tree, explicitly named mobile release documentation, native-store workflows/request files, or `.gitignore`, the required jobs still start and report success but skip their unrelated web/backend work. Targeted mobile/store workflows remain responsible for validating those changes. If any changed path falls outside that narrow list, the full required suites run.

The account-deletion release-secret check remains active for same-repository pull requests even when the rest of `test` takes the mobile fast path.

## Stacked pull requests

Both required workflows listen for pull-request `edited` events in addition to `opened`, `synchronize`, and `reopened`. Retargeting a stacked pull request from its parent branch to `main` therefore starts fresh required CI against the new base.

Normal stack progression is:

1. Merge the current stack layer into `main`.
2. Retarget the next pull request to `main`.
3. Use the new `test` and `browser` runs created by that retarget as the merge gate.
4. Merge after those required checks pass and any path-specific validation relevant to the changed files is healthy.

Do not merge `main` into a feature branch, create a sync pull request, or add a no-op commit only to retrigger CI. Merge or rebase `main` into the feature branch only when the branch actually needs those commits to resolve a conflict or to consume code that the feature depends on.

## Optional and path-specific checks

A check being visible in the pull-request UI does not make it a branch-protection requirement. Long-running native build, store-access, backend-schema, or other specialized workflows should be judged by whether they validate paths changed by that pull request.

Do not wait for an unrelated optional check merely because it is still running. Do not ignore a failing path-specific check that is intended to validate the files being merged. The required-check fast path is an optimization for unrelated web/backend work, not a substitute for the targeted mobile/release validation.
