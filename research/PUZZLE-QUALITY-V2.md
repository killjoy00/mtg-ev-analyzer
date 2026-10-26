# Strong, defensible competing options

This revises the selection objective after the owner rejected choice prediction
as a quality objective. No questionnaire, tester recruitment, subjective labels,
new pick policy, production scoring change, or Daily activation is included.
V1 and its results remain reproducible. This specification is fixed before
running the v2 inventory comparison; constants are not tuned to its results.

## Selection contract

Inputs are the offered pack, prior picks, existing contextual strong-player
support, and an independent format-level card-strength table. There are no
Pack One response inputs or learned choice coefficients in selection. Neither
future picks nor the eventual source deck/wins can establish defensibility.
Source IDs are used for evidence exclusion and portfolio diversity only.

Retain v1's provisional card gates: C strength z >= 0 with at least 100 deck
games; contextual support at least half of the leader; known colour fit >=
-0.5. The historical pick must qualify and at least one other card must qualify.
Keep the existing rounded serving floor (19.5/95), removals, and trajectory
validation. These are explicit hypotheses, not proven interestingness labels.
An unknown strength is not a low strength. Counts and A/C disagreement are
reported; the exported C coefficients do not yet have per-card confidence bounds.

The selection score is the weaker C strength of the historical pick and its
best qualifying alternative. Choose the alternative with greatest strength,
breaking ties by contextual support then ID. Rank by that bottleneck, then
the weaker contextual-support ratio of the pair, then puzzle ID. A third option
is reported but earns no automatic bonus. No entropy, predicted share, match
rate, or number of disagreeing players enters this score. Its units are strength
z, not win probability or probability of enjoyment. A weak target cannot borrow
the strength of a bomb elsewhere in the pack. An isolated bomb fails the
two-credible-options gate; an apparently strong pair must still pass context.

The existing production support already incorporates colour/stage and card-pair
evidence. Reuse it; do not claim a new causal synergy model. Keep the conservative
mana-cost fit proxy, but handle ordinary two-colour hybrid costs as alternatives.
Prior lands do not create spell-colour commitment or make every later puzzle
unknown; flag missing fixing evidence explicitly instead. Candidate lands,
Phyrexian costs, generic/colour hybrid costs, and explicit colourless requirements
remain review cases without validated richer mana evidence. Unresolved nonland
prior costs still require review. Raw format-average strength cannot rescue
all build-arounds; that limitation is reported rather than patched with a guessed
contextual-win-rate bonus.

The old portable choice model may optionally produce sidecar warnings for a
historical target below 5% or a dominant option above 90%. Those warnings never
alter eligibility, ranking, or portfolio selection. Observed answer counts are
used only by the evaluation harness after portfolios are frozen. No target-set
Pack One history is needed to score a new puzzle.

## Fixed comparison

Use the exact v1 input snapshots and the three already independently fitted
strength budgets (500, 2,000, complete). Verify their hashes, exclusion scope and
zero source overlap. Write separate v2 outputs; never overwrite v1 results.
Compare:

1. Deterministic serving-floor sample, an eligibility reference, not a replay of
   the deployed Daily's difficulty composition.
2. V1 disagreement selector, retaining its actual gates and choice coefficients.
3. V1 eligibility with v2 bottleneck ranking, isolating the ranking change.
4. V2 selection, including the stated mana handling and warning-only choice role.

Keep set/pick strata, 20% inventory quotas, and one puzzle per source draft.
Show full portfolios and shortages. For the v1-v2 comparison, reduce each stratum
to the smaller feasible portfolio size and reselect until both achieve the same
quotas. Report matched results as well as native coverage; never compare a tiny
curated group with a larger baseline without disclosing the difference.

Report target/alternative training-strength and context distributions, shared,
added and removed selections, and failure reason counts. These are implementation
and composition diagnostics, NOT independent evidence that the gates work.

For an independent-of-fitting strength check, use the original strength
benchmark's later assessment partition, excluding every experiment puzzle-source
draft. Derive smoothed GIH from those games only (the frozen 400-game prior),
standardized across observed cards within set. Evaluate each frozen target/partner
pair's weaker later GIH z, requiring 100 hand games and 20 distinct hand drafts
for BOTH cards. Report unknown evidence separately, never silently drop it from
the denominator. Show coverage, above-average pair proportion, and set-macro
means for equal-size portfolios. Bootstrap selection-source drafts within sets,
conditional on these fixed evidence tables; these intervals do not include
uncertainty in the card estimates or shared-card correlations. Do not call
them a definitive winner test. GIH is observational strength corroboration,
not the effect of choosing either card in the displayed draft.

After freezing selection, use historical first-encounter answers to flag near-zero
historical-choice support and near-unanimity with Wilson intervals (minimum 30
answers). They are diagnostics, not enjoyment labels, and are not optimization
targets. Aggregate counts cannot account for repeated testers across puzzles.
Report FRA separately because its responses never fitted the v1 choice model;
the other sets' v1 choice diagnostics are development-only. V2 fits no response
model. The corpus and assessment archives have already been examined: this is
a retrospective, source-separated audit, NOT a new untouched future-set test.

## Decision

Do not select a variant using choice log loss or claim improved enjoyment. Ship
code and a reviewable comparison even if corroboration is mixed. Zero or sparse
17Lands evidence produces explicit abstention; the early budgets are evidence
stress tests, not release-day simulations (the contextual support snapshot is
mature). Cube/Traditional formats need separate strength evidence. Production
selection and scoring remain unchanged pending a separately reviewed rollout.
