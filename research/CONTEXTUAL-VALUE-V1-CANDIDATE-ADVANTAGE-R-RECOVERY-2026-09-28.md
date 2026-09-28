# Candidate-advantage R one-time outcome recovery record — 2026-09-28

Issue: #529  
PR: #674  
Branch: `research/contextual-value-v1-h-freeze-audit-529`

## Failed first execution

The first post-freeze outcome execution was GitHub Actions run **36446571368** at commit `8e10ecab1d6e398c6944097fdc116cee6f219d79`.

Before the outcome step, the run successfully:
- passed the frozen amended-R unit tests;
- downloaded the exact frozen Phase A2 validation artifact from run **36290030236**;
- downloaded the exact frozen `strong_offset_only` validation nuisance from run **36280148906**;
- downloaded the immutable pre-outcome freeze from run **36442998592**;
- verified the frozen pre-run report SHA-256 `9b351ee6ca0a3dd8d676c18d2eed3f847ca34b8f7c619c797e76c193df234b66`;
- verified the frozen policy-bundle SHA-256 `8191ef8ef3eb0de5cbd963392b5e11c86b31f82984ec39b8701e6b5c107ac520`.

The evaluator then loaded the frozen validation shard with outcomes and stopped before policy estimation with:

`phi parity requested but phi_simple/outcome missing`

Therefore the validation outcomes must be treated as **opened** from this point forward, even though no R estimate/report was produced.

## Execution-only correction

Commit **6d39da6870729bba33c3015cbc2645e6f5136d4e** changes only the validation nuisance parity call in `research/contextual_value_candidate_advantage_r_outcome.py`:

- before: `align_nuisance(..., verify_phi=True)`
- after: `align_nuisance(..., verify_phi=False)`

Reason: the retained Phase A2 validation shard does not contain `phi_simple`. The frozen pre-run intentionally loaded this same validation shard with `include_outcome=False` and `verify_phi=False`. The amended protocol's exact pseudo-value parity requirement applies to training folds 0..4, where `phi_simple` exists and was already verified before outcomes.

This correction does **not** change:
- R-LCB actions;
- R-prime coefficients or covariance;
- policy bundle;
- R-LCB c;
- support floor;
- behavior/q nuisance;
- validation sample or eligible decisions;
- estimator;
- caps;
- bootstrap seed/draws;
- hidden-confounding Gamma grid;
- advancement thresholds;
- environment definitions;
- any scientific result.

No partial estimate from run 36446571368 is used to justify this correction; the failure occurred before `estimate_dict` was called.

## Recovery rule

One recovery execution is allowed solely to complete the already-frozen evaluation. It must use the exact frozen artifacts/hashes above and the evaluator blob produced by commit 6d39da6870729bba33c3015cbc2645e6f5136d4e.

After launch, the recovery workflow must be blocked against repeat execution. Any further failure may be repaired only if it is another execution defect that leaves all frozen scientific choices unchanged and is documented before retry.


## Second failed execution

Recovery run **36447033084** again verified the same frozen inputs and evaluator-unit-test boundary, then failed before any call to `estimate_dict` with:

`NameError: name 'behavior' is not defined`

Cause: the first execution-only edit accidentally inserted literal `\n` characters inside one Python comment line. Python therefore treated the intended `behavior,q,join=align_nuisance(..., verify_phi=False)` assignment as part of that comment.

No R estimate, CI, environment result, sensitivity bound, or advancement-gate result was produced by run 36447033084.

Commit **772f98272b21e2ec9f11d16bf19a2c857a451b13** fixes only those literal-newline characters so the already-intended assignment executes. The resulting evaluator blob SHA-1 is:

`4bb727a05bc915893bbefa57995636c2222e725a`

This changes no scientific choice and uses no partial result. One final execution-only recovery is authorized with this exact evaluator blob and the same frozen artifacts/hashes.
