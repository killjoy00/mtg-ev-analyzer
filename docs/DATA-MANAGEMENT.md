# Corpus and selection

Current contract: [CHARTER](CHARTER.md). Actual deployment: [CURRENT-STATE](CURRENT-STATE.md). Lifecycle and gates: [CORPUS-OPERATIONS](CORPUS-OPERATIONS.md).

Keep the complete historical corpus, source checksums, disposition ledgers and old versions. Default recency weighting does not remove older sets. New regular play requires Live status, regular eligibility, released metadata and usable decisions in the active corpus. Existing schedules/sessions use pinned IDs regardless of later status changes.

Premier trophies include 7-0, 7-1 and 7-2. The frozen 32-set outcome audit now verifies those source outcomes against pinned archives and identifies nine source trajectories that must be excluded from new play. PR132 implements additive source exclusions without rewriting puzzle payloads or historical schedules/results, but migration 0020 and the reviewed exclusion report are not yet applied in production. Missing losses in older unaudited material remain unknown, not zero.

Production model training uses broader qualified Premier evidence with source-held-out grading; playable Premier puzzles use trophies. Broken histories, unusable decisions and unresolved card identities are excluded with reasons. Raw archives are build inputs, not browser assets.

`eight-pick-v4` uses regular picks 1–8 and Cube picks 2–9, with eight distinct source drafts. Old wider windows and ten-decision runs remain version-specific compatibility paths. Do not recalculate them.

Daily selection: two newest-set decisions; four draws with replacement from the three immediately preceding Live releases; two draws from the full Live regular corpus. Each weighted pool uses `2 ** (-rank / 4)`, ranked newest first within that pool. Four-release half-life is simple and independent of archive size. No pick from every predecessor is forced. Deterministically assign feasible pick/difficulty slots; fail if guarantees cannot be met rather than weakening them.

The [100,000-Daily simulation](../results/rebuild-2026-09-18/DAILY-DISTRIBUTION.md) met every quota: 87.5993% newest-four exposure and 29.0029% newest-set exposure. On 45,737 days at least one predecessor was absent. Ordinary random practice retains broad set coverage; custom practice evenly balances the chosen Live regular sets. Dailies and shared recipients cannot reroll.

Official discovery records availability/freshness. Existing builders validate schema, cohorts, trajectories, metadata, model evidence and accounting. New sets remain non-serving Candidates until readiness gates pass and an authenticated admin explicitly promotes Live. Changed archives require a reviewed new corpus version, never a silent rewrite. Status actions do not alter sessions, schedules or results. Do not replay the destructive historical retirement migration.

## Traditional inventory

Traditional model evidence and Traditional playable puzzles are separate decisions.

The [completed model experiment](../results/rebuild-2026-09-18/TRADITIONAL-RESULTS.md) did not establish every criterion needed to replace the Premier-only production training policy, so Traditional remains outside production model training.

A subsequent frozen-model puzzle-source evaluation used the unchanged Premier v3 model and predeclared per-set/late-pick serving gates. BLB, FIN and DFT passed; HOB failed. The workflow reported `expansion_supported=true`, `production_changed=false` and `model_training_changed=false`. The passing inventory is Candidate-only until reviewed operational publication.

Production currently serves no Traditional puzzles and contains no `TradDraft` trajectory rows. Any future publication must preserve source-event provenance, include only individually passing sets, pass applicable Corpus Operations checks and leave historical Premier data unchanged.
