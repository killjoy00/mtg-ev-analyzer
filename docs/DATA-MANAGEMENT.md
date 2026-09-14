# Corpus audit and selection policy

Corpus audit date: 2026-09-12. Selection policy updated 2026-09-14: `eight-pick-v3`.

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

HBG, SIR and PIO remain in the replay catalog for existing set practice. They are excluded from random mixed runs and new Daily schedules, including set rerolls. A user-selected collection of sets for an eight-pick run is roadmap work, not implemented by this release.

The two permanently retired environments are removed from active local/source data, discovery, queues, and future imports. Fingerprints in the policy prevent accidental reintroduction without surfacing their names. Database constraints block their set identities. The cleanup workflow removes any matching R2 objects and clears pre-policy trophy caches; source data must never be downloaded again. Historical git revisions and previously published GitHub logs are not rewritten.

## Run construction

New runs contain eight decisions: one easy, five medium and two hard (a missing easy slot becomes medium). The first five positions shuffle one easy, three medium and one hard. The final three shuffle two medium and one hard; an easy decision cannot enter those positions through a reroll.

Regular pick windows by round are `1`, `2`, `3`, `4–5`, `5–6`, `6–8`, `7–9`, `8–10`. Cube uses the same windows shifted one pick later. The last regular decision therefore comes only from picks 8, 9 or 10; Cube uses 9, 10 or 11.

Rerolls retain the difficulty band, stay within ten rating points of both the original and current decision, and obey source uniqueness, pick windows, and existing card/context distance limits. An unavailable replacement never consumes a token.

## Daily weighting

`data/selection-policy.json` records verified [Scryfall release dates](https://api.scryfall.com/sets), checked September 14, 2026. Sets must be released by the Eastern game date and registered as eligible. Archive modification/import dates do not determine recency. Refresh release dates and display names when registering a new eligible set; this is a checked-in snapshot, not live set discovery.

Every new expansion Daily reserves its latest three released eligible sets for distinct rounds whose difficulty bands and pick windows have available puzzles. Optional rounds exclude those three sets. If a required set is unavailable or no feasible assignment exists, creation fails explicitly with 503 rather than substituting an older set. On September 14 the required sets are HOB, MSH and SOS.

The remaining five slots prefer distinct sets and use relative weights:

- Next three releases (TMT, ECL, TLA): **4**.
- Next six (EOE, FIN, TDM, DFT, FDN, DSK): **2**.
- Older eligible releases: **1**.

These are weighted draws without replacement when distinct sets are available, not fixed quotas or independent probabilities. Guaranteed sets have weight 6 for comparable Daily reroll candidates, but their inclusion in initial selection is guaranteed rather than probabilistic. Large archives receive no extra set weight. Ordinary practice remains uniform among eligible sets; Cube remains independent.

Each schedule/session stores `daily_featured_sets`. Its guaranteed sets cannot be removed by a set reroll; a same-set pack reroll remains allowed. Other rounds retain the single different-set reroll, using versioned weights and the original game date. Old `first-pack-v2` runs retain ten slots and their original 1.25/1.10/1.00 weighting.

## Management and release controls

- `draft_run_environment_policy` records each set's role, pick ceiling, weight and selection version. `draft_run_eligible_decisions` exposes current eligible IDs and their ratings for auditable counts.
- Sessions and schedules preserve their selection version. Previously submitted answers, completed results and exact friend packs retain their original identities. The eight-pick release rewrites no schedules or sessions. Existing Dailies remain unchanged for everyone joining that day; newly generated schedules use eight picks.
- Both loaders preserve existing puzzle payloads. Completed imports require exact database/manifest counts, rejecting unexplained extra or missing rows.
- Full-trophy imports (`import-all-trophies.yml`) and legacy skill backfills (`backfill-legacy-sets.yml`) are explicitly dispatched; editing those importers does not start their multi-hour rebuilds. The separate legacy replay backlog (`build-more-sets.yml`, workflow name `import-set-backlog`) still runs on its schedule and matching code/catalog pushes. It does not define the full trophy population. Restored trophy caches are purged before use as specified by the release workflow.
- Database changes run in development first. Release checks cover both real eight-pick games and historical ten-pick compatibility, caps, first-pack provenance, late-round difficulty, exclusions, rerolls and exact friend packs.

Per-set measured counts are in [JSON](audits/corpus-2026-09-12.json) and [CSV](audits/corpus-2026-09-12.csv). `stored` includes archived decisions; `eligible_decisions` applies image/interesting filters and the current pick cap; `eligible_trophy_drafts` counts only source drafts with at least one currently eligible decision.

The September 14 [product review](PRODUCT-REVIEW-2026-09-14.md) rechecked public aggregate counts but did not repeat this full source/manifest audit. Its initial serving change preserved the prior selection policy. The eight-pick follow-up changes selection under a new version; deployment is tracked separately in [BACKEND-RELIABILITY.md](BACKEND-RELIABILITY.md).
