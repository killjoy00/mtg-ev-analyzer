# Card image maintenance

Pack One card-image maintenance is an explicit, display-only corpus operation. It normalizes every currently served card to deterministic Scryfall main art without changing puzzle identity, candidate identity, scoring evidence, model support, provenance, source trajectories, schedules, sessions, or historical scores.

## Selection policy

The shared resolver in `scripts/fetch_card_metadata.py` owns card identity, aliases, face selection, and printing rank.

- Regular draft environments prefer an ordinary/base printing from the intended draft set.
- If the intended set has no ordinary printing for that exact identity, resolution may fall back to the earliest ordinary printing for the identity.
- Powered Cube uses the global earliest ordinary/base printing policy directly.
- Cosmetic/special treatments are penalized and rejected when a cleaner ordinary printing exists. Current special signals include variation, textless, full-art, promo, oversized, borderless, showcase/extended-art/inverted frame effects, and non-card set types such as art-series or tokens.
- A special-framed printing is allowed when it is the original/only official printing and no ordinary alternative exists. The refresh report records these separately as unavoidable special printings; they are not publication blockers.
- Digital/rebalanced identities omitted from Scryfall's `default_cards` bulk export are resolved through the same exact-name resolver and their `prints_search_uri`. The HBG `A-Monster Manual` draft name is canonicalized to Scryfall's full rebalanced Adventure identity before lookup.
- Double-faced aliases, flavor/printed names, and the Prepare-card collision rule remain part of the shared identity contract.

The resolver must be deterministic with respect to API ordering. Ranking is based on language, special-treatment penalty, preferred set, paper/digital tie-breaking after the set anchor, release date, collector number, and card ID.

Future trophy/component imports must seed card metadata from the environment being built, not from an arbitrary other environment that happens to contain the same card name. Retained per-build image caches may fill missing metadata but may not override current environment-scoped shard metadata. Any true miss is resolved through the shared exact-name selector with that environment as the preferred set (or with no preferred set for Powered Cube).

## Display-only mutation boundary

Image maintenance may change only:

- `image_url`
- `mana_cost`
- `rarity`
- `type_line`

`scripts/refresh_card_images.py` scrubs those fields before comparison and fails if any other card or puzzle metadata changes. This is not a model, scoring, selection, or corpus-admission release.

## Fail-closed gates

The all-Pack-One refresh refuses publication when any of the following remain:

- unresolved served card names;
- an avoidable cosmetic/special printing where an ordinary printing exists;
- ambiguous card-ID/name mappings;
- test-suite or production-data audit failures;
- backend releases that do not match the reviewed code revision.

Unavoidable original/only special-frame printings are reported but do not fail the release.

The refresh always uploads `generated/card-image-refresh-report.json` and per-environment mappings as retained Actions diagnostics, including on failure. Inspect these first for unresolved names, avoidable special selections, unavoidable special selections, cross-set fallbacks, and card-ID/name collisions.

## Targeted repair vs full refresh

Use targeted repair for a known, isolated display regression on an exact served card name and explicit environment list when the shared selector/policy itself has not changed. Use the full refresh for resolver or printing-policy changes, bulk drift, audits, uncertain scope, or any case where more than a bounded named repair is intended.

Run the targeted repair dry-run before dispatching live mutation. Hydrate all replay shards read-only so the repair can apply the same global card-id/name collision check as the full refresh, then resolve and inspect the retained report without changing shards or checked-in source:

```bash
bash scripts/r2_replay_shards.sh hydrate
CARD_NAME='Titania, Protector of Argoth' \
REPAIR_ENVIRONMENTS='powered-cube' \
python scripts/repair_card_image.py --dry-run
cat generated/card-image-repair/report.json
```

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

## Guarded release sequence

Use `.github/workflows/card-image-release.yml` for reviewed card-image code changes. It requires a full reviewed `main` commit and runs:

1. exact-revision development function deploy;
2. exact-revision production function deploy;
3. Pack One card-image refresh pinned to that same reviewed commit.

The refresh workflow remains at `.github/workflows/refresh-powered-cube-images.yml` because the Draft Run API OIDC trust pins that path. Its behavior is Pack One-wide.

The refresh then:

1. hydrates replay shards from the model-versioned R2 namespace;
2. normalizes all served card display metadata;
3. runs the full test suite and production-data audit;
4. retains diagnostics;
5. verifies marked development/production backend revisions;
6. publishes normalized replay shards to R2;
7. refreshes development backend image metadata and verifies gameplay;
8. re-verifies the production release marker, refreshes production image metadata, and verifies gameplay;
9. publishes the refreshed checked-in corpus/card-image source of truth through a pull request.

The corpus-writer concurrency group serializes this with other corpus mutations. A failed normalization or verification stops before later publication stages.

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
