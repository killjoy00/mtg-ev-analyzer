# Select the strongest supported puzzle-quality model

This comparison replaces the prior stopping point with an explicit model
selection decision. It does not assume adjusted deck-outcome strength is the
best card-strength signal for selecting draft puzzles.

Freeze this protocol before fitting or assessing the new candidates. Keep v1,
v2, their artifacts, and their results unchanged. Run GIH, IWD, adjusted outcome,
an equal GIH/adjusted blend, and a GIH/adjusted blend whose weight is selected
from other sets' validation data separately at each strength evidence budget.
Blend weights are fixed at 0, .25, .5, .75, 1 (weight on adjusted strength).
The adaptive candidate cannot use its target set's later outcomes to pick a
weight. No Pack One choices, match rates, satisfaction guesses, or future source
deck membership enter inference or the selection objective.

All candidates use the same v2 context/strength eligibility gates and pair rank;
only the strength estimator changes. Retain the zero strength floor, 100 deck
games, .5 relative contextual support, -.5 colour fit, removals, supported
versions, trajectory checks, and source-diverse 20% set/pick quotas. Do not relax
these gates after inspecting launch examples. This isolates the estimator
decision; it does not establish the optimal context thresholds or enjoyment.

Use the six existing sets for development, with original purged chronological
60/20/20 partitions and all experiment puzzle sources excluded from every
outcome partition. Refit 500/2,000/complete strengths using draft completion
order. At the finite budgets, every included game's timestamp must precede the
Nth completed draft's cutoff. This fixes the earlier evidence-volume experiment
which ordered drafts by their first game. Context probabilities are still mature
snapshots; do not describe this as a complete historical release-day replay.

For each development set, tune the adaptive weight using only validation
evidence from the other five sets. Freeze its weight and all candidate puzzle
portfolios before reading target test metrics. For the final new-set check,
sample 20 TMT puzzles per available pick position (2–11), deterministically by
MD5 of puzzle ID plus protocol version, from the v9 PremierDraft corpus. Exclude
these source drafts and any TMT launch-audit sources from strength/outcome data.
TMT outcomes have not been used in the prior strength/quality experiments.
Fit its strengths on its early partition but keep all TMT validation/test
evidence out of candidate selection and adaptive-weight training.

The primary target is a useful strong pair: the historical card and selected
alternative both have above-format-average GIH in a later independent game
partition, each supported by at least 100 hand games and 20 distinct drafts.
This is an observational, later-game strength target, not a counterfactual pick
value, player-choice target, or direct enjoyment measurement. Since GIH defines
the target, report that alignment explicitly; do not generalize its winner to
all definitions of card strength. Report later deck and opening-hand strength
as independent-view diagnostics, without changing the primary winner rule.

Evaluate production capacity as well as precision. For each planned set/pick
slot, a later strong pair earns +1, a weak or unverified selected pair earns -1,
and an unfilled slot earns 0. Divide by planned slots; average equally by set
and by the 500/2,000 budgets, since early sets are the priority. The complete
budget is a secondary stress check. This explicit utility assumes serving a
weak pair costs as much as a strong pair benefits; publish sensitivity to weak
pair costs 0, .5, 1, and 2, plus unpenalized yield, precision, coverage, and
matched-volume weaker-card strength. Do not call this a measured user utility.

Select the empirical leader on development cross-fitted VALIDATION utility;
use complexity only to break exact ties. Keep paired standard errors as
uncertainty diagnostics rather than a reason to prefer a lower-scoring model.
Use all six development validation sets to freeze the final adaptive weight
per budget. Then open the six development test results and the previously
unused TMT test once, reporting both. Do not change candidates, weights,
thresholds, objective, or the selected model after those results. Report the
best-supported operational choice even when superiority is uncertain; disclose
any failed confirmation rather than forcing a statistical winner.

Selection-rule revision, made after development validation and before opening
any test/confirmation results: the initial candidate-specific one-standard-error
rule chose IWD (0.301 validation utility) over the empirical adaptive-blend
leader (0.331), while excluding the better-scoring simple GIH candidate (0.323).
Its larger across-set variance made IWD eligible for the simplicity override.
That favors uncertainty rather than the user's objective. The final rule selects
the empirical validation leader and reports uncertainty separately. Preserve
the initial protocol, decision, and hashes in the private validation-rule-history
directory. No candidates, data splits, thresholds, or utility weights changed.
This is development-driven model selection with a subsequently sealed external
confirmation, not an entirely untouched preregistered study.

Bootstrap sets and assessment-game source drafts, retaining shared-card effects
within a resampled game dataset, to assess pair utility for fixed portfolios.
Report that this conditions on the fitted strength tables and does not refit
model selection or eliminate repeated-player dependence. Record source, code,
protocol, input, prediction, portfolio, and outcome hashes. Keep detailed
production-derived audit data private. Implement portable inference and tests
for the selected family, then update the existing research PR. No production
Daily selection or scoring activation is included.
