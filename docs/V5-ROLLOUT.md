# Uncapped v5 rollout — issue #889

## October 3 finalizer recovery

Run `37097278712` at `388d9ab045240e0d96a4b1382f140e35fc91d0b4`
successfully built all 30 active v9 environments. MID/VOW were excluded from
this active v9 rebuild/selection scope; their historical v8 policy, snapshots,
manifests and reads remain retained and must not be purged. Finalization assembled
the candidate and QA, then failed three tests.
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

## Current release state — completed October 4, 2026

Issue #889 is complete. Production serves `strong-player-colour-stage-v5` on
`elite-trophy-colour-stage-v9`.

The immutable accepted candidate is rebuild run `37132557406`, build identity
`ccd0012b4733ca94b37baa68636dee0be60b7ee2bf5b572ff4fe8e2a27e2601e`.
It contains 30 active v9 Premier parents / 980,984 Premier puzzles. Production
activation run `37168731594` switched all 30 approved parent pointers, published
22 eligible Traditional v5 components, and intentionally left SIR Traditional
Candidate. Both v8 and v9 readiness were Ready at production serving revision
`110`.

The accepted v5 runtime commit is
`5ef9c9230d83ca6a72210cf50e76c12b3ceb471a`; production runtime acceptance
run `37171099238` and normal live browser acceptance run `37171455258` passed.
Later guarded worker deployments may advance application code without changing
the immutable v5/v9 corpus. The October 4 worker deployment of
`0ff55f6084b4ca372ec2457b0d81611054be6e96` (run `37216039560`) again passed
live v5 health/readiness and account-linked Practice acceptance against production,
with the same v9 corpus and readiness revision 110.

Rollback was exercised for real in development. Run `37156639632` restored all
30 captured v8 pointers and the bridge; accepted restoration run `37160251710`
returned development to v9. Production retains all 30 original v8 rollback
parents as Superseded with unchanged manifests and successor lineage. The original
v8 manifest aggregate is
`da99938bdf0ca3e618f5b7bb94c7390f`.

Historical results were not rewritten or deleted. The final audit against the
original production baseline found zero missing original rows across game
results, environment results, scores, Draft Run sessions, completed sessions and
schedules. Public v5 standings are corpus-scoped to v9 while historical results
and personal history remain readable.

MID and VOW are not members of the active 30-environment v9 candidate or automatic
selection policy. Their historical v8 source records, snapshots, manifests,
policy/history and reads are retained. In this runbook, "retired" must not be
interpreted as authorization to purge that historical v8 state.

The durable machine-readable closeout is
`research/v5-production-release.json`. The pre-rollout handoff
`docs/V5-HANDOFF-2026-10-02.md` is historical and must not be used as current
deployment state.

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

## Completed execution gates

All rollout gates below completed without relaxing model, source, correctness or
latency thresholds:

1. The 30-environment all-qualified rebuild completed and was recovered from its
   saved successful environment artifacts after finalizer fixes. The accepted
   immutable candidate is run `37132557406`.
2. Development staging, v8 bridge deployment, v9 activation and exact-runtime
   Daily/Practice acceptance passed.
3. A real development rollback restored the captured v8 state, verified the
   bridge and original history, then successfully reactivated the exact v9
   candidate.
4. Production staging verified exact pinned sources, immutable candidate bytes,
   all 30 parents and retained history before activation. Production activation
   `37168731594` passed full serving quality, including 40 Daily runs / 320
   decisions / 23 custom sets and Powered Cube 10,000 selector simulations plus
   20 SQL parity runs.
5. Exact production runtime acceptance `37171099238` and normal live browser
   acceptance `37171455258` passed. Historical public scores remained retained
   while new standings became v9-scoped.
6. The exact-pick performance work was separately accepted and promoted through
   #938/#939/#940 after final backend, performance and five-network distributed
   evidence passed. Migration `0051_exact_pick_draw_index.sql` remains in the
   normal migration manifest; its special one-time release request/workflow was
   retired after successful production promotion.

The authoritative accepted counts, run IDs, rollback evidence and historical
retention values are recorded in `research/v5-production-release.json`.

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
