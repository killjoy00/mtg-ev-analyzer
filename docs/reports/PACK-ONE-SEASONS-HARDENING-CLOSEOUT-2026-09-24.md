# Pack One season hardening closeout — 2026-09-24

## Outcome

The post-release Pack One competitive-season hardening is implemented, migrated, deployed and accepted in production.

The hardened application revision is `9763e7caf87f20ca4bc77d82b8513a3d365db5c9` from PR #476. Development and production Neon schema include migration `0038_pack_one_season_hardening.sql`, and development and production Functions both serve that exact application revision.

This closes the three production failure-domain risks identified after the initial season release and also closes the associated release-process and rollover-admission gaps.

## Findings remediated

### 1. Season failures no longer take down profiles or profile settings

Before hardening, `buildProfile()` treated current-season enrichment as a required member of its `Promise.all`. A reconciliation failure could therefore fail My Pack One, public profiles, and profile-setting saves, including a request to make a profile private.

The hardened growth worker treats current-season data as optional enrichment. It catches season-resolution failures, emits a structured server log, and returns `current_season: null` while preserving the rest of the profile response or settings mutation.

The Draft Run leaderboard remains fail-closed for unexpected season errors; only the unrelated profile surface is decoupled.

### 2. Settled fallback history no longer depends on mutable corpus policy

Migration 0038 adds the singleton `draft_run_season_reconciliation_state` watermark.

Installation first runs the existing 0037 reconciler successfully. Only after that proof does it set the watermark to the maximum settled Latest Set schedule day. The replacement reconciler examines only Latest Set schedule days after `last_reconciled_day`.

Each successfully processed schedule day advances the watermark, including:

- a schedule matching the current season;
- a previously persisted historical season;
- an older/equal-release fallback that does not establish a season;
- a newly established or advanced season.

A fallback set that never owned a season is therefore consulted against mutable policy only while its schedule day is new. Once that day has been reconciled, later deletion or corruption of that fallback policy row cannot poison future reconciliation.

### 3. Profile reads cannot create immutable Dailies

The shared season resolver no longer imports or defaults to `ensureDailySchedule`.

Profile/current-season reads reconcile only the schedules that already exist. `pack1growth` therefore cannot create the immutable Latest Set Daily.

The Draft Run API explicitly supplies the Daily writer when season-board resolution needs to ensure today's Latest Set schedule. Scheduled Daily generation and Draft Run remain the owners of Daily creation.

During a mixed-revision deployment, the worst profile-side outcome is temporarily seeing the previously reconciled season until the Daily owner creates the new schedule; profile traffic cannot win the immutable Daily insert.

### 4. New-set metadata is checked before rollover

Live/latest-set admission was tightened so a regular set cannot become the new Latest Set source with incomplete rollover metadata.

The hardening requires the metadata needed by season creation, including a nonblank set name and release date, while `regular_run=true` remains part of Latest Set eligibility.

This closes the specific first-rollover path where Daily selection could succeed but season reconciliation would then reject the same new set.

### 5. Equivalent rollout requests are no longer silently replayed

The reviewed rollout bridge now computes a semantic fingerprint that excludes descriptive `reason` and `request_id` fields.

If an equivalent rollout already exists in the request-file history, a new request is rejected unless it explicitly names an equivalent prior request with `replay_of`.

This directly addresses the initial season release's duplicate production migration: PR #470 differed from #469 only in `request_id` and `reason`. That second migration was harmless because 0037 is repeatable, not because the old rollout bridge prevented replay.

## Verification before release

PR #476, **Harden Pack One season failure boundaries**, merged as exact application revision:

`9763e7caf87f20ca4bc77d82b8513a3d365db5c9`

Required PR gates all passed:

| Gate | Run |
| --- | --- |
| Test | **36017750479** |
| Browser / E2E | **36017750514** |
| Isolated Neon backend schema/integration | **36017750481** |

The backend gate created a disposable Neon production clone, applied migration 0038, ran the schema verifier and SQL-backed integration suites, and deleted the branch after success.

Regression coverage includes the post-release review cases:

- profile season enrichment fails open instead of failing profile reads/settings;
- profile reads do not create a missing Latest Set Daily;
- an older fallback schedule can be settled without creating a season row for that set;
- later mutable-policy damage to that settled fallback does not poison reconciliation;
- the watermark advances only after a schedule day is successfully processed;
- new Latest Set metadata requirements reject an unsafe rollover input;
- equivalent rollout requests are rejected without an explicit valid `replay_of`.

## Release chain

The hardening used the same explicit development-to-production exact-revision handoff as the feature release.

| Step | Evidence |
| --- | --- |
| Hardening merge | PR #476 → `9763e7caf87f20ca4bc77d82b8513a3d365db5c9` |
| Development migration 0038 request | PR #477 |
| Development migration 0038 | run **36020410138** |
| Development deployment request | PR #479 |
| Development exact-revision deploy + acceptance | run **36021141621** |
| Production migration 0038 request | PR #480 |
| Production migration 0038 | run **36022058215** |
| Production deployment request | PR #482 |
| Production exact-revision deploy + acceptance | run **36023616589** |

Both migration runs checked out the exact reviewed hardening revision, applied 0038 to the fixed target branch, and passed the Neon schema/serving-statistics verifier.

## Production acceptance

Production deployment run **36023616589** completed successfully.

It:

- checked out exact application revision `9763e7caf87f20ca4bc77d82b8513a3d365db5c9`;
- verified production schema prerequisites after migration 0038;
- required that exact same revision to have already passed development acceptance;
- built and verified all three Function bundles before upload;
- deployed the checked bundles without rebuilding them during upload;
- ran the release smoke with the settle/stable-marker path;
- completed the mixed, Powered Cube and Latest Set unranked Daily flows;
- queried `/v1/leaderboard?period=season` for mixed, Powered Cube and Latest Set;
- completed the final acceptance step successfully.

The same release smoke had already passed against the development deployment in run **36021141621**.

## Relationship to the original season evidence

The original competitive-season feature and inaugural-season evidence remain valid.

The inaugural HOB evidence still comes from isolated production-clone backend gate **35999874459**:

| Evidence | Value |
| --- | --- |
| Season | `hob` / **The Hobbit** |
| Set release date | 2026-08-14 |
| Earliest ranked Draft Run evidence | 2026-09-16 |
| First immutable Latest Set Daily schedule | 2026-09-19 |
| Persisted inaugural season start | 2026-09-16 |

This hardening closeout did not perform an ad-hoc live production query to independently re-derive those historical dates. The 0038 migration and deployment workflows did query the fixed production branch for schema/runtime verification, but the September 16 / September 19 historical dates remain grounded in the earlier isolated production-clone evidence.

## Documentation review

The post-release documentation pass found and corrects four stale boundaries:

- `docs/CURRENT-STATE.md` still listed the original `fe9d666...` Function revision and schema through 0037.
- `docs/REQUEST-INTEGRITY.md` described the 0038 hardening promotion as prospective instead of completed.
- the original season closeout still said the three review findings required a future reviewed migration/deployment.
- `.github/workflows/backend-gate.yml` still described the production-clone baseline as schema 0037.

The hardening closeout updates all four to the verified production state.

`README.md` and `docs/CHARTER.md` do not require a behavioral rewrite: their public season contract remains correct. The hardening changes failure isolation, reconciliation durability, writer ownership and admission safety rather than the user-facing definition of a season.

## Remaining follow-ups / non-blockers

1. **Stacked mobile migration numbering.** Current `main` owns migrations 0037 and 0038. Draft mobile PR #448 still carries a historical migration numbered 0037, and later stacked PR #461 carries one numbered 0038. The mobile stack must be rebased and its migration chain renumbered before merge.
2. **Legacy monthly compatibility.** The legacy worker/core monthly implementation remains intentionally preserved. Current Draft Run `month` requests continue to canonicalize to the competitive season.
3. **First natural future rollover.** Observing the next real newer-set rollover remains valuable operational confirmation. It is not a known release blocker after this hardening: profile enrichment fails open, settled history is protected by the watermark, profile reads cannot create Dailies, and incomplete new-set metadata is rejected before Latest Set use.

## Final state

As of this closeout:

- migrations 0037 and 0038 are applied in development and production;
- development and production Functions serve exact hardened revision `9763e7caf87f20ca4bc77d82b8513a3d365db5c9`;
- production acceptance run 36023616589 is green;
- the three post-release season failure-domain findings are remediated in production;
- rollout replay protection is active for future reviewed requests;
- The Hobbit remains the persisted inaugural season with start date 2026-09-16 based on the earlier isolated production-clone evidence;
- there are no known unresolved season-specific outage paths from the review that triggered this hardening release.
