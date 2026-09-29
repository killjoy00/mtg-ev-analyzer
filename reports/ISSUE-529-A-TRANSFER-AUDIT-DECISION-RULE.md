# Issue #529 — deployed A vs research A transfer audit

## Step 0 — frozen decision rule

This rule is committed **before any agreement or value computation** and governs this audit.

### Scope and leakage guard

This is a scoring-only check. The audit must not read `event_match_wins` or any other draft outcome when establishing identity, reproducing scores, or measuring agreement. Outcome data may be used only in Step 4 if and only if the Step 0 PASS condition fails, and then only for the prespecified diagnostic estimators.

### PASS rule

The research verdict transfers to production if, on P1P1–P1P8 decisions:

- top-1 agreement between deployed A and research A is **at least 95% in every set**; and
- disagreements are mostly close calls, reported with the score/probability margin under both models.

The 95% threshold is fixed before computation. The rationale is that if the models disagree on `d` of decisions, their value can differ by at most approximately `d × (value gap per disagreement)`. At `d <= 5%` and a gap of `<= 0.2` wins, that is approximately `<= 0.01` wins, which is at the resolution of the 45k confirmation.

### Failure path

If the PASS condition is not met, run **exactly one** follow-up: Step 4 from the audit specification, on the spent 45k only, using the all-eligible DR estimator with cap 20 and the same sensitivity grid.

Step 4 is diagnostic only. No production change may follow from this audit alone.

### Reproduction gate

Before comparing the two As, deployed A must be reproduced using the production parameters and the same snapshot, including out-of-fold scoring for served drafts. Stored `model_probability` must match to `1e-6` and every served top pick must match exactly.

If exact reproduction fails, stop the transfer test, report the divergence, and perform only Step 3a as a descriptive comparison using the stored deployed probabilities. Do not approximate deployed A.

### Prespecified verdict labels

The final verdict must be exactly one of:

- **research verdict transfers**
- **does not transfer**
- **inconclusive: reproduction failed**
