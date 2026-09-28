# Issue #529 identification addendum — randomized P1P1 packs, confounding sensitivity, and behavior calibration

**Date:** 2026-09-28 UTC / 2026-09-27 PT  
**Issue:** #529  
**PR:** #674  
**Branch:** `research/contextual-value-v1-h-freeze-audit-529`

This addendum **does not replace** the pre-results R-LCB amendment. It adds
identification and robustness work that must remain separate from the frozen
R-LCB development result.

At the time this addendum was committed, no amended R model result or R
validation outcome had been produced.

## 1. Random P1P1 pack study: first behavior-model-independent causal design

### Design premise

Arena Limited boosters are generated randomly subject to set-specific booster
collation/slot rules: guaranteed or probabilistic rarity slots, wildcard/special
slots, set-specific replacements, etc.

The relevant random shock is therefore:

> which legal collated P1P1 pack the player receives,

not an unconstrained independent draw of every card.

The causal design assumes Arena does **not** condition that random pack
generation on player identity, skill, rank, prior behavior, or latent player
quality. This is an Arena design assumption rather than a fact inferred from
17Lands outcomes. Before outcome analysis, test balance of P1P1 pack
instruments against recorded pre-draft skill/rank/experience and report any
material imbalance.

Official Wizards pack descriptions document randomized slot probabilities and
set-specific Limited pack collation. They do not provide a formal statistical
randomization protocol keyed to player identity, so empirical balance and
collation diagnostics remain mandatory.

### Outcome-free archive verification

Outcome-free inventory workflow:

`contextual-value-v1-p1p1-outcome-free-inventory`

Run:

`36388824016`

The scanner reads only draft identity, event/position, selected card, and
offered-pack columns. It does not read match wins/losses, rank, skill, or
another outcome.

Verified against the exact hash-pinned archives already used by #529:

| set | Premier drafts | P1P1 logged | P1P1 coverage | excluded/reserved IDs | untouched P1P1 |
|---|---:|---:|---:|---:|---:|
| EOE | 104,377 | 104,377 | 100% | 13,000 | **91,377** |
| FIN | 140,237 | 140,237 | 100% | 13,000 | **127,237** |
| TDM | 101,323 | 101,323 | 100% | 13,000 | **88,323** |
| DFT | 143,504 | 143,504 | 100% | 13,000 | **130,504** |
| MSH | 68,633 | 68,632 | 99.9985% | 1,483 | **67,149** |
| SOS | 107,502 | 107,499 | 99.9972% | 2,302 | **105,197** |
| ECL | 99,290 | 1 anomalous row | effectively absent | 2,134 | not used |
| TLA | 102,793 | 0 | absent | 2,081 | not used |

The four fresh-set exclusions are the exact prior 8k plus exact subsequent 5k
confirmation IDs, i.e. the first 13,000 stable-hash eligible #529 drafts.

For MSH/SOS, exclude every MSH/SOS draft in the **pooled** 8,000-draft core
cohort: 1,483 MSH plus 2,302 SOS. There were not 8,000 reserved drafts per set.

Total currently identified untouched P1P1 supply in the six usable sets:
**609,787 drafts**.

### Historical #529 window correction

For the retained #529 core cohort, ECL and TLA do not contain P1P1. Their
historically labeled “P1P1–P1P8” evaluation window is therefore actually
**P1P2–P1P8**.

The full ECL public archive has one anomalous P1P1 row, but that row is not in
the retained #529 core cohort and is not enough to support an ECL P1P1 study.

MSH/SOS have a handful of full-archive drafts with missing P1P1 logging; never
impute those picks.

### EOE feasibility

EOE exact public archive:

- P1P1 drafts: **104,377**
- exact reserved #529 IDs: **13,000**
- untouched P1P1 drafts: **91,377**
- cards taken at least 30% of the time when present: **59**
- those cards account for **59.95%** of untouched EOE P1P1 picks.

From the already-spent 20k confirmation outcome distribution:

`SD(event_match_wins) = 2.1766` wins.

Using only the outcome-free EOE card-presence/take-rate counts and that
pre-existing variance, a no-covariate Wald planning SE for highly contested
cards with take rates roughly 0.83–0.99 is approximately **0.057–0.089 wins**
at N=91,377. This is planning information only.

### Sample freeze before outcomes

No P1P1 outcome may be read until a separate committed power freeze specifies:

- primary set(s);
- minimum worthwhile effect;
- exact stable-hash sample size N per set;
- card eligibility based only on outcome-free appearance/first-stage data;
- multiplicity procedure;
- exact pack/collation strata and exclusions;
- weak-instrument thresholds for IV analyses.

If the power calculation requires at least the entire untouched supply, use the
entire frozen untouched ID set rather than choosing a favorable subset.

Do not condition the P1P1 sample on eventual event completion.

## 1A. Per-card randomized-offer estimand

For card c define:

- `Z_c = 1` if c appears in the random P1P1 pack;
- `D_c = 1` if the player selects c at P1P1.

### Reduced form — strongest identification claim

`RF_c = E[Y | Z_c=1] - E[Y | Z_c=0]`.

Under player-independent random pack generation, this is the causal effect of
receiving the **collated pack shock that includes c** versus the corresponding
distribution of packs without c.

It requires no behavior propensity model.

Because pack collation implies c replaces/changes another slot/card, RF is not
literally “the effect of adding c while holding every other pack card fixed.”

### Wald / IV ratio

Since c cannot be selected when it is absent,

`FS_c = P(D_c=1 | Z_c=1) - P(D_c=1 | Z_c=0)`

normally reduces to its P1P1 take rate when present.

Report:

`Wald_c = RF_c / FS_c`.

Interpret this as a complier-specific effect of selecting c versus the natural
alternative only under the usual IV assumptions, especially:

- relevance;
- monotonicity;
- exclusion.

The **exclusion restriction is approximate, not automatic**. Card presence also
changes the rest of the pack; passed cards affect downstream neighbor signals;
and the original pack can return at P1P9. Therefore the reduced form is the
cleaner randomized-pack estimand. The Wald result must always be reported
beside RF, first-stage strength, and collation diagnostics.

Use outcome-free card appearance / take-rate rules to choose the predeclared
card family. Apply the frozen multiplicity procedure; do not select cards by
their outcome estimates.

## 1B. Pooled feature IV / 2SLS

Secondary analysis: estimate a candidate-feature causal projection by
instrumenting the features of the historically chosen P1P1 card with
predeclared functions of the random pack’s candidate features.

Use:

- set fixed effects;
- exact R cleaned feature schema if R has been frozen before this study;
- predeclared pack-feature instruments;
- heteroskedasticity-robust / randomization-appropriate inference;
- first-stage rank/strength diagnostics.

Compare the identified coefficient projection/direction with R’s global
candidate-advantage coefficients.

Do **not** interpret a high-dimensional coefficient comparison if the first
stage is weak or rank deficient.

Pack-feature exclusion is also approximate because unchosen pack contents can
affect later draft information/passed cards. Report this separately from the
cleaner pack-level reduced form.

## 1C. Random-pack model validation

For any model m, freeze an outcome-free scalar function `g_m(pack)` before
opening P1P1 outcomes and regress wins on that random-pack score.

Because the pack is randomized, a relationship between `g_m(pack)` and wins
is evidence that the model captures **causal pack-quality variation** rather
than player selection into packs.

Correction to the proposed interpretation:

> A slope of exactly 1 is a calibration target only when `g_m` is explicitly
> defined in the same expected-win units as the causal pack-level estimand.

For an arbitrary rank/advantage score such as raw R, slope ≈1 is not implied by
causal correctness. For those models predeclare scale normalization and test
sign/monotonic calibration. Do not turn this pack-quality test into a claim
that following the model’s recommended card is itself identified.

## 1D. Later picks

The simple pack randomization argument applies directly to **P1P1**.

P1P2–P1P8 are conditional on the player’s earlier picks/pool and therefore
require a different shock/exposure design. A Borusyak–Hull-style recentered
instrument based on simulated counterfactual pack/shock assignment is a
possible later extension, but it is not part of the initial P1P1 study.

## 2. Marginal-sensitivity analysis for every observational challenger

Every future observational challenger-vs-A report, including R-LCB, must add a
hidden-confounding sensitivity section.

### Important multi-action caveat

Tan-style marginal sensitivity, Zhao–Small–Bhattacharya bounds, Dorn–Guo sharp
IPW bounds, and the original Kallus–Zhou robust-policy construction are most
directly formulated for binary treatment.

#529 has variable multi-card action sets.

**Do not mechanically reduce the problem to binary “followed challenger vs
not” or “challenger vs A” by discarding historical third-card actions.** That
can change the target population and can itself create selection.

Before R validation outcomes are read, document/test a native multi-action
extension or a formally justified reduction.

### Predeclared sensitivity output

For each challenger π versus A report, over a fixed grid of hidden-confounding
strength Γ:

- lower/upper IPW policy-improvement bound;
- lower/upper DR/model-assisted sensitivity bound if the chosen derivation
  supports it;
- `Γ_zero`: the smallest Γ at which the lower improvement bound reaches zero;
- cap/support diagnostics under the sensitivity set.

The sensitivity result is a robustness analysis, not permission to choose the
Γ that makes a preferred policy pass.

### Outcome-free recorded-skill benchmark

Fit a predeclared skill-aware choice model using no outcomes.

For the actions recommended by π and A, compare action odds from:

1. the frozen behavior model without the added skill×candidate terms;
2. the skill-aware model.

Report the distribution of:

`|log odds_skill-aware - log odds_reference|`.

Freeze an interpretable reference strength such as a predeclared percentile
before policy outcomes. Compare `Γ_zero` against this observed-covariate
benchmark.

This does not prove unmeasured confounding equals recorded-skill confounding;
it supplies a scale reference.

### Confounding-robust fallback policy

Kallus & Zhou (2018) motivates a policy that departs from a baseline only when
improvement survives a prespecified confounding uncertainty set.

Add a **secondary** confounding-robust fallback-to-A counterpart of R-LCB only
after validating the multi-action extension. Its actions and Γ benchmark must
be frozen before outcomes.

It does **not** replace primary R-LCB or alter R’s advancement gate unless a
future protocol explicitly makes it co-primary and handles multiplicity.

## 3. Behavior evaluation should target policy-relevant calibration

Retained rich behavior-correction artifact from run **36323128790** verifies:

- all-decision validation selected-action NLL:
  - frozen baseline: **1.29019**
  - rich/pick-shrunk: **1.10797**
  - improvement: **0.18222 nats**
- the script’s historically mislabeled “primary window” NLL improved by
  **0.23382 nats**;
- A’s target-action weight normalization:
  - frozen baseline: **1.2675 [1.1556, 1.3720]**
  - rich/pick-shrunk: **2.4902 [1.8522, 3.3484]**.

Therefore “better selected-action NLL” is not sufficient evidence of a better
OPE behavior nuisance.

For every target policy report:

- target-action calibration;
- `E[I(A=π(X))/e_π(X)]` weight normalization and interval;
- probability-bin calibration on recommended actions;
- local support / tail weights;
- covariate balance after weighting.

Evaluate outcome-free alternatives that explicitly improve **policy-relevant
balance**, including policy-specific balanced weights in the spirit of Kallus
(2018), rather than selecting solely by NLL.

No behavior evaluator may be selected using policy outcome estimates.

## 4. Longer-term shuffle / in-deck structural direction

The game archive already parses deck/opening-hand/drawn/tutored/win fields.

Random shuffle variation within a fixed deck is potentially useful for
estimating in-deck card value while absorbing pilot/deck quality with deck
fixed effects.

However, the simple proposal “compare games where c was drawn vs not and
adjust for game length/mulligans” is **not yet an identification-clean
estimator**:

- game length/number of draw opportunities can be affected by the card itself;
- conditioning on realized game length can therefore be post-treatment;
- mulligan decisions depend on the opening hand;
- tutors and other draw mechanics create additional nonrandom exposure.

Treat this as a longer-term structural project requiring a proper risk-set /
shuffle-exposure design. It does not block the current R/P1P1 work and is not
part of R’s gate.

Even a clean in-deck effect would not identify the steering effect of an early
draft pick on the rest of the draft. A structural pick value such as:

`P(card makes final deck | pick context) × in-deck marginal value`

would still require a model for downstream drafting/deck construction.

## 5. Sequence after this addendum

1. Keep the R-LCB pre-results amendment intact.
2. Complete its outcome-free loader/tests/prerun report.
3. Complete and commit the P1P1 outcome-free inventory/power/sample freeze
   before reading any new P1P1 outcome.
4. Add the multi-action hidden-confounding sensitivity derivation/tests before
   treating R-LCB as robust to unmeasured confounding.
5. Run R development exactly once under its amended observational protocol.
6. Independently execute the frozen P1P1 random-pack study as the first
   behavior-model-independent causal check.
7. No production change from either development result alone.

The P1P1 study and R answer different questions and should be reported
separately rather than combined opportunistically.
