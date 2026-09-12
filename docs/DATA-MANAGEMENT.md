# Corpus audit and selection policy

Audit date: 2026-09-12. Selection version: `first-pack-v2`.

## Coverage and provenance

All 33 supported public Premier Draft archives were rediscovered and their ETags and byte lengths independently matched the completed imports. Database counts match every import manifest exactly: 95,730 verified trophy drafts and 1,024,873 stored decisions. All stored decisions have `support-ratio-v1` difficulty ratings. There were zero trophy-outcome, source-evidence, or pick/history-count mismatches in the full database audit.

Both source extractors restrict output to zero-based source pack 0. The replay renderer translates that to displayed pack 1. The trajectory validator also rejects later packs defensively. Storage now exposes the audited `pack_number=1` invariant explicitly; the API returns it. The wider training cohort can use other packs, but playable trophy decisions cannot.

This is exhaustive processing of the supported public archive snapshots under the quality rules, not a claim to possess unpublished drafts. Eighteen quality-qualified trophies have no renderable decisions because images remain unresolved. Partial or inconsistent source trajectories and individual missing images can exclude other decisions; the import ledgers retain those reasons. Missing opening packs are never invented.

## Active eligibility

Regular environments are capped at P1P10; Powered Cube is capped at P1P11 and starts at P1P2 when its source omits the opening pack. Older P1P11/P1P12 records remain archived for provenance and historical sessions, but cannot enter newly generated runs.

Current eligible totals:

| Use | Decisions |
|---|---:|
| Regular mixed runs, 29 sets | 878,756 |
| Powered Cube | 10,098 |
| HBG, SIR and PIO retained for selectable modes | 31,775 |
| Total eligible across retained environments | 920,629 |

HBG, SIR and PIO remain in the replay catalog for existing set practice. They are excluded from random mixed runs and new Daily schedules, including set rerolls. A user-selected collection of sets for a ten-pick run is roadmap work, not implemented by this release.

The two permanently retired environments are removed from active local/source data, discovery, queues, and future imports. Fingerprints in the policy prevent accidental reintroduction without surfacing their names. Database constraints block their set identities. The cleanup workflow removes any matching R2 objects and clears pre-policy trophy caches; source data must never be downloaded again. Historical git revisions and previously published GitHub logs are not rewritten.

## Run construction

Every run still contains one easy, six medium and three hard decisions (a missing easy slot becomes medium). The first six positions shuffle one easy, four medium and one hard. The final four shuffle two medium and two hard; an easy decision can never enter those positions through a reroll.

Regular pick windows by round are `1`, `2`, `3`, `4–5`, `5–6`, `6–7`, `7–8`, `8–9`, `8–10`, `8–10`. Cube uses the same windows shifted one pick later. The last two regular decisions therefore come only from picks 8, 9 or 10; Cube uses 9, 10 or 11.

Rerolls retain the difficulty band, stay within ten rating points of both the original and current decision, and obey source uniqueness, pick windows, and existing card/context distance limits. An unavailable replacement never consumes a token.

## Daily weighting

The existing newest-first import queue supplies the explicit recency order in `data/selection-policy.json`; source archive modification times are not treated as release dates. For a new Daily, weight the newest six regular sets at 1.25, the next six at 1.10 and the remaining sets at 1.00. Current tiers:

- 1.25: HOB, MSH, SOS, TMT, ECL, TLA.
- 1.10: EOE, FIN, TDM, DFT, FDN, DSK.
- 1.00: remaining regular sets.

These are relative weights among currently eligible sets, not fixed quotas. Fresh-set preference remains, large archives do not receive more weight, and ordinary practice remains uniform by eligible set. Daily set rerolls apply the weights among their comparable candidates. Cube stays independent.

## Management and release controls

- `draft_run_environment_policy` records each set's role, pick ceiling, weight and selection version. `draft_run_eligible_decisions` exposes current eligible IDs and their ratings for auditable counts.
- Sessions and schedules preserve their selection version. Previously submitted answers, completed results and exact friend packs retain their original identities. Cutover replaces only today's unplayed schedules and zero-answer sessions; if anyone has submitted answers in an environment, its existing Daily is preserved for fairness until the next day.
- Both loaders preserve existing puzzle payloads. Completed imports require exact database/manifest counts, rejecting unexplained extra or missing rows.
- Full source imports and legacy backfills are explicitly dispatched; editing importer code no longer silently starts a multi-hour data rebuild. Restored caches are purged before use.
- Database changes run in development first. Release checks cover both real ten-pick games, caps, first-pack provenance, late-round difficulty, exclusions, rerolls and exact friend packs.

Per-set measured counts are in [JSON](audits/corpus-2026-09-12.json) and [CSV](audits/corpus-2026-09-12.csv). `stored` includes archived decisions; `eligible_decisions` applies image/interesting filters and the current pick cap; `eligible_trophy_drafts` counts only source drafts with at least one currently eligible decision.
