# Corpus and selection

Current contract: [CHARTER](CHARTER.md). Actual deployment: [CURRENT-STATE](CURRENT-STATE.md). Lifecycle and gates: [CORPUS-OPERATIONS](CORPUS-OPERATIONS.md).

Keep the complete historical corpus, source checksums, disposition ledgers and old versions. Default recency weighting does not remove older sets. New regular play requires Live status, regular eligibility, released metadata and usable decisions in the active corpus. Existing schedules/sessions use pinned IDs regardless of later status changes.

Premier trophies include 7-0, 7-1 and 7-2. The importer accepts all three and rejects invalid 7-3 outcomes. Qualified drafters retain the existing experience/quality standard. Missing losses in old ledgers are unknown, not zero. Distinguish importer tests and sampled source audits from exhaustive production verification.

Production model training uses broader qualified evidence with five-fold source exclusion; playable puzzles use trophies. Broken histories, unusable decisions and unresolved card identities are excluded with reasons. Raw archives are build inputs, not browser assets.

`eight-pick-v4` uses regular picks 1–8 and Cube picks 2–9, with eight distinct source drafts. Old wider windows and ten-decision runs remain version-specific compatibility paths. Do not recalculate them.

Daily selection: two newest-set decisions; four draws with replacement from the three immediately preceding Live releases; two draws from the full Live regular corpus. Each weighted pool uses `2 ** (-rank / 4)`, ranked newest first within that pool. Four-release half-life is simple and independent of archive size. No pick from every predecessor is forced. Deterministically assign feasible pick/difficulty slots; fail if guarantees cannot be met rather than weakening them.

The [100,000-Daily simulation](../results/rebuild-2026-09-18/DAILY-DISTRIBUTION.md) met every quota: 87.5993% newest-four exposure and 29.0029% newest-set exposure. On 45,737 days at least one predecessor was absent. Ordinary random practice retains broad set coverage; custom practice evenly balances the chosen Live regular sets. Dailies and shared recipients cannot reroll.

Official discovery records availability/freshness. Existing builders validate schema, cohorts, trajectories, metadata, model evidence and accounting. New sets remain non-serving Candidates until readiness gates pass and an authenticated admin explicitly promotes Live. Changed archives require a reviewed new corpus version, never a silent rewrite. Status actions do not alter sessions, schedules or results. Do not replay the destructive historical retirement migration in this release.

Traditional archives remain offline. The [completed experiment](../results/rebuild-2026-09-18/TRADITIONAL-RESULTS.md) did not establish every pooling criterion; neither production model evidence nor playable puzzles changed event type.
