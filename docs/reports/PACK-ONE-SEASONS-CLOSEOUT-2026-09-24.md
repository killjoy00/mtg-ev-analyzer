# Pack One competitive seasons closeout — 2026-09-24

## Outcome

Pack One competitive seasons are implemented, merged, migrated, deployed and live in production.

The original season feature shipped as `fe9d666a094c0d18a13899a089a3ed49de67901a` from PR #460. The reviewed post-release hardening is application revision `9763e7caf87f20ca4bc77d82b8513a3d365db5c9` from PR #476. Production Neon Postgres now carries reviewed migrations through `0038_pack_one_season_hardening.sql`, and development and production Functions both serve the same exact hardened application revision.

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

PR #470 repeated the same production migration requested by #469; it changed only `request_id` and `reason` while keeping the same operation, exact commit and production target. The rollout bridge serialized the dispatches but had no semantic replay guard at the time. The second execution was harmless only because migration 0037 is additive/repeatable; a non-repeatable migration would not have had that safety property.

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

- `docs/CURRENT-STATE.md` records the live hardened Function revision, schema through 0038, inaugural HOB evidence and both release chains.
- `docs/REQUEST-INTEGRITY.md` records the completed 0037 feature rollout, the 0038 hardening rollout, stable-marker acceptance, and rollout replay protection.
- `README.md` describes the season leaderboard periods, monotonic season behavior, legacy month compatibility and profile standings.
- `.github/workflows/backend-gate.yml` documents the production-clone schema baseline through 0038.
- `docs/CHARTER.md` already contained the correct product contract: seasons advance from immutable Latest Set Daily history and temporary fallback never rolls the season backward.

Archived pre-rebuild documents that mention monthly leaderboards were left unchanged because they are explicitly historical.

## Post-closeout review correction

A subsequent code review identified three production-hardening gaps that were not captured in the original closeout:

- Profile assembly treated current-season enrichment as required, so a reconciliation failure could fail My Pack One, public profiles and profile-setting saves.
- Reconciliation rescanned all historical Latest Set schedules on every call. A fallback set that never owned a season therefore remained dependent on its mutable policy row indefinitely; later policy deletion or metadata damage could poison future reconciliation.
- The shared season resolver could call Daily creation, which meant a profile request through `pack1growth` could create the immutable Latest Set Daily during a mixed-revision deployment.

The original statement that established season metadata survives later policy edits remains true for sets already persisted in `draft_run_seasons`, but it was too broad as a statement about the safety of reconciliation as a whole. Likewise, describing the first natural rollover as merely worth observing understated the risk while these failure domains remained coupled.

The follow-up hardening adds migration 0038 with a durable reconciliation watermark, makes profile season enrichment fail open, removes Daily creation from profile/growth reads, strengthens Live metadata admission, and adds semantic rollout replay protection. That hardening is now fully promoted: PR #476 merged exact application revision `9763e7caf87f20ca4bc77d82b8513a3d365db5c9`; migration 0038 passed development run 36020410138 and production run 36022058215; the same exact revision passed development deploy/acceptance 36021141621 and production deploy/acceptance 36023616589. The three post-release failure-domain risks identified above are therefore remediated in the live production runtime.

See [the dedicated season hardening closeout](PACK-ONE-SEASONS-HARDENING-CLOSEOUT-2026-09-24.md) for the remediation and release evidence.

## Follow-ups / non-blockers

1. **Mobile migration numbering:** the stacked mobile work was created before the season migrations stabilized: PR #448 still carries a historical 0037 migration and PR #461 carries a historical 0038 migration on later stack layers. Current `main` now owns 0037 and 0038, so the mobile migration chain must be rebased and renumbered before merge.
2. **Legacy monthly compatibility:** the old worker/core monthly implementation is intentionally preserved. Only current Draft Run `month` requests canonicalize to competitive season.
3. **Future rollover observation:** the first natural rollover remains useful operational confirmation of the season-advance path against newly promoted corpus policy. It is no longer a release blocker: profile enrichment fails open, settled history is protected by the reconciliation watermark, profile reads cannot create Dailies, and incomplete new-set metadata is rejected before Latest Set use.

## Final state

As of the closeout:

- browser season UI is published on GitHub Pages;
- development and production schema include migrations 0037 and 0038;
- development and production Functions serve exact hardened revision `9763e7caf87f20ca4bc77d82b8513a3d365db5c9`;
- production hardening acceptance run 36023616589 is green;
- The Hobbit is the persisted inaugural competitive season with start date 2026-09-16;
- the post-closeout failure-domain findings are remediated in production;
- the remaining season-specific follow-up is operational observation of the first natural future rollover, not a known unresolved outage path.
