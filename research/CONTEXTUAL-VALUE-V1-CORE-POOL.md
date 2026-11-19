# contextual-value-v1 core development pool

**Issue:** #529  
**Decision date:** 2026-09-25  
**Scope:** development only; locked assessment remains sealed

The primary development pool is now:

- MSH
- SOS
- ECL
- TLA

This is a cohort-design change made before the locked assessment is opened.

## Rationale

The previous exploratory development pool (TMT/HOB/MSH) overrepresented two unusually thin recent environments. Existing Pack One corpus counts were approximately 699 trophy drafts for TMT and 617 for HOB, versus 2,090 for MSH, 3,206 for SOS, 2,396 for ECL, and 3,408 for TLA.

The new core pool follows a simple rule: use the four most recent regular environments after excluding the two thin environments, so model/configuration selection is driven by more representative full-size draft environments rather than small-set support.

This change is based on environment size/representativeness, not on choosing sets because their contextual-value validation result was favorable.

## Role of HOB and TMT

HOB and TMT remain useful secondary stress tests for thin-data behavior, overlap, and fallback/support rules. They must not:

- select the global target-policy temperature;
- select the model family or feature set;
- select clipping/support thresholds;
- influence the locked assessment decision.

## Safety boundary

The core-pool workflow may use train and validation partitions only. It must continue to assert:

- `scope == "development_only"`
- `assessment_opened == false`

No production scoring, corpus, puzzle, or database state is changed by this work.
