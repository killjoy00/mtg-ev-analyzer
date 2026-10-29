# Decision context v1: development protocol

Issue #1427. Owner-authorized on October 28, 2026 (America/Chicago).
Frozen before fitting or inspecting this experiment's outcome results.

## Question and boundaries

Does an explicit representation of the developing pool and candidate/pool
interactions improve prediction of observed Premier event wins beyond simple
card strength and card metadata? This is an information screen, not an estimate
of the wins caused by selecting an unchosen card. It does not reopen R-LCB or
claim the #529/#756 data-resolution problem has been solved.

The v5 production family already uses all qualified training drafts. Its scoring
function uses stage-specific choice counts, averaged candidate/pool-card lifts,
and a color-commitment adjustment. It does not explicitly encode card text,
curve, roles, threshold synergies, or previously seen unselected packs. Richer
features may help, may duplicate existing signals, or may add noise.

## Two separate samples

1. **Diagnostic review:** checked-in v5 Premier trophy puzzles from BLB, DSK,
   NEO, EOE, and WOE. 48 source-distinct decisions per set: 24 chosen by
   stable hash across picks 1–8 and 24 additional targeted picks 4–8 with curve,
   color, land, tribal, or thin-context flags. Flags are hypotheses, not error
   labels. Keep representative and targeted summaries separate. A blinded file
   omits outcomes, historical choices, support, and stratum; its separate key
   retains provenance. These are already public source puzzles, not new Daily
   schedules. No player data is used.
2. **Outcome development screen:** pinned official BLB, DSK, WOE Premier draft
   and game archives. These historical environments have already been exposed
   to Pack One research. Even a new within-archive split is **development**, not
   an untouched confirmation. Retain at most 15,000 drafts per environment by
   outcome-independent hash. Select one P1P4–P1P8 decision per source by another
   hash. Include all skill levels and non-trophy outcomes. Require a complete
   contiguous prefix, consistent source outcomes, and a completed 7-win or
   3-loss event; count exclusions. This completed-event population may exclude
   retired drafts and does not establish effects for them.

## Leakage and feature contract

- Only selected actions receive the observed terminal-win label.
- Candidate features accept a pre-pick state object without any outcome or
  historical-choice field. No final deck, later pick, drawn status, or game
  duration can enter it.
- Metadata consists of printed costs, types and rules text. Current Scryfall
  text is a retrospective snapshot; errata/rebalances may differ from the
  historical event. It is not release-day metadata evidence.
- Roles extracted by lexical rules are explicitly proxies. Unknown metadata
  and complex/multiple faces are flagged, not silently interpreted as a vanilla
  zero-cost card. No card names or set identities are learned features.
- GIH comes only from the fitting complement's games. Three source-draft folds
  produce training GIH features. Validation and later development partitions
  use only fitting-draft games. Full-archive published strength tables are
  forbidden as outcome-evaluation features.
- Split each set chronologically 60/20/20 by draft start. Purge earlier drafts
  whose last observed game crosses the next boundary. Rank and exported player
  skill buckets are excluded: their upstream timing remains unverified.
- One decision per draft avoids treating repeated terminal outcomes as new
  observations. Stable player identifiers are unavailable.

## Frozen experiment

Standardize using fitting rows only. Fit Ridge(alpha=10), equal draft weights,
with no grid search. Clip predicted event wins to [0,7] for all candidates.

- **B:** smoothed training-only GIH (400-game prior), evidence/missingness,
  candidate mana/color/type/lexical-role metadata, pick and pool size.
- **P:** B plus aggregate pool curve, types, colors and lexical roles.
- **C:** P plus explicit candidate/pool role redundancy, curve, color overlap,
  tribal matching and supported lexical synergy interactions.

C versus P is primary: pool-only information may predict the deck's success
without improving candidate discrimination. C versus B is secondary. v5 is the
unchanged ranking reference in the trophy audit, **not** an outcome regressor.
No undertrained research refit is labelled the deployed v5 model.

Report held-out observed-action MSE, MAE, calibration mean bias, per-set and
pick-position breakdowns, and paired 2,000-draft bootstrap intervals. Sets are
equally weighted. A positive conclusion requires a negative C-minus-P MSE
interval and no set with a separated increase in MSE. No fallback winner is
chosen after seeing results. These intervals condition on fitted models and the
three sets; they do not establish unseen-player or future-format performance.

Also run leave-one-set-out, with no target-set games, picks, card aggregates or
outcomes in training. Use a training-wide neutral GIH prior and explicit zero
support for every held-set card, including reprints. This is a metadata-only
transfer diagnostic, not proof of day-one draft recommendations.

## Resolution and next gate

Report the approximate 80%-power minimum detectable paired MSE change using
the observed paired-loss standard error (2.80 * SE). Label this as predictive
MSE resolution, never wins per recommendation. This screen cannot calculate a
credible causal policy gain or its power. A recommendation study needs fresh
data, local action overlap, and a separately frozen powered design, preferably
prospective randomized advice. Expert review can identify specific mistakes,
but cannot replace that outcome evidence.

## Reproduction and storage

`python scripts/decision_context_audit.py` builds the checked-corpus review.
`python scripts/decision_context_experiment.py download` verifies pinned sources.
`python scripts/decision_context_experiment.py run` executes the fixed screen.
Raw data, metadata snapshots, fitted models and row-level predictions stay in
ignored `raw-data/` and `artifacts/`. Only aggregate results and public-puzzle
review artifacts may be committed. Hash protocol, code, metadata and inputs.
No production credentials, database, player telemetry, serving writes or deploy.

Source attribution: 17Lands public data, CC BY 4.0, https://www.17lands.com/public_datasets.
Card text/metadata: Scryfall, https://scryfall.com/docs/api.

Pre-fit inventory amendment: the checked-in samples have 52–68 source drafts
per set. Freeze 24 representative (three per pick) plus 24 targeted decisions
per set, 240 total, instead of an infeasible 80 distinct sources per set.
This change uses source counts only, before any experiment fitting.

Pre-fit schema amendment: NEO game archives lack game timestamps. Replace NEO
with WOE in the outcome screen so completion-time purging can be enforced; NEO
remains in the independent puzzle review. Require a unique game key and exact
linked game counts/wins matching the terminal draft record. Incomplete game
histories are reported and excluded before splitting. No model has been fitted.
