# Q / Guard-10 20k evaluator-trust audit

**Issue:** #529  
**Status:** post-confirmation diagnostic only  
**Primary confirmation:** run 36371215506, aggregate artifact 10951400033  
**Registered decision:** no_confirmed_challenger

## Boundary

The 20k confirmation result is final and spent. This audit may diagnose whether the evaluator or frozen-policy reconstruction is trustworthy, but it may not:

- change A, Q, Guard-10, thresholds, support gates, caps, or cohort membership;
- replace the registered Bonferroni primary intervals;
- extend the 20k sample;
- select a new Q threshold/blend;
- reinterpret Guard-10 as having passed its earlier exploratory advancement rule.

Any result below is diagnostic unless explicitly stated otherwise.

## Hard parity gate

Before emitting diagnostics for an environment, reconstruct the exact confirmation from:

- the retained 5k cohort manifest produced by run 36371215506;
- the exact frozen draft/game archive hashes in the registered protocol;
- frozen Q artifact run 36337059424;
- the same A, Q, Guard-10, behavior-nuisance and simple-Q evaluator code.

Require reproduction of the retained environment confirmation report at caps 10/20/50 for Q-A and Guard-10-A. If parity fails, stop before interpreting diagnostics.

Record:

- SHA-256 of four-way-rich-q.pkl;
- SHA-256 of four-way-freeze.json;
- canonical SHA-256 of the Scryfall metadata payload used by the rerun;
- metadata coverage/unresolved names.

The retained rich-Q pickle expected SHA-256 from the independent artifact inspection is:

`854ea2594bb9ae59d38d8a8f7f1e7a12cbc4e7da77293dce91596cd1a8d7d477`.

## Diagnostics on the spent 20k cohort

### Local support and propensity calibration

For Q-A disagreement decisions and separately for Guard-10 overrides, report for both the Q-recommended and A-recommended cards:

- count of decisions;
- mean / median / p05 / p10 propensity;
- fraction below .01, .02, .05, .10;
- observed historical action-match count/rate;
- predicted mean propensity;
- observed-minus-predicted calibration difference;
- fixed probability-bin calibration using [0,.02), [.02,.05), [.05,.10), [.10,.20), [.20,.40), [.40,1];
- pick and recorded-skill slices where present.

Guard-10's actions remain exactly the frozen actions. No alternative support model may recompute its gate.

### Weight and influence concentration

For Q-A and Guard-10-A cap20 paired DR deltas:

- top 1% and 5% by absolute leave-one-out influence;
- share of total absolute centered influence;
- pooled effect after removing the diagnostic group;
- maximum single-draft leave-one-out change;
- sign flips under leave-one-out.

For disagreement / override subsets, report matched-action inverse-weight tails and clipping at caps 10/20/50 for both target candidates.

### Fixed-environment sampling sensitivity

The registered primary interval remains unchanged. Add a set-stratified paired bootstrap that independently resamples 5,000 drafts within each of EOE/FIN/TDM/DFT and averages the four environment means equally.

Also report leave-one-environment-out pooled effects.

### Outcome completeness

Without altering cohort membership, report the unique-draft distribution of:

- event_match_wins;
- event_match_losses including missing losses;
- records satisfying wins >= 7 or losses >= 3;
- records not satisfying that terminal proxy.

This characterizes the recorded public outcome; it does not retroactively exclude retirements/incomplete events.

### Estimator decomposition

Report for Q-A and Guard-10-A:

`DR delta = direct-model delta + residual-correction delta`

where residual correction is DR minus direct, together with SNIPS/IPW and cap sensitivity.

### Invariants / semi-synthetic validation

Add tests that:

1. identical deterministic target recommendations produce exactly zero paired policy delta;
2. a variable-action-set semi-synthetic generator with skill-dependent behavior recovers a known candidate advantage under a correct behavior nuisance with a misspecified outcome nuisance;
3. it recovers the same known advantage under a correct outcome nuisance with a misspecified behavior nuisance;
4. a true null candidate effect is not turned into a benefit merely because high-skill players prefer one action;
5. clipping is explicitly shown to trade variance for bias in an extreme-support case.

## Comparator interpretation

Research A is a leakage-safe complement-refit `strong-player-colour-stage-v4` analogue using the same scoring formula and high-level strong cohort rule as production, but its fitted parameters differ because it is trained on the research complement. Unless an exact deployed-artifact parity study is added, do not call it the literal deployed A snapshot.

## Pass/fail interpretation of this audit

This is not a challenger-selection gate.

A **validity defect** means a hard parity failure, direct evidence of same-draft post-treatment leakage, policy/action reconstruction mismatch, or a demonstrated evaluator failure on the semi-synthetic invariants large enough to undermine the registered result.

Calibration weakness, local support limitations, repeated-player uncertainty, live-metadata reproducibility gaps, and incomplete-event ambiguity are important limitations/sensitivities but do not by themselves rewrite the registered result.

If no validity defect is found, retire Q and Guard-10 from further threshold/blend tuning and move #529 to one predeclared candidate-advantage model family using development data only.
