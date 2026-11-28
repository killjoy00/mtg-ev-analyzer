# Final v7 review protocol (frozen before run)

Owner accepted the eight-point review of c7e7309. This document supersedes the earlier no-refit/pack-scaling/no-fit-v6 directions. Preserve the successful parser-v2 run 46058171727, frozen v6 and original fit/archive artifacts. The c7e7309 run failed a mana-source self-bootstrap unit test before any measurement; fix that defect, do not treat it as an empirical result.

## Fixed candidate and fallback

1. Refit final v7 on exactly the original residual windows/cohorts and incumbent chronological v6 offsets. Hold the baseline threshold, minimum experienced games, context L2 0.02, card prior 30/min(cohort decisions), 100 offers in each cohort, lambda .5 and model formula fixed. Fit two conditional multinomial models on the final six features, including the same unresolved-cost imputation used at inference. The chosen recipe is strong-player context plus strong-minus-ordinary card effects. No parameter search. The fit jobs produce only aggregate public card coefficients and provenance; no validation choices enter the optimizer or leave a runner.
2. Same final feature/parser/clip recipe, original frozen coefficients (no refit).
3. Previously validated parser v2. No further model search. Record any failure of the new stricter bound or transfer requirements; this fallback is not permission to waive them.

Use **independent clipping of each centered half-scaled log correction at +/-0.5*ln(1.25)**, not spread scaling. Same original centering, no extreme-card rescaling of the rest of the pack. Maximum pairwise ratio 1.25; exact model-only grade movement <=19, production six-decimal serialization <=20. Trophy override 100 and alternative ceiling 95 unchanged. Recognize prepare front only and reversible first face including lands; no arbitrary rules inference. Exclude a mana source's own cost and optional land mode from its prerequisite evidence. Keep other previously agreed final mana source/fractional access definitions and report remaining unresolved aliases.

## Paired validation and acceptance

All 31 exact source pins, metadata snapshots, source exclusions, dates and baseline cohort parity. Residual-only fit stage completes before validation choice reads. Three fixed candidates scored on the same held-out choices, source bootstrap and matched eight-pick profiles. Original full candidate bank digest, parser-v2 cohort prediction and per-format AUC parity required. The 23 strict and eight legacy source-draft-disjoint environments remain separate, no fresh independent final data. Five previous design formats are not independent of design selection.

Predeclared release-review checks for each final arm:
- All 31 Premier per-format severe-tail, raw-log-loss and top1 guardrails pass (existing <=1 pp severe-tail increase, <=.005 upper log-loss delta, >=-.01 lower top1 delta).
- Pooled Strict Mixed and Legacy Mixed paired AUC delta vs v6 each have lower 95% bound >0. Cube and standalone results also reported.
- The **same recovered-cost offers** (old parser-v2 previously-unreadable-to-readable group, 673,318 historical elite alternative offerings; mean change -1.3181795 points vs v6) are no worse than parser v2, using identical offer count and total signed delta. Newly recovered layouts reported separately.
- Maximum observed movement <=20 in both validation (both cohorts) and actual stored production shadow, with complete incumbent parity and consistent serving revision.
- Available Traditional guardrails pass. Missing Traditional evidence is explicitly reported, never a pass or automatic release of that component.
- Starting v7 cross-format configuration passes all 31 leave-one-format-out guardrail tests. A failed starting-model result is reported to the owner; no silent v6 substitution.

Select first passing arm in fixed order; if neither final arm passes, report parser v2 as the validated prior fallback requiring owner review of remaining conditions. No automatic deployment or historical changes. Report each gate rather than hiding a failed candidate. Keep decision quality claims limited to strong-drafter behavior; within-skill actual Premier wins are descriptive.

## New sets and Traditional (owner's decisions)

New sets including TRK start **v7** with equal-format mean of the selected arm's elite context coefficients and zero card terms. LOO test excludes the target's entire fit, averaging the other 30 with no card intercepts and identical validation cohorts. Fit metadata/rules must be pinned; unreadable metadata remains neutral, never substitute v6. At ingestion, attempt the same local residual fit when eligible (at least one card meets 100 offers in each cohort), validate on separate chronological window, promote only on existing guardrails and movement limit. No local fit yet => retain starting v7. Failed local fit => retain starting v7 and report. Version a local fit promotion as a distinct immutable per-set corpus/configuration with exact fit/rules/source digest; preserve prior puzzles, awards and pinned runs; register and validate the new version before activation. scripts/pool_aware_v7_ingestion_config.py implements offline preparation and immutable identity/evidence checks, not a live version switch. The release integration must wire this into Corpus Operations prior to staging and add the v7-compatible importer/loader/version registry; do not change live v6 ingestion during research or pretend a fallback recipe has been locally refit.

Traditional uses v7, not silently v6. Inspect all 28 pinned Traditional draft archives for game-win-rate and games-count buckets. Use the same chronological validation window, cutoff and experienced-game threshold as Premier, with no Traditional training, exclude duplicate/inconsistent or overlapping sources. Apply all candidate arms using Premier fits and their approved Traditional pick window (regular P1-P8, FRA P1-P6, Cube P2-P7). Measure strong-player log loss/top1/sub-25 tail; report insufficient cohorts or missing columns/source as unavailable. No Traditional game archives are stored; outcome correlation unavailable, do not use match wins as a substitute. Existing production Traditional health/admission remains independently required.

## Reports

All prior metrics plus 90+ to <75, >=20-point drops/movement by overall and matched cost class (including newly readable), max movement, leader changes, sub-25 absolute and delta, source coverage, remaining unresolved aliases, sample review-card contexts. Eldrazi Ravager is an accepted card-contrast limitation, not a parser failure or singled-out override. Read actual active stored Premier/Traditional supports separately in read-only shadow transactions for each arm. Report inventory entrances/exits, hard-band supply per set and pick (including P9/P10 and TMT P6, whether inside serving window), clear-Easy availability, ratings/band changes, leader counts, large reductions and cost-class metrics. A new live set lacking pinned rules is an explicit shadow coverage blocker; starting coefficients are reported, not v6 scores counted as corrected.

The required PR test suite must run without whitespace failure; no CI gate changes. Research workflows only, no player records, paid AI calls, new recurring work, production writes or deployment authorization.
