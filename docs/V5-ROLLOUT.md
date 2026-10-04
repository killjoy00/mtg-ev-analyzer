# Uncapped v5 rollout — issue #889

## October 3 finalizer recovery

Run `37097278712` at `388d9ab045240e0d96a4b1382f140e35fc91d0b4`
successfully built all 30 active environments. MID/VOW remain intentionally
retired. Finalization assembled the candidate and QA, then failed three tests.
The MSH audit and v5 component negative-parent assertion referred to v4 sample
details. The revised audit checks the actual big-disagreement scoring category;
the negative component assertion explicitly uses immutable v8.

The Cube failure was a real session exclusion gap. At `cube-22`, round 1, the
first replacement `d4e96322d884d6805decda0fcbf86c91` could only reroll to a source
already used in round 5. The old assembly check excluded only the original and
first replacement. Gameplay excludes all eight original source drafts.

V5 final assembly now uses the runtime eligibility, difficulty and distance
functions to prune unsafe Cube baseline decisions. Each retained decision has
at least nine distinct eligible first-replacement sources; every possible first
replacement has at least eight second-replacement sources, excluding the
original and first sources and preserving the original difficulty anchor.
Any seven other run sources therefore leave two first choices and at least one
second choice. The check considers all candidates because exclusions can alter
the closest 20. It also preserves each round's medium/hard availability.

On the exact saved Cube artifact, this retains 722 of 781 baseline decisions,
including 416 currently selectable decisions. All retained payloads are
unchanged. The complete 13,673-puzzle Premier trophy snapshot, Traditional
artifacts, replay selection, training and historical v8 remain unchanged.
The exact preflight report is `results/v5-recovery/cube-session-preflight.json`;
1,000 seeds passed 16,000 chained runtime rerolls with original anchors.

The reviewed `rebuild-v5` request accepts an optional numeric `reuse_run_id`.
Recovery verifies the source was the main v5 workflow, every expected environment
job succeeded, all 30 matching artifacts remain available, and the source
commit's computed build identity equals the current one. It refuses code/input
identity changes rather than relabeling checkpoints. All environment phase
hashes, assembly, QA, normal tests, loaders and R2 verification still run.

For this recovery the environment build identity remains
`ccd0012b4733ca94b37baa68636dee0be60b7ee2bf5b572ff4fe8e2a27e2601e`.
No Python training/build script changed. The candidate separately records the
original environment run/commit and the reviewed finalizer run/commit. Cube
admission evidence is checksum-bound to the candidate and reverified before
staging. A successful recovered candidate must still complete the development
and production release procedure below.

The proposed model is `strong-player-colour-stage-v5`, with corpus
`elite-trophy-colour-stage-v9`. V5 inherits the v4 architecture; its sole intended
model change removes the 5,000 behavior/co-pick training draft cap. “All drafts”
means every draft in the unchanged qualified Pack One cohort, not every raw
17Lands draft. Minimum experience, win-rate/rank selection, colour-table
construction, five-fold draft isolation, puzzle-source exclusion, calibration,
scoring, difficulty and serving rules stay unchanged.

## Current release state

This branch is preparation, not a releasable corpus. Production remains v8/v4.
No corpus switch, database deletion, result rewrite, source refresh or leaderboard
reset has occurred. The builder and version-safety changes can be reviewed independently.
Do not deploy v9 until the full rollout gates below pass.

`model-versions.json` separates the immutable v4 policy from v5. Replay, path,
regular, legacy and Cube command-line builders accept `--model-version`; v5
defaults to uncapped and refuses a positive or negative draft cap. `0` and an
omitted cap both mean all qualified drafts. Existing v4 defaults stay unchanged.
The full trophy importer follows the separately versioned corpus identity and
refuses mixed or capped v5 manifests. Checkpoint identity includes the model and
training-policy code. Frozen source-pin checks apply to reused checkpoints too.

Path-model architecture retains its own historical version. A v5 path artifact
records its v5 context parent, uncapped mode, full selected population and replay
exclusion count separately.

## Source pins and authorized refresh

`research/v5-production-source-pins.json` captures the original 32 production
Premier manifests; the component file captures the 23 served Traditional
supplements. These public source/build records contain no account information.
`research/v5-build-source-pins.json` pins the candidate inputs separately.

On October 2, 2026, the owner explicitly authorized newer HOB data and any other
newer available 17Lands data. Checking all 64 Premier draft/game objects found
only HOB changed. All 23 admitted Traditional draft archives still matched.
The candidate uses these October 1 HOB objects:

| Archive | SHA-256 | Compressed bytes |
| --- | --- | ---: |
| HOB draft | `04b16ac6971ca9a3b77c666072fb066110632eaae7e09433501cdcefac5045c0` | 75,309,805 |
| HOB game | `1ca977bb415ac8fce04b889b9b2d93a6540cf21a033dfa9fb0907af443000676` | 22,072,331 |

The original HOB source-recovery blocker is resolved. V4/v8 probabilities and
player history remain immutable even though newer inputs are authorized for v5.
Every downloaded build archive must match the candidate pin's SHA-256. HEAD
metadata is an availability check and never replaces byte verification.

## Remaining execution gates

1. Merge the implementation and its reviewed `rebuild-v5` request. The dedicated
   workflow freezes the reviewed commit and source/build identity, gives each of
   the 32 environments an independent job, and checkpoints replay, full-trophy
   and admitted Traditional phases separately in R2. Exact raw compressed bytes
   are retained by SHA-256 before computation. Failed phases can be rerun without
   losing completed environments or earlier phases. The existing regular,
   legacy and measured Cube builders retain replay selection and normalization.
2. Rebuild all 30 active replay/path environments and every active Premier trophy payload. MID and VOW were owner-retired from the active v5 plan on 2026-10-02; their historical v4/v8 records remain retained.
   For normal environments assert trained equals qualified. For legacy rank
   environments record the complete unchanged rank-proxy training cohort
   separately from source/trophy eligibility. No arbitrary replacement cap.
3. Rescore all admitted Traditional supplements using Premier-trained v5 graders,
   with unchanged source drafts, eligibility and Cube P2–P7 serving window.
   Traditional evidence must never enter Premier model training. Add explicit
   v5 component identities, additive schema constraints and loader support.
4. Finalize v9 only after all model-dependent artifacts are v5 and exact frozen
   provenance/accounting/holdout/trajectory/image/replay/R2 checks pass. Generate
   rebuild QA, including training counts, support/leader/score/difficulty/rating
   changes, largest changes, cohort drift and invalid numerical output. This is
   implementation QA, not a separate model-selection experiment.
5. Complete required `test` and `browser` CI, merge implementation/generated PRs,
   stage the exact candidate to development and run real API/game acceptance.
   Promote those same verified artifacts to production and run acceptance there.

## Cross-version serving cutover

The environment policy has one active Premier snapshot pointer per set while a
deployed worker requests one explicit parent corpus version. Therefore activation
and worker deployment are not treated as atomic.

Before activating any v9 pointer, the target must have migration
`0049_cross_version_corpus_cutover.sql` and the v8 bridge worker deployed. The
bridge keeps immutable historical-frozen v8 parent rows eligible only when the
environment's active pointer belongs to a different corpus version. It does not
relax same-version snapshot selection, component publication, source exclusions,
quality floors or lifecycle gates.

Use this order in development, then production with the exact same candidate:

1. apply the cross-version migration as part of the stage-only operation, then
   stage and verify v9 without changing active pointers; inactive future-version
   rows and Candidate components do not churn the current serving revision;
2. deploy the reviewed v8 bridge worker before any active pointer changes;
3. health-check and activate the exact v9 snapshots/components. A revision
   change may carry the verified v8 cache forward only when an exact database
   comparison proves its selector inventory and environment metadata are
   unchanged; otherwise normal readiness remains fail-closed;
4. deploy the exact accepted v9 release commit, then complete v9 readiness and
   gameplay acceptance;
5. on rollback, deploy the bridge/v8 worker before restoring the captured v8
   pointers with compare-and-swap, then verify the restored v8 revision.

## Fresh v5 standings and rollback

The owner selected fresh v5 standings for every public leaderboard period and
environment, while retaining historical scores/results and personal history.
Leaderboard SQL filters by v9 only when the current serving corpus becomes v9.
This activates with the serving transition; it does not delete historical rows.
Fixed historical Dailies remain tied to their original corpus and probabilities.
An old Daily completed after the transition does not enter v5 standings.

V8/v4 must remain intact in Git, Neon and the existing versioned R2 namespace.
Preserve old serving policy/revision and payload/record checksums before promotion.
Rollback restores v8 serving and its existing historical leaderboard behavior
without rebuilding v4 or destroying v5. Record the exact validated candidate,
live revision and rollback revision in this runbook when rollout completes.

The v9 baseline replay-derived corpus and complete first-class trophy snapshot
are separate immutable inventories. Staging accounts for both, while serving an
active snapshot selects only that snapshot's rows. V5 verification checks the
exact snapshot count separately, so baseline rows cannot masquerade as complete
snapshot coverage. New source proof is extracted for the new replay sample from
the pinned raw bytes; old capped-sample evidence is never relabeled as v5.
