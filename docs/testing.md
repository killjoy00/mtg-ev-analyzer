# Testing Pack One

Run `npm run test:fast` for everyday changes. It runs syntax checks, the full
non-replay JavaScript suite, and Python tests without downloading replay shards
or contacting services. The JavaScript runner blocks remote network access.
Corpus behavior uses a checked-in sample of real decisions, not generated packs.

| Command or gate | Purpose | Required inputs |
| --- | --- | --- |
| `npm run test:fast` | Offline development and fast PR feedback | Installed dependencies |
| `npm run test:data` | Exhaustive corpus, consensus, scoring and distribution audits | Complete MSH, SOS, TMT and ECL replay shards |
| `npm run test:full` | All JavaScript checks with strict replay requirements | Complete replay shards |
| `npm test` | Compatibility command; reports unavailable replay suites | Installed dependencies; replay inputs when available |
| `node scripts/run-browser-tests.mjs --full` | All browser journeys, current Daily/Practice and explicit historical versions | Local site server and pinned Playwright browsers |
| `cd mobile && npm run test:shared` | Lint, types and every discovered mobile unit file once | Mobile dependencies |
| `cd mobile && npm test` | Shared checks plus fresh build/release configuration checks | Mobile dependencies and build environment |
| `postgres-contract` | Real SQL, migrations, gateway, worker and client behavior | Disposable PostgreSQL 17.6 service |
| Provider backend and capacity gates | Neon behavior, deployment, full corpus and performance limits | Existing isolated CI resources and secrets |

The CI `test` check requires the fast gate and, when selected, the full-data
audit. Replay hydration and its credentials belong only to the data job. Data
jobs cache downloaded shards by their checked-in manifest and model inputs.
Release/corpus workflows set `REQUIRE_REPLAY_SHARDS=1`, so missing data fails
instead of reducing coverage. An unreadable diff, unknown application path or
selection-infrastructure change keeps broad coverage. Root application HTML
is application code; registered backend tests remain selectable by their own paths.

## Immutable corpus fixtures

`tests/fixtures/draft-run/catalog.json` records each sample's checksum and the
original corpus checksum. Fixtures retain difficulty coverage, source
trajectories and real reroll alternatives. The fast and exhaustive modes share
the same behavior assertions; exhaustive mode increases corpus and seed coverage.

To refresh samples after a deliberate corpus change, run
`node scripts/build-test-corpus-fixture.mjs` and review the fixture diff and
provenance. Scoring expectations do not regenerate automatically. Only use
`--refresh-golden` when intentionally reviewing a model/score change, and review
the resulting expected scores independently. CI never regenerates expectations.

## Database and browser fixtures

`scripts/prepare-test-database.mjs` only accepts a local database named
`pack1` with the dedicated `pack1_ci` role through `PACK1_TEST_DATABASE_URL`
and refuses a nonempty database. The isolated service uses the production
database name so the existing migration maintenance guard stays intact.
It applies the manifest in order, imports the sample through production import
code and requires actual serving readiness. Historical migrations need the
environments that were imported before they originally ran. Empty legacy
retirement tables and provider-owned identity tables are explicit compatibility
fixtures; they do not claim to reproduce the external identity provider.
Current application schema, SQL functions, indexes and constraints come from
the repository's migrations. No production SQL is replaced by fake query results.

The backend workflow's manual trigger, or a push to `ci/test-fixture-*`, runs
only the disposable PostgreSQL job. Provider branch tests still run on the
normal PR path. This allows fixture failures to be fixed without repeatedly
provisioning Neon branches.

Browser invocations preload the production API guard and use the pinned
Playwright Chromium, including scripts that previously requested host Chrome.
Current Daily fixtures supply release metadata and a fixed date. The full
inventory retains historical selection versions and includes mixed, Cube and
latest-set Dailies. Failed journeys retain a trace, screenshot and browser
events in `artifacts/browser/`; the report lists every expected and executed
invocation, including its environment.

## Shared resources and mobile work

Distributed-load source checks wait outside the preview hostname lock. Once
the child workflow acquires the lock, it rechecks the exact source revision
before provisioning. Preview cleanup verifies branch, SHA, run and attempt,
and deletes only matching DNS records. Ambiguous writes are reconciled by
reading provider state. Sanitized ownership receipts are uploaded from
`artifacts/ci-resources/`; branch expiry remains a backstop. An ownership
mismatch fails cleanup rather than removing another run's resources. Existing
latency, correctness, telemetry, resource and cleanup budgets remain unchanged.

PR capacity acceptance now requalifies 25 players on five independent egress
networks, including the complete 120-second hold, drain and recovery. The
50-player stage is optional: manually dispatch `launch-distributed.yml` with
`capacity_target=50` to run the original 25→50 ladder and 600-second hold.
Ordinary PRs and dispatches default to 25. Every job uses the same selected
policy; its fingerprint binds fixtures and reports, and the collector still
requires all five cohorts to complete and every selected stage to pass.
Skipping 50 does not establish current 50-player capacity. A policy change
requires a fresh run; earlier failed runs remain failed.

Mobile jobs can reuse a successful shared-validation receipt for identical
repository inputs and runner OS. Every job still validates its current build
and release configuration. Concurrent first runs can both miss the cache;
release/upload jobs retain fresh validation. Unit suites are discovered once
and share one React setup and compiler helper. Test/documentation-only PRs skip
native screenshot capture; screen, configuration, dependency and unknown mobile
changes retain it. Unreadable diffs retain full screenshot coverage.

Android screenshot CI prepares the SDK before app compilation. Its reviewed
`mobile/android-toolchain.json` pins match React Native's installed version
catalog. NDK downloads must match Android's published archive size and checksum,
pass ZIP integrity checks, and provide a working compiler before installation.
Verified SDK packages and unsigned Gradle dependencies/build state are cached.
Dependency setup can recover once from corrupt bytes or transient HTTP failures;
compiler errors, app builds and screenshot assertions are never blindly retried.
`artifacts/native-build/` records the toolchain phase, expected/received bytes,
dependency-resolution attempts and build logs. When a build fails before capture,
missing screenshot uploads do not add misleading secondary errors. Successful
capture still requires its expected artifacts.

A push to `ci/android-fixture-*` runs mobile validation and the complete Android
screenshot/acceptance journey, without an iOS capture or store upload. This lets
toolchain fixes be verified on a real hosted runner before restarting PR gates.

## Reading failures

`artifacts/tests/js-*.json` records selected/excluded files, case counts,
duration, revision and whether selection, execution or assertions failed.
The corresponding JUnit XML contains individual failures. Mobile unit reports
record their complete inventory. Provider HTTP retries cover transient reads;
assertion failures and ambiguous mutations are not blindly retried. Keep the
fixture, provider, dataset and performance results distinct when diagnosing a
failure: a fast green check does not replace the selected slower gates.
