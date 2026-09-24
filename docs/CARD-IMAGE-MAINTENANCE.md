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

GitHub Actions is not currently permitted to create pull requests in this repository, even when a workflow has `pull-requests: write`. The workflow must therefore treat a successful branch push as its handoff rather than calling `gh pr create`.

If live backend propagation has already succeeded but source publication fails, do **not** rerun production propagation just to recover the checked-in files. `.github/workflows/publish-card-image-source.yml` hydrates the already-normalized R2 state, deterministically regenerates the checked-in corpus, validates it, pushes a recovery branch, and hands that branch to an authorized operator/app for the protected-main PR.

## Operational interpretation

A successful code deploy does not mean card images are live. Live image state changes only after normalization, audit, exact-release checks, R2 publication, backend propagation, and gameplay verification pass.

Conversely, the live product can be correct while the final checked-in source publication is still pending. Treat those as separate states:

- backend refresh + gameplay verification establish the live production image state;
- the source-of-truth PR establishes repository closeout.

Do not rerun a successful production backend refresh merely because protected-branch publication failed. Recover the repository state through the PR-based source publication workflow.

See [the September 23 card-image rollout closeout](reports/CARD-IMAGE-ROLLOUT-CLOSEOUT-2026-09-23.md) for the production evidence and the protected-branch recovery that established this contract.
