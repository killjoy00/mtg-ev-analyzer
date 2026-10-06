# CI and merging

Pack One protects `main` with two required GitHub status checks: `test` and `browser`. Those checks report for every pull request targeting `main`; specialized workflows may also run when their path filters match. The required check names stay stable so branch protection never waits for a conditionally omitted status.

## Change-proportional required checks

Both required workflows use `scripts/ci-change-classifier.mjs`. They classify the complete actual diff against the `main` merge base for pull requests and the complete pushed commit range on `main`. Branch names, labels and authors do not grant a fast path. Mixed changes receive the union of relevant behavior; an empty diff, a classifier failure, dependency changes, or changes to CI selection/shared execution infrastructure fall back to broad validation.

| Change shape | `test` | `browser` | Replay hydration |
| --- | --- | --- | --- |
| Generated creator/campaign publication or retirement | exact allowed-file + registry/generator + publication/privacy contracts | one generated-route smoke | none |
| Documentation only | diff hygiene + classifier contract | no browser behavior selected | none |
| Static presentation | focused editorial/product contracts | lightweight presentation smoke | none |
| Native mobile/release only | lightweight required-check contract; targeted native/store workflows remain authoritative | no web browser suite | none |
| Known account, Practice, profile, Daily, Draft Run, admin or ads application domain | broad unit/Python coverage and bundle verification | only affected browser group(s) | none |
| Shared/unknown application or backend code | broad unit/Python coverage and bundle verification | full browser regression | none |
| Replay/model/scoring/selection/data/corpus | broad tests with replay-dependent distribution checks, bundle verification and dataset audit | full browser regression | protected hydration required |
| Generic workflow/helper | broad source tests without replay hydration plus workflow contracts | no product browser suite unless product code is also changed | none |
| Required-check selector, shared test runner, hydration helper or dependency manifest | broad fail-closed validation | full browser regression | protected hydration required |

Unknown paths deliberately route toward broad application coverage instead of being silently ignored.

## Publication fast path

Generated creator and ordinary campaign PRs qualify only when the complete diff matches one registry change and exactly the generated route/card files for the same slug. `scripts/ci-publication-validate.mjs` compares the registry before and after the exact base/head pair and validates publication versus retirement semantics. It rejects mixed changes, attribution mutation, unrelated paths, stale heads, renames/copies/type changes and creator retirement that retains a personalized social card.

The publication `test` path runs deterministic campaign/creator generator checks, regenerates published creator social cards from the checked-in registry and compares rendered pixels, and runs focused publication, authorization, privacy and retirement contracts. The `browser` path starts the local static site and checks only the generated `/go/<slug>/` or `/creator/<slug>/` route using a small deterministic browser fixture. It does not run account, Daily, Practice, model or scoring browser suites and neither required publication check hydrates replay data.

`.github/scripts/publication-pr-checks.mjs` still freezes the same-repository bot PR, branch, head SHA, slug and allowed files; requires genuine `pull_request` runs for both required workflows; and now also verifies that the publication-specific validation steps actually completed successfully inside those exact runs before merge. A stale green run or a successful run that skipped publication validation cannot authorize publication.

## Replay hydration

Replay hydration is an explicit heavy-test capability, not a prerequisite for ordinary tests. `scripts/run-js-tests.mjs` already identifies the shard-dependent distribution suites and skips only those when shards are unavailable. Normal application CI therefore runs broad tests without downloading the replay corpus. Replay/model/scoring/selection/data changes and forced broad validation set `REQUIRE_REPLAY_SHARDS=1` after running `scripts/hydrate-replay-shards.sh`.

The hydration helper introduced by #1025 remains the only required-gate hydration entry point. It serializes S3 reads within a runner and retries only the known bounded R2 simultaneous-read throttle. Credential errors, missing objects and unrelated failures remain fatal. Browser CI no longer hydrates replay shards because its current suites do not consume them.

## Full scheduled coverage

Both required workflows have a daily scheduled run that forces broad validation regardless of changed paths. Pushes and pull requests still receive change-proportional coverage; the schedule preserves routine full regression coverage without charging every small PR for it.

## Release secrets and diagnostics

Release-secret provisioning checks belong in the release/control workflows that consume those secrets, such as the secure-auth/account-deletion release paths. The generic required `test` job no longer blocks unrelated PRs on those release credentials. Diagnostic-only browser greps that always exited successfully were removed because they did not validate behavior.

## Stacked pull requests

Required workflows listen for `opened`, `synchronize`, and `reopened`. When a stacked pull request is retargeted to `main`, synchronize or reopen it as needed so the required checks run against the complete `main` merge-base diff.

Normal stack progression is:

1. Merge the current stack layer into `main`.
2. Retarget the next pull request to `main`.
3. Ensure new `test` and `browser` runs exist for the exact current head and base.
4. Merge after those required checks pass and any path-specific validation relevant to the changed files is healthy.

Do not merge `main` into a feature branch, create a sync pull request, or add a no-op commit only to retrigger CI. Merge or rebase `main` into the feature branch only when the branch actually needs those commits to resolve a conflict or consume a dependency.

## Optional and path-specific checks

A check being visible in the pull-request UI does not make it a branch-protection requirement. Long-running native build, store-access, backend-schema, or other specialized workflows should be judged by whether they validate paths changed by that pull request.

Do not wait for an unrelated optional check merely because it is still running. Do not ignore a failing path-specific check that is intended to validate the files being merged. Change-proportional required checks reduce unrelated work; they do not replace specialized validation for affected systems.
