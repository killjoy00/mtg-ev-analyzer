# Card faces

Card enlargement shows both image-bearing faces side by side at widths of at
least 760px. Narrow screens show one full image with an explicit Show back /
Show front control. Meld cards use Show meld result and name the required
partner. The grid remains a single pick target with a separate enlarge action
on web and the existing long-press action on native. Viewing faces never submits
or changes a pick.

## Data contract

`image_url` remains compatible with older clients. Optional `display_faces`
contains exactly two ordered records: `{name, image_url, large_image_url?, role,
partner_name?}`. Roles are `front` and `back`, or `front` and `meld_result`.
Meld results require `partner_name`. Image URLs use the existing Scryfall HTTPS
publisher allowlist. A missing large image falls back to the normal image; a
failed normal image offers retry while retaining the other face.

Scryfall's actual face imagery determines whether two images exist. Split,
Adventure and old-style flip cards with a complete top-level image remain one
view. Meld follows `all_parts.component=meld_result`, not token relationships.
Never generate back image URLs by editing a front URL. `scripts/card_faces.py`
is the import normalizer. `card-faces.mjs` is the shared API/client validator.

For existing rows, `card-metadata.mjs` applies
`corpus/card-face-metadata.json` in memory by exact Scryfall printing UUID
extracted from the existing image URL, plus an exact card-name alias check.
This preserves the chosen printing and avoids collisions between paper,
Arena-rebalanced and similarly named cards. Public puzzle serialization,
saved-answer serialization and Insights' saved-decision serializer all apply
the overlay. They never rewrite the stored evidence or awarded scores.
New importers and image maintenance preserve the optional face records.

## Regeneration and coverage

Run from the repository root:

```sh
python scripts/build_card_face_metadata.py --scryfall-cache /tmp/scryfall-double-faces.json
```

The cache is an optional reproducible Scryfall source snapshot; omit it or use a
fresh path when checking newly released printings. The generator inventories the
checked-in corpus and supplemental card-image map, reads all Scryfall DFC/meld
printings, and retains only exact matches. Incomplete matched pairs fail the
generation. The initial inventory contained 10,365 image printings, of which
396 matched supported double-faced/meld records, with no incomplete matched
pairs. This is local inventory evidence, not an exhaustive production audit.

Before promotion, supplement the inventory with a reviewed read-only export of
card names and image URLs from the active parent corpus, every Live supplemental
component, and saved-answer snapshots. Do not export player/account fields.
Supply that JSON tree via repeatable `--inventory FILE.json` arguments. Review
any extra printing mappings before release. Unknown printings retain their
existing single-image fallback until their metadata is resolved.

No database migration or corpus rebuild is required for the overlay. Deploy
the API additions before the web viewer and native app release; existing
clients ignore optional fields. Pages deployment alone does not deploy the
API or update installed native apps. Roll back the viewer/API revision to
remove the feature without altering saved game results.

## Verification

- `node --test tests/card-faces.test.mjs`: exact-print aliases, public pack and
  pool, saved answers, Insights, sanitization, score/evidence preservation.
- `python -m unittest tests.test_card_faces`: real Scryfall transform, modal,
  Battle, meld and single-image fixtures; incomplete pair rejection.
- `node --import ./tests/e2e-production-guard.mjs tests/card-faces-e2e.mjs`
  with the local site on port 4173: actual pack/pool/feedback entry points,
  320/390/1440px layouts, keyboard focus, failure/retry and pick isolation.
- `cd mobile && npm run test:shared`: native phone/tablet switching, reset,
  fallback/retry, meld copy, type checking and existing screen regressions.

The Scryfall fixtures in `tests/fixtures/card-faces/scryfall.json` retain only
public card identity, layout, imagery and related-part fields fetched from
Scryfall's card API on 2026-10-21. Browser tests stub the image transport; they
do not require Scryfall availability or access a production game API.
