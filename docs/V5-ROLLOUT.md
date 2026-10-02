# Uncapped v5 rollout — issue #889

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
2. Rebuild all 32 replay/path environments and every Premier trophy payload.
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
