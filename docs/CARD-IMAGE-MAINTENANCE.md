# Card image maintenance

Pack One card-image maintenance is an explicit, display-only corpus operation. It chooses canonical Scryfall card images from the actual draft-booster source set when that source can be identified, otherwise a deterministic ordinary printing. It does not change puzzle identity, candidate identity, scoring evidence, model support, provenance, source trajectories, schedules, sessions, or historical scores.

## Selection policy

The shared resolver in `scripts/fetch_card_metadata.py` owns card identity, aliases, face selection, and printing rank. Served puzzles come from 17Lands, which records MTG Arena drafts by card name, so the policy shows each card in the printing that shipped in that environment's Arena packs.

For every served card in a draft environment:

1. **The environment's own set.** Within it, the plain base printing wins over promos, showcases, extended art, textless and other cosmetic alternatives.
2. **Otherwise, the Arena printing released with the set.** A printing counts when Scryfall says it is on Arena (`games` includes `arena`), it was released the same day as the environment's set (Scryfall's set `released_at`), and its set type carries booster sheets: `masterpiece`, `expansion`, `core`, `masters` or `eternal`. This covers bonus sheets, Special Guests and Arena-only substitutions without any per-set entry. Commander decks, Jumpstart, Alchemy and box products released the same day have other set types and are excluded; a new set type stays excluded until it is reviewed and added. Among eligible printings the **lowest collector number wins**: a sheet's base printings come first, and their default frame is often borderless or showcase (OTP's newspaper style, MUL's showcase legends), while collector variants of the same card (etched, schematic, anime) are numbered after the sheet.
3. **Otherwise, the earliest ordinary printing** of that exact card. Powered Cube, a cube rather than a booster, always uses this.

17Lands identifies the **card, not its exact artwork**, so the policy shows the default version from the source the player drafted, regardless of which cosmetic variant they opened. Digital and rebalanced identities missing from Scryfall's `default_cards` bulk export are resolved through the same exact-name resolver. The HBG `A-Monster Manual` draft name is canonicalized to Scryfall's full rebalanced Adventure identity first. Double-faced aliases, flavor and printed names, and the Prepare-card collision rule remain part of the shared identity contract. The ranking is deterministic regardless of API order: language, source tier, collector order within a same-release sheet, cosmetic penalty, paper before digital, release date, collector number, card ID.

### Reviewed printing record

Every printing chosen **outside an environment's own set** is recorded in `corpus/draft-run/card-printings.json` as `set/collector_number`. The full refresh computes its choices and refuses to publish if any differ from the record: a choice added, changed, or no longer outside the set. It writes the proposed record to `generated/card-printings-proposed.json` in the refresh diagnostics and lists the differences in the log. To accept them, review the proposal and commit it as `corpus/draft-run/card-printings.json` through a pull request, then rerun the release. A new set, a new Scryfall printing, a policy change and a product type the rule did not anticipate all surface here as a short list instead of silently changing art. Names that are no longer served drop out of the record on their own. Powered Cube is not recorded.

This replaced hand-typed collector ranges per environment, which had to be added for each new set and missed both Reality Fracture's Special Guests and an Arena-only substitution: on Arena, Library of Alexandria (SPG #158a) replaces SOS's paper guest Library of Leng (SPG #158). Before switching, the rule was run against every card served on November 3 in all 31 environments. It reproduced every existing choice, including all 20 previously verified bonus ranges, and changed only Library of Alexandria, from its 1993 Arabian Nights printing to SPG #158a.

Printings recorded outside each environment's own set (November 3, 2026):

| Environment | Source sets (cards) |
| --- | --- |
| BLB | SPG (10) |
| BRO | BRR (63) |
| DFT | SPG (10) |
| DSK | SPG (10) |
| ECL | SPG (20) |
| EOE | EOS (45), SPG (10) |
| FDN | SPG (10) |
| FIN | FCA (64) |
| FRA | SPG (10) |
| MH3 | SPG (10); M3C (8), MH3 Commander legends |
| MKM | SPG (10); 40 cards from earlier sets, each in its earliest ordinary printing |
| MOM | MUL (65) |
| MSH | MAR (58) |
| ONE | 4 praetors in their earliest ordinary printings (DMU, KHM, NEO, SNC) |
| OTJ | BIG (30), OTP (65), SPG (10) |
| SIR | SIS (75) |
| SOS | SOA (65), SPG (10) |
| TDM | SPG (10) |
| TLA | TLE (61) |
| TMT | PZA (20) |
| WOE | WOT (63) |

Every other served environment (KTK, DMU, SNC, NEO, LTR, HBG, HOB, PIO, LCI) uses only its own set: every card it serves is printed in that set.

Future trophy/component imports must seed card metadata from the environment being built, not from an arbitrary other environment that happens to contain the same card name. Retained per-build image caches may fill missing metadata but may not override current environment-scoped shard metadata. Any true miss is resolved through the shared exact-name selector with that environment as the preferred set (or with no preferred set for Powered Cube).

### Coverage: every served card in every served environment

The policy applies to everything players can be served, not only to the replay samples. Before November 3 the refresh built its card list from the checked-in corpus sample and the replay shards, and only for environments in the Draft Run catalog. Backend propagation then updated only the names in that list, so any served card outside it kept whatever art it was imported with. That left 17 guest and bonus-sheet cards in ECL, MSH, TLA and TMT, and all of Reality Fracture (FRA, which is trophy-only and not in the catalog), outside the policy.

The refresh now works from the served inventory:

1. `scripts/collect_served_card_inventory.mjs` asks the development and production backends (`image-environments`, `image-inventory`) for every registered environment that serves puzzles and every card name served in it: current-parent Premier rows plus Live components, candidates and prior picks. An environment is registered when it is in the catalog or the serving policy lists it as Live or Candidate. Inventory requests are paged by puzzle id (2,000 puzzles per request), like image refresh pages.
2. `scripts/refresh_card_images.py` resolves the policy for the union of the served names, the corpus sample and the shards. Environments outside the catalog get a mapping but have no shards or checked-in corpus to patch. In the release workflow the inventory is required (`REQUIRE_SERVED_INVENTORY=1`); a missing or empty inventory stops the refresh.
3. `scripts/refresh_card_backend_images.mjs` first checks every environment's mapping against the collected inventory and stops before writing anything if any served card has no policy selection. It then propagates every environment in the catalog or the inventory.

The first three November 3 releases stopped on development at the same point, right after KTK. The cause was the refresh page query, not the new coverage check: it asked for the first 250 mismatched rows in puzzle-id order, and the planner walked the primary key across the whole table expecting to find them early. Once an environment was already normalized there were none, so one page read every row on development (5.7 million, including every historical corpus) and passed the 120-second client timeout on a cold database. Refresh and inventory pages now read only the environment's served versions (the current parent plus Live components) through the `(corpus_version, set_id)` index and order by `puzzle_id COLLATE "C"`, which the primary key cannot serve; the database collation is `C.UTF-8`, so the order is unchanged. A no-op page for OTJ on development now takes about 13 seconds from a cold start. A pass that rewrites most of an environment re-scans its remaining rows on each page, so broad normalizations are slower than targeted ones; this is a known follow-up. The post-propagation re-read added earlier that day was removed as well, since it duplicated the policy step's check. Production was not changed by any of the failed runs. Most corpus writers share the `packone-corpus-mutation` lock with the refresh, but the weekly Corpus Operations import does not; cards from a snapshot it publishes during a refresh are covered by the next refresh, whose checks include them.

Unresolved names still fail the refresh, and served names are now part of that check, so a served card the policy cannot resolve blocks publication instead of being skipped.

### November 3, 2026 release

The fourth release, card-image release 41604895831 on `43bf016` (#1485), succeeded. Development propagation took 12.5 minutes. Production took 61 minutes, writing rows throughout. Gameplay verification passed on both. Afterwards every served card on production, in current Premier rows and Live Traditional components of all 31 served environments, had exactly one `image_url`, and it equalled the refresh's policy mapping for that environment. Policy resolution reported 0 unresolved names and no remaining special printings. Reality Fracture's ten guests are on SPG #159–168. No Live Traditional component has a card whose display fields match no Premier variant. The source update was merged as #1486. Later that day the same-release Arena rule (#1489) shipped in card-image release 41695978104. Its printing-record gate passed on the first run, and the only served image that changed was Library of Alexandria in SOS, now SPG #158a. Afterwards production again matched the run's mapping in all 31 environments.

## Display-only mutation boundary

Image maintenance may change only:

- `image_url`
- `mana_cost`
- `rarity`
- `type_line`
- `display_faces`

`scripts/refresh_card_images.py` scrubs those fields before comparison and fails if any other card or puzzle metadata changes. This is not a model, scoring, selection, or corpus-admission release.

## Fail-closed gates

The all-Pack-One refresh refuses publication when any of the following remain:

- unresolved served card names, including names that only the backend's served inventory contains;
- a served card that has no policy selection (checked against the collected inventory before propagation writes anything);
- an avoidable cosmetic/special printing where an ordinary printing exists;
- ambiguous card-ID/name mappings;
- test-suite or production-data audit failures;
- backend releases that do not match the reviewed code revision.

Unavoidable original/only special-frame printings and intentionally drafted main-set/bonus-sheet frames are reported separately and do not fail the release. The report distinguishes verified draft bonus-sheet selections from genuine cross-set fallbacks.

The refresh always uploads `generated/card-image-refresh-report.json` and per-environment mappings as retained Actions diagnostics, including on failure. Inspect these first for unresolved names, avoidable special selections, unavoidable special selections, cross-set fallbacks, and card-ID/name collisions.

## Targeted repair vs full refresh

Use targeted repair for a known, isolated display regression on an exact served card name and explicit environment list when the shared selector/policy itself has not changed. Use the full refresh for resolver or printing-policy changes (including adding bonus-sheet sources), bulk drift, audits, uncertain scope, or any case where more than a bounded named repair is intended.

Neither is for Traditional components whose art differs from Premier. That is a third case with its own Traditional-only repair, `scripts/traditional-premier-art.mjs` (see [Traditional components](#traditional-components)). Bulk Traditional drift is not a reason to run the full refresh.

Run the targeted repair dry-run before dispatching live mutation. Hydrate all replay shards read-only so the repair can apply the same global card-id/name collision check as the full refresh, then resolve and inspect the retained report without changing shards or checked-in source:

```bash
bash scripts/r2_replay_shards.sh hydrate
CARD_NAME='Titania, Protector of Argoth' \
REPAIR_ENVIRONMENTS='powered-cube' \
python scripts/repair_card_image.py --dry-run
cat generated/card-image-repair/report.json
```

Targeted repair only covers catalog environments and cards present in both the checked-in corpus sample and the hydrated shards; it refuses anything else. Cards that only the served inventory contains, and environments outside the catalog such as FRA, are covered by the full refresh.

The dry-run requires the same R2 read credentials as shard hydration. It validates exact catalog environment ids, exact case-sensitive served-name presence in both checked-in corpus and the selected environments' hydrated shards, global card-id/name collisions across every hydrated environment, and the deterministic bulk selector. Targeted mode never sends operator card text through Scryfall named/fuzzy resolution; a bulk miss fails closed and should be handled through the full refresh path instead.

Dispatch the existing pinned workflow in targeted mode; do not create or use a second image-maintenance workflow:

```bash
gh workflow run refresh-powered-cube-images.yml \
  -f mode=targeted \
  -f card_name='Titania, Protector of Argoth' \
  -f environments='powered-cube' \
  -f request_id='titania-repair' \
  -f code_commit='<reviewed-main-commit>'
```

Targeted verification proves that only the listed environments receive one-entry backend mappings, the second image-page pass reports zero updates on every page, image markers are normalized only for those environments, development gameplay passes before production is touched, production gameplay passes, and the backend release marker remains on the requested reviewed revision. The zero-update pass proves there is no remaining drift among payloads scanned by the backend, but the current backend response does not expose a positive card-match count, so it does not independently prove that the card exists in backend storage. The verification pass uses the same idempotent refresh endpoint; if it discovers drift, that page may be repaired before the pass fails.

Targeted workflow hydration is intentionally all-environment and read-only so the full production-data audit and global collision check have complete shards. Only R2 upload/verify and backend propagation are scoped to the validated environment list. The workflow derives `REPLAY_SETS` from the validated repair report, so whitespace in the dispatch input cannot change shard scope after validation.

Backend repair and verification summaries are retained under `generated/card-image-repair/backend/*.json` in the repair artifact, including stage, page counts, update totals, verification outcome, and failures. The targeted job has a 45-minute timeout; this is a ceiling, not an expected runtime.

Backend image propagation covers both the current parent corpus and any `Live` supplemental component whose `parent_version` is that current corpus. `Candidate`, retired/non-Live, and components attached to older parent corpora are deliberately excluded. This scope applies to both full and targeted image maintenance so a normalized parent cannot mask stale art in a currently served component.

Rows selected from a supplemental component must be validated against that row's stored `corpus_version`, not against the current parent version. The September 28 Tishana release exposed this distinction: the Live-component query was correct, but the first release attempt rejected a valid Traditional-v4 row because the verifier implicitly expected the parent corpus version. The refresh now selects the stored row version, requires the payload version to match it, and validates both the before/after payload against that exact version. Keep that invariant whenever component-aware image propagation changes.

The final protected-branch handoff uses an `automation/card-image-repair-...` branch and never pushes to `main` or creates a pull request from Actions. A no-op source publication is expected when checked-in/R2 display metadata was already correct and only the live backend state had drifted.

## Traditional components

Traditional puzzles must show the same art as Premier puzzles of the same environment: for every card, the five display fields `image_url`, `mana_cost`, `rarity`, `type_line` and `display_faces` must equal one of the variants that environment's current Premier puzzles use for that name.

### Publication gate

`scripts/verify-puzzle-components.mjs` enforces this. Every Traditional stage and publish path runs it, on development and production, before and after a component goes Live (`publish-puzzle-components.yml`, the v5 and v6 corpus releases, and `scripts/publish-puzzle-components.mjs` itself). It fails when any Traditional card matches no Premier variant, names the first affected cards and points to the repair script below. A component carrying art from its research build therefore cannot go Live. Card names with no Premier occurrence in the environment cannot be checked; they are listed as `unmatched_names` in the verification output, not failed.

Premier rows for the same name can legitimately differ: some lands store `mana_cost` as `""` and others omit the key. The gate accepts any Premier variant, so that difference never blocks a release. A different image, rarity, type line or set of faces does.

The check reads each environment's Premier rows once per verification (about 11 seconds for the largest v10 environment, so 2 to 3 minutes for all 23 Traditional components).

### Building new components

A Traditional build should copy Premier's display fields onto its cards, as `premier_display` and `with_premier_display` do in `scripts/v6_traditional.py`, so the gate passes on the first try. The Traditional research resolver (`scripts/traditional_v4_revalidation.py`) originally seeded metadata from every environment's replay shards and resolved missing images with Scryfall's exact-name lookup, which returns the newest printing: often an Art Series card, a token or a later reprint. It now seeds only from the measured environment and picks each card's printing with the shared `choose_main_printing` policy: the environment's own set, then the Arena printing released with it, then the earliest base printing (Powered Cube uses the earliest base printing). Its image cache is keyed by policy and environment and never overrides environment metadata. Which names count as resolvable is unchanged: an exact-name match with an image. Research art is only a fallback; Premier's art is what ships.

### Repairing Traditional art

Never use the full card-image refresh (`card-images` request) to repair Traditional art. It rewrites every environment's Premier rows as well, re-uploads the replay shards, and takes far longer (the November 3 pass took about 100 of its 210 minutes, 61 of them writing production). Use the Traditional-only repair:

```
node scripts/traditional-premier-art.mjs <connection-file> check [set ...]
node scripts/traditional-premier-art.mjs <connection-file> repair --dry-run [set ...]
node scripts/traditional-premier-art.mjs <connection-file> repair [set ...]
```

It covers Candidate and Live components of the current parent (all of them when no set is named). `repair` replaces the five display keys only on cards that match no Premier variant, using the most frequent variant (ties broken by canonical text). It keeps every other key, such as `id` and `model_probability`, and the card order, writes only rows whose payload changes, works in 16 puzzle-id chunks to stay inside the SQL client timeout, and then reruns `check`. It refuses the Premier parent as a target and never writes Premier rows, replay shards or checked-in card files. Run it on development first, then production, and finish with `check` on both; it exits non-zero while any drift remains.

Reality Fracture (FRA) is Live but is not in the Draft Run catalog (`corpus/draft-run/catalog.json`) because it has no replay shards. The full refresh covers its Premier and Traditional rows through the served inventory (see [Coverage](#coverage-every-served-card-in-every-served-environment)); targeted repair does not, because it validates names against the corpus sample and shards. The Traditional gate and repair above compare against FRA's Premier rows directly.

### November 2, 2026 v6 repair

The v6 components were published on November 1, after the last full refresh on October 23, so they carried the resolver's printings. The repair applied the same Traditional-only copy that `scripts/traditional-premier-art.mjs` now performs, by hand, on all 23 Live v6 components (21 regular sets, Reality Fracture P1P1-P1P6 and Powered Cube P1P2-P1P7), directly in the database. On production it rewrote 112,901 of 158,382 Traditional puzzles; afterwards 0 of 2,224,732 Traditional cards differed from Premier on both production and development, and Celestial Colonnade in Powered Cube shows its Worldwake printing. Sword of Fire and Ice in MSH (8 cards) has no Premier occurrence, so the repair left it alone; the November 3 release put it on its policy printing (MAR #100). Premier rows, replay shards and checked-in card files were not changed by the repair.

An earlier attempt on the same day ran the full refresh instead. Before it was cancelled at the 90-minute limit it had rewritten development Premier and Traditional rows, production KTK Premier, part of production MOM Premier and the replay shards with the refreshed mapping. The [November 3 release](#november-3-2026-release) brought every served row to the policy, so that partial state no longer matters.

## Guarded release sequence

Use `.github/workflows/card-image-release.yml` for reviewed card-image code changes. It requires a full reviewed `main` commit and runs:

1. exact-revision development function deploy;
2. exact-revision production function deploy;
3. Pack One card-image refresh pinned to that same reviewed commit.

The refresh workflow remains at `.github/workflows/refresh-powered-cube-images.yml` because the Draft Run API OIDC trust pins that path. Its behavior is Pack One-wide.

The refresh then:

1. hydrates replay shards from the model-versioned R2 namespace;
2. verifies marked development/production backend revisions and collects the served card inventory from both;
3. resolves the policy for every served card and normalizes display metadata;
4. runs the full test suite and production-data audit;
5. retains diagnostics, including the served inventory;
6. re-verifies marked development/production backend revisions;
7. publishes normalized replay shards to R2;
8. checks every served card has a policy selection, refreshes development backend image metadata and verifies gameplay;
9. re-verifies the production release marker, repeats the coverage check, refreshes production image metadata and verifies gameplay;
10. pushes the refreshed checked-in corpus/card-image source of truth to an `automation/card-image-refresh-<run>-<attempt>` branch. Actions does not open the pull request; open it from that branch and merge it once its checks pass.

The corpus-writer concurrency group serializes this with other corpus mutations. A failed normalization or verification stops before later publication stages.

Time limits: the full refresh job has 210 minutes, and the release waits up to 220 minutes for it inside a 350-minute job. The November 2 refresh was cancelled at its old 90-minute limit after development alone took 68 minutes; the release itself only waited 120 minutes per step.

## Backend propagation is paged and resumable

Never send one whole environment through a single long-lived `refresh-images` HTTP request. Large environments can exceed the authenticated import client's request timeout.

The release client uses `refresh-image-page` and advances an explicit puzzle-ID cursor. Each page is capped at 250 puzzles and is idempotent. A failed request can be retried without replaying an entire environment. The client accumulates counts across pages, requires the cursor to advance, and finishes one registered environment before moving to the next.

Image-marker normalization is also performed one environment at a time after all image pages complete. The existing whole-set helper remains a compatibility boundary, but the release path must use the paged protocol.

## Protected-branch source publication

`main` requires changes through pull requests and required checks. Image-maintenance workflows must therefore never push generated corpus commits directly to `main`.

After development and production refresh plus gameplay verification succeed, the refresh workflow:

1. commits only the explicit `corpus/draft-run` card-image source-of-truth files;
2. rebases that commit onto current reviewed `main`;
3. pushes an `automation/card-image-refresh-...` branch;
4. records that branch as the publication handoff;
5. an authorized operator/app opens the branch as a pull request;
6. normal required checks protect the final merge.

The card-image workflow intentionally treats a successful branch push as its handoff and does not call `gh pr create`. Repository-level permission for Actions to create pull requests may be enabled for other narrowly reviewed automation (such as Admin campaign publishing); that does not broaden this card-image workflow's own publication contract.

If live backend propagation has already succeeded but source publication fails, do **not** rerun production propagation just to recover the checked-in files. `.github/workflows/publish-card-image-source.yml` hydrates the already-normalized R2 state, deterministically regenerates the checked-in corpus, validates it, pushes a recovery branch, and hands that branch to an authorized operator/app for the protected-main PR.

## Operational interpretation

A successful code deploy does not mean card images are live. Live image state changes only after normalization, audit, exact-release checks, R2 publication, backend propagation, and gameplay verification pass.

Conversely, the live product can be correct while the final checked-in source publication is still pending. Treat those as separate states:

- backend refresh + gameplay verification establish the live production image state;
- the source-of-truth PR establishes repository closeout.

Do not rerun a successful production backend refresh merely because protected-branch publication failed. Recover the repository state through the PR-based source publication workflow.

See [the September 23 card-image rollout closeout](reports/CARD-IMAGE-ROLLOUT-CLOSEOUT-2026-09-23.md) for the production evidence and the protected-branch recovery that established this contract.

See also [the September 28 Tishana/card-image audit closeout](reports/CARD-IMAGE-TISHANA-AUDIT-CLOSEOUT-2026-09-28.md) for the Live supplemental-component propagation bug, the component-version validation fix, the future-import hardening, and the successful Pack One-wide re-audit.
