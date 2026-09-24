# Card image maintenance

Pack One card-image maintenance is an explicit, display-only corpus operation. It normalizes every currently served card to deterministic Scryfall main art without changing puzzle identity, candidate identity, scoring evidence, model support, provenance, source trajectories, schedules, sessions, or historical scores.

## Selection policy

The shared resolver in `scripts/fetch_card_metadata.py` owns card identity, aliases, face selection, and printing rank.

- Regular draft environments prefer an ordinary/base printing from the intended draft set.
- If the intended set has no ordinary printing for that exact identity, resolution may fall back to the earliest ordinary printing for the identity.
- Powered Cube uses the global earliest ordinary/base printing policy directly.
- Cosmetic/special treatments are penalized and rejected when a cleaner ordinary printing exists. Current special signals include variation, textless, full-art, promo, oversized, borderless, showcase/extended-art/inverted frame effects, and non-card set types such as art-series or tokens.
- A special-framed printing is allowed when it is the original/only official printing and no ordinary alternative exists. The refresh report records these separately as unavoidable special printings; they are not treated as publication blockers.
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

The refresh always uploads `generated/card-image-refresh-report.json` and per-environment mappings as a retained Actions diagnostic artifact, including on failure. This is the first place to inspect exact unresolved names, avoidable special selections, unavoidable special selections, cross-set fallbacks, and card-ID/name collisions.

## Guarded release sequence

Use the guarded card-image release for reviewed code changes rather than running image publication as a side effect of a merge.

`.github/workflows/card-image-release.yml` requires a full reviewed `main` commit and runs, in order:

1. exact-revision development function deploy;
2. exact-revision production function deploy;
3. Pack One card-image refresh pinned to that same reviewed commit.

The refresh workflow is still stored at `.github/workflows/refresh-powered-cube-images.yml` because the Draft Run API OIDC trust pins that workflow path. Its display name and behavior are Pack One-wide.

The refresh then:

1. hydrates replay shards from the model-versioned R2 namespace;
2. normalizes all served card display metadata;
3. runs the full test suite and production-data audit;
4. retains diagnostics;
5. verifies the marked development/production backend revisions;
6. publishes normalized replay shards to R2;
7. refreshes development backend image metadata and verifies gameplay;
8. re-verifies the production release marker, refreshes production image metadata, and verifies gameplay;
9. commits the refreshed checked-in corpus/card-image source of truth back to `main`.

The corpus-writer concurrency group serializes this with other corpus mutations. A failed normalization or verification stops before R2/backend/corpus publication.

## Operational interpretation

A successful code deploy does not mean card images are live. Live image state changes only after the refresh passes its normalization, audit, exact-release, R2, backend, gameplay, and checked-in corpus steps.

Likewise, a failed refresh can leave the reviewed resolver code deployed while the previous image data remains live. Treat the refresh run and its diagnostic report as the authority for image publication status; record completed production evidence separately in [CURRENT-STATE](CURRENT-STATE.md).
