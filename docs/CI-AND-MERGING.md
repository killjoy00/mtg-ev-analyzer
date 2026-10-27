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

Replay hydration is an explicit heavy-test capability, not a prerequisite for ordinary tests. The `fast-core` job runs offline broad tests against reviewed real-decision fixtures without replay downloads. Selected replay/model/scoring/selection/data changes and forced broad validation run a separate `full-data-audit` job after the fast job succeeds. That job restores manifest-keyed replay caches, hydrates missing inputs through `scripts/hydrate-replay-shards.sh`, and runs strict `npm run test:data` plus dataset audits. The stable `test` aggregate requires every selected job to succeed. Release/corpus workflows retain strict `REQUIRE_REPLAY_SHARDS=1` validation. See [Testing Pack One](testing.md) for local commands, fixture provenance and diagnostic artifacts.

The hydration helper introduced by #1025 remains the only required-gate hydration entry point. It serializes S3 reads within a runner and retries only the known bounded R2 simultaneous-read throttle. Credential errors, missing objects and unrelated failures remain fatal. Browser CI no longer hydrates replay shards because its current suites do not consume them.

## Full scheduled coverage

Both required workflows have a daily scheduled run that forces broad validation regardless of changed paths. Pushes and pull requests still receive change-proportional coverage; the schedule preserves routine full regression coverage without charging every small PR for it.

## Release secrets and diagnostics

Release-secret provisioning checks belong in the release/control workflows that consume those secrets, such as the secure-auth/account-deletion release paths. The generic required `test` job no longer blocks unrelated PRs on those release credentials. Diagnostic-only browser greps that always exited successfully were removed because they did not validate behavior.

## Backend gate and Neon compute

`backend schema gate` runs each selected backend domain on its own short-lived Neon branch copied from production, and Neon bills that compute. To keep it proportional, the gate:

- **Selects domains by ownership.** `scripts/backend-gate-scope.mjs` assigns a changed file to the domains whose suites, or whose mapped modules in `scripts/backend-gate-map.json`, import it. It does not follow imports through full-path files such as the function routers, core and schema helpers. Those import nearly every module, so following them made almost every change select all six domains.
  - A change to a full-path file or a migration still runs all six.
  - So does a file the gate uses that no domain owns.
  - A file the gate never imports, executes or names is ignored, for example browser-only modules, `admin/` and HTML.
  - A test fails if a new worker module has no domain.
- **Runs all six weekly** (Mondays 07:17 UTC) against `main`, with a manual full sweep available on reviewed `main`. This catches coupling with no static import without creating six additional Neon branches every night. Pull-request domain coverage is unchanged; run a manual full sweep before a high-risk launch.
- **Runs the complete account domain on local PostgreSQL for every backend gate.** All six existing integration suites run unchanged against real PostgreSQL and the immutable small corpus. A PR scoped to account alone creates no Neon branch; a mixed narrow PR creates branches only for its other selected domains. Migrations, shared/full paths, classifier failures, weekly and manual full sweeps retain all six Neon domains. The aggregate gate rejects missing local results or mismatched provider routing.
- **Waits for `postgres-contract`** before creating any branch.
- **Suspends disposable CI computes after five idle minutes.** Only isolated expiring CI branches change; production stays always on. A resumed compute must pass its existing tests, not bypass them.
- **No background SQL polling in routine CI.** The allocation sampler keeps idle compute awake, so it runs only on a manual full sweep with `sample_compute` enabled. That diagnostic mode cannot validate idle suspension.
- **Caps branch compute per domain.** The project default allows 8 CU.
  - draft_run and corpus are capped at 2 CU. On their first capped run (#1323) they sat at the cap 74% and 92% of the time and took about 11 and 28 minutes against a 40-minute limit.
  - account, seasons, daily and subscriptions are capped at 1 CU. At 2 CU they used more than 1 CU for between 0% and 21% of the time.
  - An explicitly requested diagnostic sweep samples `num_cpus()` every 5 seconds and writes the allocation to its job summary. `num_cpus()` rounds up to whole CPUs.
  - Neon's own branch counters lag 15–60 minutes, longer than most CI branches live, so they can't be used for this.

On the 100 gate runs from October 14 to 23, the new selection creates 523 branches instead of 595, 12% fewer. In 75 of those runs the change touched a full-path file, mostly `worker/growth-function.js` or migrations, and still needs all six domains.

## Stacked pull requests

Required workflows listen for `opened`, `synchronize`, and `reopened`. When a stacked pull request is retargeted to `main`, synchronize or reopen it as needed so the required checks run against the complete `main` merge-base diff.

Normal stack progression is:

1. Merge the current stack layer into `main`.
2. Retarget the next pull request to `main`.
3. Ensure new `test` and `browser` runs exist for the exact current head and base.
4. Merge after those required checks pass and any path-specific validation relevant to the changed files is healthy.

Do not merge `main` into a feature branch, create a sync pull request, or add a no-op commit only to retrigger CI. Merge or rebase `main` into the feature branch only when the branch actually needs those commits to resolve a conflict or consume a dependency.

## Known failure modes

- **Slow "Apply pending migrations" in every backend domain.** Each domain re-applies the backlog migrations to its production copy. Migration 0056 includes a VACUUM of the serving tables. It takes about 5 seconds when production's visibility map is current, and 70–90 seconds after a bulk write that skipped maintenance, such as a card-image refresh. The cost repeats on every branch. `serving-maintenance.yml` restores production twice a day, or run it from the Actions tab (see [covering-index visibility maintenance](PRACTICE-SERVING-CACHE.md#covering-index-visibility-maintenance-1051)).

- **Slow browser dependency install.** `browser` installs Playwright's Chromium and WebKit system packages from the runner's Ubuntu mirror (`npx playwright install --with-deps`). That normally takes 40–60 seconds. Between October 21 and 23, at least five runs spent 19–30+ minutes downloading packages. Three hit the 30-minute job timeout before tests finished. Each install attempt is now limited to 8 minutes. One retry, limited to 10 minutes, points apt at `archive.ubuntu.com` instead of the runner's Azure mirror. Before retrying, the step kills the first attempt's `apt-get`: `timeout` stops `npx`, but the `apt-get` it started through `sudo` survived on #1322's first run and held the dpkg lock. If both fail, the step fails with a warning instead of a 30-minute cancellation; re-run the job once.
- **The backend gate copies production.** Isolated backend domains branch from production, so a production data change can expose a latent bug with no code change. On October 23 the first report-linked removal made `backend corpus` fail on every PR until migration 0066 (see [serving cache membership parity](BACKEND-RELIABILITY.md#serving-cache-membership-parity)). When the same failure appears on unrelated PRs, investigate the base and production state before the PR. `postgres-contract` also runs `tests/serving-carry-postgres.mjs` on fixed fixture data, so that particular mismatch now fails before merge.
- **Intermittent browser assertions.** `tests/patreon-activation-e2e.mjs` used to wait a fixed 250 ms for an analytics event sent on a 180 ms batch timer. It now waits for the event, up to 5 seconds. A `tests/e2e.mjs` Daily-home completion assertion failed once and is not root-caused. It now reports every card's state on failure. Re-run once; a second failure on the same commit is real.

## Optional and path-specific checks

A check being visible in the pull-request UI does not make it a branch-protection requirement. Long-running native build, store-access, backend-schema, or other specialized workflows should be judged by whether they validate paths changed by that pull request.

Do not wait for an unrelated optional check merely because it is still running. Do not ignore a failing path-specific check that is intended to validate the files being merged. Change-proportional required checks reduce unrelated work; they do not replace specialized validation for affected systems.
