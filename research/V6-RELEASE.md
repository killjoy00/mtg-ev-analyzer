# v6 release: corpus v10

v6 (`strong-player-colour-stage-v6`) passed its frozen held-out test ([V6-COLOUR-MODEL.md](V6-COLOUR-MODEL.md)). The owner approved releasing it as one uniform model, rescoring every Traditional source including blocked sets, admitting whatever passes without a further approval, and keeping standings continuous. This records how.

## Premier corpus

- All 31 production v9 environments are rebuilt from the exact inputs of their active v9 snapshots (`research/v6-build-source-pins.json`, read from the production `full_import` manifests and re-checked against 17Lands on 2026-10-29). No source is refreshed, so each environment keeps its v9 qualified cohort and cutoff, and only the colour policy changes.
- FRA has no replay environment in v9. It rebuilds its trophies and Traditional only, as in v9. Because it has no checked-in baseline, staging carries its v9 discovery manifest to a v10 version row (`scripts/v6-carry-database-environments.mjs`), without the v9 import evidence, before the v10 trophy import. The first development stage (run 41275079226) stopped at FRA for want of that row. The retry (run 41306972709) then showed that the importer registered a database-discovered environment only while it was a Candidate or still being discovered, so it refused FRA, which is Live. An exact Blocked parent snapshot of that environment at the target version now registers it for that import only, as the checked-in catalog does for every other environment. A Live set without its own Blocked snapshot is still refused.
- `scripts/v6_rebuild.py` mirrors the v5 rebuild: per-environment jobs, content-addressed R2 checkpoints, assembly only after every environment passes provenance, training and file checks. `scripts/v6_rebuild_qa.py` compares each set decision by decision with the accepted v9 candidate when that candidate was built from the same inputs.

## Traditional admission rule

1. Every environment with a measured Traditional source is rescored with Premier-trained v6 graders: all 27 Phase 2 environments and FRA, 28 in all (`research/v6-traditional-source-pins.json`). No Traditional observation is used for fitting, and every gate threshold is unchanged.
2. Membership is the measured source list:
   - the v4 Phase 2 artifacts (run 35662906382) for the 26 Phase 2 sets other than HOB;
   - FRA's new-set artifact (run 39451056661);
   - for HOB, a fresh v6 measurement of its current pinned Traditional archive. 17Lands replaced HOB's original Traditional archive on 2026-10-01, so the original list cannot be reproduced.
3. Each set is scored once, on its approved window only: regular P1P1-P1P8, FRA P1P1-P1P6 (approved 2026-10-20) and Powered Cube P1P2-P1P7 (approved for v3/v4).
4. There is no fallback. A set that fails its window is not admitted. A set admitted under v9 that fails is reported in `no_longer_admitted` and its Traditional puzzles are dropped from v10; the release continues (owner, 2026-11-01).

An earlier draft let failing sets fall back to a narrower window. The owner rejected it on 2026-10-29, after local previews, before any rebuild ran.

## Serving and standings

- Migration 0069 admits the three v6 component identities on the v10 parent with their approved windows and enforces the v10 model pair.
- During cutover the v9 runtime keeps serving the exact v9 snapshot that each active v10 snapshot superseded: a bridge in both the serving-cache builder and the worker query. A same-version refresh never qualifies, so no set serves two snapshots.
- Standings continue: under v10 the leaderboard counts v9 and v10 results together (`STANDINGS_LINEAGE`). v9 itself started from v9 results only; that is unchanged.
- Recorded scores, sessions and v9 data are not rewritten. Rollback restores the captured v9 pointers after the bridge is redeployed.

## Cutover regression and private evidence

- The PostgreSQL serving-carry contract executes the release script's actual activation and rollback SQL on synthetic snapshots. It checks exact v9 inventory preservation, continued ready-cache publication, v10 isolation, rejected incomplete activation and rollback. Same-version supersession must not enable the bridge.
- Migration 0069 applies the same cross-version membership rule to both cache construction and exact-equivalence checking. Without the latter, activation rejects the still-valid v9 cache instead of carrying it to the new revision. The schema baseline accepts the measured definitions before and after the migration.
- Preservation baselines contain private record fingerprints and activity counts. Release artifacts carry only authenticated encrypted baselines; logs report sanitized success indicators. The trusted workflow derives the encryption key from its existing `NEON_API_KEY` with a release-specific HKDF context and random salt. No new credential is created. Keep that credential available throughout the rollback window; rotating it requires an explicit evidence re-encryption plan before the old credential is discarded. Decryption fails closed on a wrong credential or modified artifact.

## Finalization reference repair

Run 40987407495 completed all 31 environment builds but stopped during finalization with six JavaScript test failures. Five were reference lifecycle errors: the current-corpus fixture inventory still described v9, and four frozen puzzle-review checks read the mutable live corpus. Finalization now refreshes the current-corpus fixtures and includes them in the rollout PR, while requiring the accepted historical scoring golden file to stay byte-identical. Rated puzzle reviews retain their complete original v9 selection inputs, verified against the hashes in their unchanged review keys.

The remaining failure compared mean counterfactual probability movement across different early and late packs. In the v6 replay diagnostic, early movement was 2.57 percentage points and late movement was 2.52; 1,202 of the 7,500 late decisions had only one choice. The late multi-choice mean was 3.00. That aggregate ordering is not a model invariant: available choices, stored support and the simulated path all change. Controlled tests now hold candidate evidence and pool composition fixed, require conditioning to strengthen with commitment and saturate, and verify that a forced choice has probability one despite path evidence. Historical-path identity, random-path margins, leader response and multiplier bounds remain enforced on real replay data; early/late and per-pick movement remain diagnostics.

The repair changes no Python build inputs, model implementation, Traditional admission thresholds or release protections. The reviewed finalize request reuses run 40987407495 only after the existing identity and successful-environment checks pass.

## Activation bridge repair (migration 0070)

The first development activation committed the v10 pointers. It then stopped with "v9 bridge readiness was not preserved", before any Traditional publication. The cause was 0049's historical-parent clause, which 0069 kept. It bridges a set's v9 baseline rows that have no source snapshot, which is right for a set that served that baseline. After a cross-version activation, it also bridged those rows for sets whose v9 runtime actually served a first-class v9 snapshot. They were never served. So the membership rule disagreed with the ready v9 cache, and the exact-equivalence check refused to carry it.

Migration 0070 makes both `pack1_build_serving_snapshot` and `pack1_serving_snapshot_matches_current` skip the historical-parent clause when a first-class v9 snapshot of the set was superseded by its active snapshot. Sets whose baseline was what they served keep 0049's bridge. On development, the corrected rule reproduced the existing ready v9 cache exactly, with no missing or extra entries; the 0069 rule did not. The release applies 0070 before any readiness or pointer change.

`resume-activation` finishes a committed activation without moving pointers. After v10 is ready, it carries v9 readiness only from the latest prior ready job, and only if that job's cache passes the exact-equivalence check; otherwise it stops. The PostgreSQL contract covers the refusal of a non-equivalent cache, the exact carry and an idempotent rerun. Production activated with 0070 already applied. The ready v9 bridge cache carried to the new revision through the exact-equivalence check, and v9 Practice kept serving with no gap.

## Release CI and resume repairs

- **Cutover contract fixture.** The serving-carry contract assumed its prepared database held v9. Once v10 became the checked-in corpus, that fixture was prepared at v10. Inside its disposable transaction, the contract now returns the fixture to the cutover-time state before executing the release SQL. The relabel is foreign-key safe and every assertion is unchanged.
- **Resumed publication.** Publication's reverify step required every component to be an unpublished Candidate, so a resume after some components went Live was refused. On resume it now accepts components it already published. First activation still requires every component to be a Candidate.
- **Concurrent readiness lease.** On development, a delayed scheduled smoke run, triggered by activity on main, took the readiness lease during publication, and the resume stopped at SOS. The identical request was re-run with `replay_of`. Nothing was merged to main between production activation and the production deploy. Publication still does not tolerate a concurrent readiness lease; that is open.
- **Backend gate fixtures.** The backend gate clones production. After the production cutover, two fixtures failed:
  - The Pacific report-date check placed its arrival before the first v10 session.
  - The corpus-transition smoke assumed HOB was Premier-only.

  Both now derive their setup from the cloned state (#1469).

## Outcome

Development, then production, each completed:

- stage
- activation
- Traditional publication
- release deploy of `d3a2847`, replacing the v9 bridge `914dac3`
- revision, coverage, Daily and live Practice acceptance

On production:

- **Corpus.** All 31 environments serve v10, and both the v10 cache and the v9 bridge cache are ready.
- **Traditional.**
  - **Measured and admitted.** Of the 28 measured environments, 24 passed their approved windows. 23 are Live, including FRA, HOB and Powered Cube. SIR is staged and stays a Candidate because its environment is a Candidate.
  - **Newly admitted.** HOB, which had no Traditional in v9.
  - **Dropped.** MH3 was admitted under v9 and failed under v6. It is reported in `no_longer_admitted` and its Traditional puzzles are dropped from v10.
  - **Not admitted.** HBG, KTK and PIO, which were not admitted in v9 either.
- **Standings.** The deployed code counts v9 and v10 results together on v10 leaderboards. This was checked in code; the production acceptance does not exercise it.

Open follow-ups:

- **Trophy decks.** HOB's Traditional puzzles have no trophy decks. The deck catalog was built on 2026-10-20 and covered only Traditional components already live, plus FRA's approved set; HOB Traditional is new in v6. SIR's Traditional puzzles have none either. The same cause is inferred there, since SIR's environment was a Candidate, but it was not verified. Both need a catalog backfill; the puzzles play without the trophy-deck view until then.
- **Publication robustness.** Publication should tolerate another readiness job holding the lease.

Rollback is the reverse of the deploy order:

1. Redeploy the bridge `914dac3`.
2. Run `rollback` with production stage run 41323586473.

Keep `NEON_API_KEY` unrotated until the rollback window is closed (see above).

## Sequence

Each step is a reviewed `.github/model-rollout-request.json` change on main.

1. `rebuild-v6` builds the candidate and opens the generated rollout PR.
2. Review `results/v6-rebuild` (QA and Traditional admissions), then merge the rollout PR.
3. Deploy the bridge (main before the rollout PR) to development, then `v6-corpus-release` stage and activate on development, then deploy the release commit and accept.
4. Repeat on production.
