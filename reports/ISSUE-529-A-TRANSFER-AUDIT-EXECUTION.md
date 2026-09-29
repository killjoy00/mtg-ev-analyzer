# Issue #529 A-transfer audit execution

Step-0 rule was frozen first in commit `84d08a6364015fc7624c5ddbc49934b6918e9b8f`.

This branch runs the scoring-only audit in `.github/workflows/audit-a-transfer-529.yml`.
The harness is `scripts/audit_a_transfer_529.py`.

The execution boundary is deliberate:

- draft outcomes are never indexed or parsed;
- research cohort IDs come from previously frozen outcome-free manifests;
- the 45k decision/action/behavior context comes from run 36475098718's pre-outcome freeze artifact;
- game archives are read only through the deck/colour inputs (`draft_id`, `main_colors`, `deck_*`);
- Step 2 must reproduce every committed v8 candidate probability to 1e-6 and every served top pick before Step 3b is allowed;
- if Step 2 fails, only Step 3a using committed corpus `model_probability` is retained;
- Step 4 is not run by this workflow unless the frozen Step-0 gate fails and is then authorized as the one diagnostic follow-up.
