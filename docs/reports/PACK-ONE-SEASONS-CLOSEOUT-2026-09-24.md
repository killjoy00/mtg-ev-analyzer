# Pack One competitive seasons closeout — 2026-09-24

## Outcome

Pack One competitive seasons are implemented, merged, migrated, deployed and live in production.

The shipped application revision is `fe9d666a094c0d18a13899a089a3ed49de67901a` from PR #460. Production Neon Postgres carries reviewed migrations through `0037_pack_one_seasons.sql`. Development and production Functions both serve the same exact season revision.

The current competitive leaderboard periods are **Today**, **This week**, **This season** and **All time**. Legacy Draft Run clients and URLs that request `month` canonicalize to the current season; the unrelated legacy monthly worker/core path remains intact.

## Product behavior shipped

- Persist one durable season per regular set in `draft_run_seasons`.
- Allow only one open/current season at a time.
- Establish and advance seasons from immutable Latest Set Daily schedules.
- Advance only to a set with a newer release date than the persisted current season.
- Never roll a season backward during temporary A → B → A fallback.
- Preserve established season name/release/start metadata independently of later mutable corpus policy edits.
- Serialize reconciliation with a Postgres advisory transaction lock so concurrent/retry paths converge.
- Resolve the same current season for mixed Draft Run, Powered Cube and Latest Set leaderboards.
- Return HTTP 200 with an explicit empty season/rows state when no season can be established.
- Show current-season standings on My Pack One and public profiles only when the player has season results.
- Compute profile ranks against the full eligible field before filtering to one player, so a profile may correctly show a rank beyond the public top 100.
- Normalize historical `leaderboard_view` analytics carrying `period=month` to `period=season`.

## Inaugural season evidence

The isolated Neon production-clone bootstrap in backend gate 35999874459 established the inaugural season before destructive fixtures ran:

| Evidence | Value |
| --- | --- |
| Season | `hob` / **The Hobbit** |
| Set release date | 2026-08-14 |
| Earliest ranked Draft Run evidence | 2026-09-16 |
| First immutable Latest Set Daily schedule | 2026-09-19 |
| First Latest Set scheduled set | `hob` |
| Persisted inaugural season start | 2026-09-16 |
| Newest published regular set on ranked launch | `hob` |

The bootstrap snapshotted ranked score count/sum before and after reconciliation and verified they were unchanged.

The evidence supports backdating the inaugural season to ranked play beginning 2026-09-16 rather than the first known Latest Set Daily schedule on 2026-09-19. The implementation derives that start from stored evidence; it does not hard-code the date.

## Verification

PR #460 finished green on all required tracks:

- test: **35999874362**
- browser/E2E: **35999874403**
- isolated Neon backend schema/integration gate: **35999874459**
- post-merge Pages deployment: **36000585969**
- post-merge E2E: **36000586674**

The destructive season smoke ran last on a disposable Neon clone and passed:

- no-season HTTP 200 behavior;
- old `month` alias compatibility;
- inaugural evidence backfill;
- retry repair after a Daily schedule exists but season reconciliation did not complete;
- idempotent reconciliation;
- concurrent reconciliation from empty season state;
- A → B → A monotonicity;
- B → C advancement;
- persistence of established season metadata after later policy edits;
- one shared season/window across mixed, Powered Cube and Latest Set;
- profile rank beyond public top 100.

## Release chain

The release followed the repository's reviewed exact-revision handoff rather than mutating production directly.

| Step | Evidence |
| --- | --- |
| Feature merge | PR #460 → `fe9d666a094c0d18a13899a089a3ed49de67901a` |
| Development migration 0037 | run **36001110151** |
| Development exact-revision deploy + acceptance | run **36001721901** |
| Production migration 0037 | run **36002498051** |
| Repeatable duplicate production migration verification | run **36003166525** |
| Production exact-revision deploy + acceptance | run **36004516512** |
| Post-release acceptance hardening | PR #472 → `6802db2a16627b579138e4466e05fad795356b33` |

The second production migration request was created during concurrent release work. Because migration 0037 is additive/repeatable, both production migration workflows completed successfully against the same exact reviewed application revision; there was no divergent schema or application target.

Production deployment 36004516512:

- checked out exact revision `fe9d666a094c0d18a13899a089a3ed49de67901a`;
- verified production schema prerequisites;
- required that identical revision to already be accepted in development;
- built and deployed checked bundles without rebuilding during upload;
- completed mixed, Powered Cube and Latest Set Daily flows;
- queried `/v1/leaderboard?period=season` for all three environments;
- held all release markers on `fe9d666` continuously for the settle window.

PR #472 landed after the production release and strengthens future verification: release smoke now waits for stable exact-revision markers before querying season boards, and the migration workflow's summary output no longer treats a commit SHA as shell command substitution.

## Release integrity added

This work added `.github/workflows/pack-one-season-migration.yml` and a `season-migration` operation in the reviewed rollout bridge.

The migration path accepts only a full reviewed main SHA and fixed development/production targets. The standard function release smoke verifies that mixed, Powered Cube and Latest Set all resolve the same current season and start date after the release markers stabilize, so a future backend deployment cannot pass acceptance while season resolution is inconsistent across environments.

## Documentation review

The September 24 documentation pass corrected these stale boundaries:

- `docs/CURRENT-STATE.md` now records the live season browser revision, production Function revision, schema through 0037, inaugural HOB evidence and release runs.
- `docs/REQUEST-INTEGRITY.md` now records the completed development → production season release chain and the stable-marker hardening.
- `README.md` now describes the season leaderboard periods, monotonic season behavior, legacy month compatibility and profile standings.
- `.github/workflows/backend-gate.yml` now documents production-clone schema baseline through 0037.
- `docs/CHARTER.md` already contained the correct product contract: seasons advance from immutable Latest Set Daily history and temporary fallback never rolls the season backward.

Archived pre-rebuild documents that mention monthly leaderboards were left unchanged because they are explicitly historical.

## Follow-ups / non-blockers

1. **Mobile migration numbering:** draft mobile-auth PR #448 was created before seasons landed and currently proposes its own migration 0037 on a stacked mobile branch. That stack must be renumbered/rebased before it can merge onto current `main`.
2. **Legacy monthly compatibility:** the old worker/core monthly implementation is intentionally preserved. Only current Draft Run `month` requests canonicalize to competitive season.
3. **Future rollover:** no manual action should be required when a newer released regular set first becomes the immutable Latest Set Daily. The persisted resolver is the authority; fallback to an older set must not reopen an old season.

## Final state

As of the closeout:

- browser season UI is published on GitHub Pages;
- development and production schema include migration 0037;
- development and production Functions serve exact revision `fe9d666a094c0d18a13899a089a3ed49de67901a`;
- production release acceptance is green;
- The Hobbit is the persisted inaugural competitive season with start date 2026-09-16;
- no unresolved season-specific test, migration or deployment failure remains.
