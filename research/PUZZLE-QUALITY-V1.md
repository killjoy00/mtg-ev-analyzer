# Independent strength, context, and predicted debate

Protocol fixed before fitting this comparison. The aggregate response snapshot
was previously examined for difficulty research; it is not a pristine external
test. This is an offline development experiment, not a production release.

## Separation of roles

Historical first-encounter, observed, non-QA, non-admin Pack One answers may
train a reusable choice model. Inference accepts only the offered cards, prior
picks, existing consensus supports, and a format-level 17Lands strength table.
No puzzle response count, observed split, identity feature, historical target
flag, future deck inclusion, or awarded score may enter choice prediction.
Historical targets are used only for a separate defensibility check and audit.

The primary transfer test holds out all Reality Fracture responses. The other
five supported sets train a common conditional-choice model. Set/card/puzzle
identities cannot be learned predictors. Report other sets only as development
cross-validation; do not choose parameters using the Reality Fracture result.
The source data are selected by the incumbent system. Observed results cannot
estimate a causal benefit from serving previously unserved puzzles.

## Independent card evidence

Re-use the frozen three-model strength recipe from card-strength-v1, but exclude
the union of all source drafts in this experiment's response and inventory
contexts before fitting any strength table. Verified-corpus hashes are
SHA256(lowercase set + '|' + official draft ID)[:32]. Verify the raw unique-ID
mapping against the prepared array cache before applying the exclusion.
An unresolved source is counted explicitly; it cannot contribute if it is
absent from the matching official archive. Do not use the original trophy
deck's wins to support its own card-strength feature.

Re-fit C and A at the earliest 500, 2,000, and complete remaining fitting-draft
budgets. Both continue to need target-set 17Lands evidence; neither needs
target-set Pack One responses. Unsupported formats or unresolved card metadata
must be flagged, never silently assigned a weak-card rating.

## Choice prediction and evaluation

Compare frozen incumbent support with five small variants: temperature-only
calibration, calibration plus pool fit, calibration plus C strength, calibration
plus C strength and fit (primary candidate), and A strength plus fit (comparator).
Use conditional softmax with ridge 0.02 around incumbent coefficient 1 and added
coefficients 0. Bound the consensus coefficient to [0.25, 4]. No parameter grid.
Strength is a format-level z-score clipped to [-3, 3]. Missing strength gets a
neutral value and its own indicator, with explicit coverage reporting.

Pool fit is a transparent colour-commitment proxy derived from mana symbols in
prior picks. It grows gradually with the number of prior picks; there is no
off-colour penalty at P1P1. Hybrid/Phyrexian/unknown cost metadata is explicitly
marked uncertain rather than pretending it is a rigid colour requirement.
This proxy does not claim to model all archetypes, fixing, curve, or synergy;
the existing consensus already carries learned contextual evidence.

Training weights sets equally, then source drafts, then puzzles within a draft;
choice counts form a target distribution within each puzzle. Primary assessment
is draft-balanced multinomial choice log loss on the held-out newest set,
averaged equally across the three evidence budgets. Also report Brier score,
predicted-vs-observed pairwise disagreement, and per-budget performance.
The primary contrast is C+fit versus temperature-only calibration, with a
paired source-draft bootstrap 95% interval, conditional on fixed models.
No definitive superiority claim unless that interval excludes zero in favour
of C+fit. The other comparisons are descriptive, not a winner search.

## Explainable offline selector

Keep strength, context, and predicted debate separate in output. A proposed
candidate needs at least two alternatives with: support >= half the leader,
known strength with >=100 deck games, z >=0, and colour fit >=-0.5. Both must
have predicted choice share >=15%; the historical target must be one of the
credible alternatives and pass the unchanged serving support floor. Hard
removals and invalid contexts always fail. Uncertain-cost cards are review
cases, not automatic rejects as weak. Thresholds are hypotheses fixed here,
not validated business rules. Do not relax them after seeing inventory yield.

Rank eligible puzzles by the probability that two independent predicted picks
land on different credible cards, normalized for the maximum with three cards.
This rewards concentrated two-/three-way debate; a separate top-three mass
diagnostic exposes fragmentation. Use per-set and pick-stage strata, one puzzle
per source draft, and report shortfalls instead of filling with known failures.

Compare a deterministic sampled inventory (20 per pick position per set,
excluding admin removals) with the response cohort. For answered puzzles with
>=20 observations, report observed unbiased pairwise disagreement and choice
concentration as diagnostics. Do not label those enjoyment or fairness. Do not
claim that enforcing a strength threshold independently validates that threshold.

## Outputs and rollout

Produce a portable model artifact, an inference/ranking CLI, aggregate evaluation,
per-puzzle private reason codes, and an inventory shortfall audit. Keep response
snapshots, per-puzzle behavior, trained artifacts, and detailed assessment outside
the public repository. Commit code, tests, protocol, and sanitized conclusions.
Test target-label invariance, independent source exclusion, missing evidence,
context/identity isolation, weak-pack rejection, early off-colour flexibility,
removal enforcement, and source-draft diversity. No database writes, public
rankings, grading changes, or Daily selection activation in this work.
