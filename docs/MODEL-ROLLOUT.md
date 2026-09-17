# Model rollout: September 2026

The target is `strong-player-colour-stage-v3` in the parallel corpus
`elite-trophy-colour-stage-v7`. Scoring remains `trophy-consensus-v3`:
the verified trophy choice earns 100, and alternatives earn
`round(95 * selected_support / leading_support)`.

## Retirement failure and verification

PR #110 failed because an existing Daily schedule contained a retired puzzle
ID in JSON. There is no foreign key on that reference. At the failed run's
03:42 UTC timestamp, the game's Eastern date was September 16. That day's mixed
plan included a retired puzzle; September 17's plan did not. A rerun on the
later date could therefore pass without repairing the defect.

On a disposable production clone, applying the original migration removed
exactly the retired source's 19,853 puzzles. All 32 surviving environments had
identical before/after puzzle and rating counts, with no missing ratings.
The migration now removes plans with an absent puzzle after retirement. Its
SQL regression seeds valid and dangling eight-pick plans on fixed fixture
dates, executes the actual repair, and verifies preservation and retry safety.
The repaired PR passed unit, browser, and SQL-backed gates before merging.

Merging a migration file does **not** apply it to production. The retired-data
workflow removes the R2 objects; production SQL is a separate release action.

## Stage data before switching the serving version

1. Regenerate the committed baseline and version constant together, using
   `regenerate-draft-run-corpus.yml`. All replay manifests must report one
   model. This does not rebuild the replay shards.
2. Run `import-all-trophies.yml` with `target=development`. Start with a small
   environment to exercise the real path, then use `sets=all` for release.
   The workflow validates all artifacts, loads the versioned baseline, adds
   verified supplements, and checks the staged database directly.
3. Repeat with `target=production`. Before modifying production, the workflow
   requires complete development coverage with identical baseline checksums,
   supplement checksums, and input signatures. Older puzzle payloads remain
   unchanged. Neither staging operation changes the live function revision.
4. Apply the tested retirement migration to the intended target immediately
   before its release, then deploy the reviewed revision to development.
   Verify both mixed and Cube practice flows. Promote that exact revision to
   production through `deploy-functions.yml` and verify live coverage.
5. Perform the owner's authorized second scoreboard reset after the actual
   v3 model is live. Preserve player accounts and puzzle data. Remove stale
   Daily plans as part of the transition; do not leave a v6 plan serving v7.

The import workflow uses an explicit Neon SQL connection because the currently
deployed game API validates imports against its own active corpus version.
Sending v7 to a v6 API is not a viable staging path. The baseline loader checks
immutable payload equality, and can safely be rerun after supplements exist.

The backend gate loads the committed baseline onto its disposable database
before testing. A separate integration test completes an old-version run,
opens its challenge, verifies rerolls cannot cross versions, and checks that
a new Daily replaces an outdated schedule with the current corpus.

## Requesting existing workflows from a reviewed commit

`.github/workflows/model-rollout-request.yml` accepts changes to
`.github/model-rollout-request.json` on main. It dispatches only the fixed
regeneration, import, browser, and deployment workflows, all on main. It uses
the repository's short-lived Actions token; no token or arbitrary command is
accepted in the request. Each request has `request_id`, `reason`, `operation`,
and the operation's explicit inputs. Production deployment still requires
the identical revision to pass the existing development release check.

## Remaining product decision

Full Pack and Top 3 still select lifetime-strong seats that are not necessarily
trophy drafts. Their retirement or a trophy-filter rebuild requires an owner
decision. This Draft Run rollout does not perform that expensive rebuild or
remove either mode. All three modes continue to grade Pack 1 only.
