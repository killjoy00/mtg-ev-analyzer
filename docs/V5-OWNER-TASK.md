Repo: `killjoy00/mtg-ev-analyzer`

Build, validate, stage, and ship a new **Pack One v5 consensus model** whose only intentional modeling change from the current v4 model is:

> **Remove the 5,000-draft behavior-model training cap and train each environment on every qualified draft available under the existing eligibility rules.**

This is an execution task, not a research proposal.

Do **not** stop after analysis, planning, implementation, or opening a PR. Carry the work through the complete repository workflow: implementation → tests → full corpus rebuild → QA → development deployment/acceptance → production promotion, unless an actual safety, permissions, destructive-action, or infrastructure blocker prevents proceeding.

Do not ask for routine approvals between steps. Make reasonable implementation decisions from the repository's existing conventions and document them afterward.

Do **not** run a separate v4-vs-v5 model-quality experiment before proceeding. We have already decided to build the all-qualified-data v5 model.

## Goal

Create and ship:

- Model version: `strong-player-colour-stage-v5`
- A new corpus version after the current `elite-trophy-colour-stage-v8`, following the repo's existing versioning conventions
- A complete rebuilt corpus where every supported environment is consistently scored with v5
- Development validation
- Production promotion of the exact validated artifacts
- A reversible serving transition that leaves v4/v8 intact

The current v4 model, existing v8 corpus, historical puzzle probabilities, and historical player results must remain immutable.

## 1. Inspect current repository state first

Before editing:

- refresh `main`
- inspect open PRs
- inspect active branches/workflows touching model, corpus, imports, scoring, deployment, or serving
- identify any current work that could conflict with this change
- incorporate rather than overwrite relevant concurrent work
- base implementation on the latest reviewed repository state

Do not work from stale assumptions about the September rebuild process if newer infrastructure now exists.

## 2. Implement v5

Start from the current `strong-player-colour-stage-v4` implementation.

Preserve v4 behavior except for the behavior-model training cap.

Keep unchanged:

- strong-player/qualified cohort definition
- minimum experience rules
- win-rate/rank cohort logic
- historical-set cohort handling
- pair/context model
- colour/stage model
- five-fold holdout/isolation by `draft_id`
- puzzle-source evidence isolation
- calibration
- score formula
- difficulty logic
- trophy eligibility
- replay selection
- serving rules
- all other v4 constants and algorithms

Change only:

```text
behavior/co-pick training evidence

CURRENT:
qualified cohort
→ stable selection/order
→ first 5,000 drafts
→ train

V5:
qualified cohort
→ use every qualified draft
→ train
```

Do not replace 5,000 with another arbitrary large cap.

The required behavior is genuinely **uncapped within the qualified cohort**.

Examples from current production evidence:

- MOM: 5,000 → 29,313
- LTR: 5,000 → 28,016
- FIN: 5,000 → 20,366
- BLB: 5,000 → 16,463
- SOS: 5,000 → 15,477
- MSH: 5,000 → 9,728
- HOB: 2,341 → 2,341
- TMT: 3,126 → 3,126
- KTK: 2,548 → 2,548

Current colour tables may already use all eligible drafts. Preserve that behavior.

The intended v5 change is specifically removal of the cap from the behavior/co-pick evidence that is currently restricted to 5,000.

## 3. Give v5 its own model identity

Create a new explicit model version:

```text
strong-player-colour-stage-v5
```

Do not mutate the semantic meaning of `strong-player-colour-stage-v4`.

Audit the entire repository for version assumptions and update everything required for v5, including where applicable:

- builders
- importers
- model constants
- serializers
- manifests
- model-version checks
- database constraints
- allowlists
- loaders
- health gates
- corpus administration
- replay tooling
- R2 artifact paths
- workflows
- tests
- deployment validation
- documentation

V4 and v5 artifacts must be distinguishable and unable to silently substitute for one another.

## 4. Remove the 5,000 assumption everywhere in the v5 path

Search broadly for:

- `5000`
- `TRAINING_DRAFT_CAP`
- `max_training_drafts`
- `training_cap`
- `training_drafts`
- model-version-specific assumptions

Do not blindly remove every occurrence of 5,000. Preserve historical v4 behavior and tests where appropriate.

Instead, ensure that every **v5 build path** uses all qualified drafts.

Cover at least:

- regular PremierDraft imports
- full trophy imports
- full corpus rebuild
- legacy MID/VOW handling
- Powered Cube
- replay generation
- rebuild workflows
- checkpoint/resume behavior
- validation logic
- generated manifests
- corpus publication

There must be no hidden path where v5 silently falls back to 5,000.

## 5. Add strong regression and safety tests

Add tests proving at minimum:

1. A v5 set with 12,000 qualified drafts trains on 12,000.
2. A v5 set with 29,313 qualified drafts trains on 29,313.
3. A set with 2,341 qualified drafts trains on 2,341.
4. No default 5,000 cap exists in any v5 production build path.
5. V4 still retains its historical behavior.
6. V5 artifacts are explicitly labeled v5.
7. V4 artifacts cannot masquerade as v5.
8. V5 corpus validation rejects mixed v4/v5 model identities.
9. Existing holdout/isolation behavior remains intact.
10. Puzzle-source evidence isolation remains intact.
11. V8/v4 immutable assets are not rewritten.
12. Same pinned inputs produce deterministic outputs wherever the current architecture promises determinism.
13. Legacy environments use the complete intended cohort.
14. Powered Cube uses its complete intended cohort.
15. Generated manifests record the uncapped/all-qualified mode correctly.

Run the appropriate repository test suite after implementation.

Fix failures caused by this work rather than papering over them.

## 6. Create a dedicated v5 full-rebuild workflow

Use the existing checkpointed v4/v8 rebuild architecture as the starting point.

Do not create a fragile single-run process that loses hours of work on timeout.

Create or adapt a workflow specifically for the v5 rebuild.

It should:

- rebuild every supported environment
- split expensive work into recoverable/checkpointed chunks
- use versioned artifacts
- resume safely after failures
- preserve exact source provenance
- rebuild legacy sets correctly
- rebuild Powered Cube correctly
- upload/verify replay artifacts
- build the new corpus only after all environments are complete
- fail closed on mixed or stale model artifacts
- open or update the appropriate rollout PR automatically

The workflow should be safe to rerun.

## 7. Rebuild every supported environment

Run the full v5 rebuild.

Do not stop after creating the workflow.

Rebuild all currently supported environments included in the current corpus.

For each environment, retain the same pinned source provenance as the current serving corpus unless current repository policy explicitly requires a newer source snapshot.

Do not casually refresh historical source data as part of this model change.

Record at minimum:

- set/environment ID
- source snapshot
- source archive hash/ETag
- game archive hash/ETag where applicable
- qualified drafts
- training drafts
- training picks
- training mode
- model version
- corpus version
- holdout strategy
- import/build identity

For normal environments, assert:

```text
training_drafts == qualified_drafts
```

If legacy or special environments define those concepts differently, implement the correct equivalent invariant and document it.

Do not accept:

```text
training_drafts == 5000
```

for a set with more than 5,000 qualified drafts.

## 8. Build a brand-new corpus

Create a new corpus identity after v8 using the repository's current versioning convention.

The new corpus must be uniformly:

```text
model_version = strong-player-colour-stage-v5
```

Rebuild/rescore all required puzzle payloads under v5.

Do not simply append new v5 puzzles to an old v4 corpus.

Do not reuse old v4 support probabilities while relabeling them v5.

Regenerate all model-dependent derived artifacts required by the current serving architecture, including as applicable:

- puzzle support
- ratings
- difficulty metadata
- replay artifacts
- set manifests
- corpus manifests
- source evidence
- health evidence
- serving metadata

Preserve historical v8/v4 assets and historical gameplay records.

## 9. Generate rebuild QA automatically

Do not run a separate pre-build model-selection experiment.

After the full corpus exists, generate a v4 → v5 QA report as a rebuild validation artifact.

This is for detecting implementation mistakes and unexpected behavior, not deciding whether v5 should exist.

Include:

- training drafts before/after by set
- total v4 vs v5 behavior-training population
- support/probability displacement
- percentage of puzzles whose model leader changes
- score displacement
- difficulty/rating displacement
- largest puzzle-level changes
- set-level outliers
- missing or unexpected cohort changes
- any model output NaNs/infinities/empty evidence
- any unusual distribution shifts
- v4/v5 artifact identity checks

Surface large changes clearly.

Do not automatically abandon v5 because values moved. Investigate whether the movement is technically correct.

## 10. Run the complete validation suite

Validate the candidate corpus comprehensively.

At minimum verify:

- all expected environments are present
- all environments report v5
- no v4 artifacts exist inside the new v5 corpus
- source provenance is correct
- all qualified drafts are used
- five-fold isolation still works
- source/puzzle exclusion still works
- trophy trajectories validate
- images validate
- replay shards validate
- R2 artifacts validate
- corpus accounting balances
- ratings/difficulty generation succeeds
- serving-quality gates pass
- schema/version constraints accept v5
- loaders accept v5
- older corpus compatibility tests still pass
- existing historical v4/v8 data remains unchanged

Run the full normal repository test suite as well.

Fix failures caused by v5.

## 11. Open and merge the implementation/rebuild PRs

Do not stop at "PR ready for review" unless repository protections physically prevent further action.

Use the repo's normal PR process.

Where repository permissions and policy allow:

- create the implementation PR
- ensure CI passes
- resolve conflicts
- merge it
- launch the rebuild
- allow generated-data/rebuild PRs to be created
- verify generated outputs
- merge the resulting reviewed/generated corpus changes when gates pass

Do not merge unrelated failing work or bypass repository protection rules.

Do not force-push over somebody else's active branch.

## 12. Stage the exact v5 build to development

Once the complete corpus passes validation, stage the exact generated artifacts to development.

Do not rebuild another slightly different copy for development.

Use the repository's normal corpus loading/publication mechanism.

Run real development acceptance checks covering:

- Daily generation
- Daily completion
- Practice
- Latest Set
- set-specific practice/archive
- Powered Cube
- score calculation
- result persistence
- rerolls
- friend/shared runs
- account-linked and guest behavior where relevant
- leaderboard behavior/version handling
- admin corpus health
- source/corpus identity
- serving revision
- serving readiness

Inspect real HTTP/API results rather than relying only on unit tests.

Fix v5-related issues and repeat validation as needed.

## 13. Promote the exact validated artifacts to production

After development passes, continue directly to production promotion.

Do not wait for another routine approval unless the repository's production mechanism explicitly requires human authorization or credentials unavailable to the agent.

Production must receive the exact v5 artifacts validated in development.

Before switching serving, verify:

- model version is v5
- corpus version is the new version
- all environments expected for production are present
- health gates are passing
- serving readiness is passing
- production schema recognizes v5
- rollback remains available
- historical v4/v8 assets still exist

Then promote/switch serving using the repository's normal production mechanism.

Do not delete or overwrite the v8 corpus.

## 14. Run production acceptance after promotion

After the production switch, verify the live product.

At minimum run smoke/acceptance checks for:

- production corpus/version identity
- Daily retrieval
- Daily completion
- scoring
- practice
- Latest Set
- Powered Cube
- rerolls
- shared/friend runs
- persistence
- leaderboard/version behavior
- admin corpus health/readiness

Confirm new sessions use the v5 corpus.

Confirm historical v4/v8 data remains accessible/consistent where expected.

If production acceptance exposes a serious v5 deployment problem, use the established rollback mechanism to restore v8 serving, fix the issue, and re-promote the same reviewed v5 candidate or a properly versioned corrected candidate as appropriate.

Do not destroy the v5 artifacts during rollback.

## 15. Preserve rollback capability

The rollout must be reversible.

The final production architecture should effectively support:

```text
v8 → strong-player-colour-stage-v4
new corpus → strong-player-colour-stage-v5
```

Switching back to v8 must not require rebuilding v4.

Do not mutate historical records in a way that makes rollback impossible.

## 16. Do not introduce unrelated model work

Do not bundle any of the following into v5 unless strictly required to make the uncapped rebuild function:

- new calibration experiments
- new sharpening exponent
- new scoring curve
- new outcome model
- GIH/IWD model
- doubly robust modeling
- new context architecture
- stage-model redesign
- new skill cohort definition
- new Daily selection logic
- new difficulty design
- unrelated UI/product work

If you encounter an unrelated issue, document it separately.

The intentional modeling delta must remain:

```text
v4
+
all qualified behavior-training drafts
=
v5
```

## 17. Documentation

Update relevant model/data/corpus/runbook documentation.

State clearly:

- v5 inherits the v4 architecture
- v5's intentional change is removal of the 5,000 behavior-training cap
- v5 uses every qualified draft in each environment
- qualification criteria are unchanged
- colour-table behavior is unchanged
- existing holdout/source-isolation rules remain
- v5 has a separate model identity
- the new corpus has a separate corpus identity
- v8/v4 remains immutable and available for rollback
- "all drafts" means all **qualified** Pack One cohort drafts, not every raw 17Lands draft

Remove or update operational documentation that would cause future v5 rebuilds to accidentally reintroduce the 5,000 cap.

## 18. Keep going through recoverable failures

For ordinary CI, build, workflow, or deployment failures:

- inspect the failure
- fix the cause
- rerun the failed portion
- preserve checkpoints
- continue the rollout

Do not stop merely because the first run fails.

Only stop and report a blocker when proceeding would require something genuinely unavailable or unsafe, such as:

- missing credentials/permissions
- repository protection requiring a human action
- destructive production operation without a safe/reversible path
- evidence that the proposed action would overwrite historical immutable data
- an infrastructure outage preventing execution

Otherwise, continue autonomously.

## 19. Final report

At the end, provide a concise but complete report containing:

- implementation PR(s)
- rebuild/generated-data PR(s)
- merged commit(s)
- exact v5 model version
- exact new corpus version
- number of environments rebuilt
- qualified drafts by environment
- training drafts by environment
- total qualified/training drafts in v5
- confirmation that every eligible v5 environment uses the complete qualified cohort
- confirmation that no hidden 5,000 cap remains in the v5 production path
- confirmation that v4/v8 remained unchanged
- tests and validation performed
- v4→v5 rebuild-QA summary
- development deployment result
- development acceptance result
- production promotion result
- production acceptance result
- live serving revision/version
- rollback state
- any non-blocking follow-up items discovered

Do not finish with a list of commands for me to run if those commands can be run by the agent.

Carry the task through as far as repository permissions and infrastructure allow.

The desired end state is:

> **Pack One production is serving a fully versioned v5 corpus in which each environment's behavior model is trained on every draft that qualifies under the existing strong-player cohort rules, with v4/v8 preserved intact for history and rollback.**