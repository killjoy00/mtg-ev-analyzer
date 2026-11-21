# Star Trek (TRK): draft printing and art-source review

**Updated November 20, 2026 · before public 17Lands archive release · not a publication approval**

This note is for [one-time Star Trek launch #1728](https://github.com/killjoy00/mtg-ev-analyzer/issues/1728) and the [permanent new-set runbook](NEW-SET-LAUNCH-RUNBOOK.md). It documents how the **existing** [card-image policy](CARD-IMAGE-MAINTENANCE.md) applies to official Star Trek products. It is not a new set-specific image allowlist. **Do not publish TRK or pre-populate the reviewed printing record from this note.** Only the official **Arena PremierDraft archive and actually served cards** can decide that.

## Confirmed facts

| Code | Product | What official Wizards documentation says | Policy when serving TRK |
| --- | --- | --- | --- |
| `TRK` | Star Trek main expansion | Main cards and draft booster printings | Prefer an ordinary/base TRK printing for cards in TRK |
| `SDS` | Stardates reprints | **30** Stardates cards; non-foil versions can appear in **physical Play Boosters** (approximately 1 in 25), with collector variants elsewhere | Eligible as same-release booster-source art **only if** the exact card occurs in the Arena archive, Scryfall marks the selected printing as an Arena card, metadata identifies an allowed booster-sheet set type, and the reviewed art record approves the chosen printing |
| `TRC` | Star Trek Commander | Commander decks and associated non-draft product | Do **not** treat same-release Commander art/cards as a TRK draft bonus sheet |

Official sources:
- [Wizards: Collecting Star Trek](https://magic.wizards.com/en/news/feature/collecting-star-trek) — codes, 30 Stardates cards, 1/25 Play Boosters, foil/collector distinctions, dates
- [Wizards: Star Trek prerelease guide](https://magic.wizards.com/en/news/feature/star-trek-prerelease-guide) — Draft mechanics and color-pair plans
- [Wizards: Star Trek release notes](https://magic.wizards.com/en/news/feature/star-trek-release-notes) — legality and mechanics

Scryfall-derived card catalogs currently list `SDS` as a **masterpiece** companion of `TRK` with release date **2026-11-13**; this is among the policy's pre-existing `DRAFT_SHEET_SET_TYPES`. Stardates **are draftable TRK Limited cards**, including on Arena. What remains unverified before the public archive is the **exact 17Lands card-name representation, observed incidence per printing, and Scryfall's specific `games`/printing flags**. These implementation details must not be mistaken for an argument that SDS cannot appear in a Star Trek pack.

## Existing policy audited, no speculative change

In `scripts/fetch_card_metadata.py`:

1. `draft_printing_priority` prefers **same-set** `trk` card images, provided the printing isn't a promo, variation, oversized or textless.
2. The next priority is a same-release `arena` printing whose `set_type` is an approved booster-sheet type. Existing allowed set types already include `masterpiece`, so an eligible SDS printing needs **no special-case code change**.
3. A `trc` printing tagged `commander` cannot enter the same-release bonus tier. Neither can a paper-only SDS printing, a collector-only/promo variant, an Alchemy-only card, art-series printing, or any unknown nonapproved set type.
4. The resolver selects the sheet's **lowest collector number** before ordinary cosmetic penalties. The source rule should preserve intentional Stardates borderless art if the real Arena draft printing matches.
5. Every selected cross-set printing must be recorded as `sds/<collector_number>` in `corpus/draft-run/card-printings.json` after the full refresh produces its **proposed** record. The human-reviewed/PR-gated record is not modified pre-data. The full refresh checks the actual served inventory, including sets without replay shards.

The regression fixture in `tests/test_card_image_refresh.py` checks an Arena-eligible SDS example and proves that paper-only SDS / TRC / collector-only variants cannot win **as generic art sources**. This is an image-source policy test, not a denial that Stardates cards appear in TRK Arena Draft. If Scryfall's metadata disagrees with observed draft inclusion, require an explicit, source-verified fix before serving that card rather than showing an unrelated older printing.

## Player-visible name must match Star Trek artwork

The **printed Star Trek name is authoritative for the player-facing Pack One screen**. For example:

| In the Pack One pack, card zoom and results | Canonical Magic name used only for data joins | Correct art |
| --- | --- | --- |
| **Khan, Engineered Evil** | `Sheoldred, the Apocalypse` | **Khan** (SDS #11) |
| **General Picard, Earth Warlord** | `Kenrith, the Returned King` | **General Picard** (SDS #3) |
| **Leonard McCoy, Country Doctor** | `Bristly Bill, Spine Sower` | **Leonard McCoy** (SDS #15) |

The live 17Lands web view uses original Magic identities for SDS reprints. Those may be needed internally to match Scryfall, 17Lands draft/game columns, strength, trophy decklists and scoring. **They must never leak into Pack One's player-visible title when that player sees a Stardates printing.** They are not alternate gameplay choices.

The `card-metadata.mjs` `TRK_STARDATES_DISPLAY_NAMES` map contains all **27 alternate printed titles** (the other three of 30 keep their original Magic names). `publicDraftRunPuzzle` and `publicDraftRunAnswer` map only the outward response labels for `set_id === 'trk'`. Scoring, source IDs, stored answers and strength lookups continue to use canonical names and do not change. This also works for mobile clients, since they render the same server-provided name. Tests in `tests/card-metadata.test.mjs` guard this behavior.

At launch the image refresh must independently verify that an `SDS` printing with the matching **Khan artwork** (or the appropriate Trek-character image) is selected. **A Khan label over Sheoldred art or a Sheoldred label over Khan art fails launch acceptance.** No unverified image is baked in before the raw archive; the displayed title rule is prepared now.

## After the actual Arena archive arrives

1. List exact TRK archive `pack_card_*` names and identify Stardates cards actually present in this archive snapshot. The sheet is draftable, but a particular card need not occur in the sampled archives.
2. Cross-check each observed reprint/bonus card's **canonical Scryfall identity**, `flavor_name` / `printed_name` (e.g. a Stardates Star Trek title printed over an existing Magic card name), card faces and HTTPS image. **Never match by fuzzy similarity.** If an alias is not resolvable, fail closed and add a reviewed exact-name alias only with proof.
3. Verify Scryfall `set`, `set_type`, `released_at`, `games`, `collector_number` and promo/variation metadata for chosen SDS printings. Reject same-day Commander, unrelated premium treatments and card names not present in the archived draft.
4. Generate the full served card-image inventory and guarded full-refresh **proposal**. Compare the new `trk` printing choices to official booster contents. Review and commit any additions to `corpus/draft-run/card-printings.json` through a PR, then run the guarded release and verify actual backend-served cards.
5. Record discovered card aliases, chosen cross-set printings, any Scryfall/Arena mismatch and release evidence in #1728. If the card source is not resolved, keep the set Candidate.

**Status:** Source rules reviewed and documented; **no SDS art selected and no source archive inspected yet**. Neither a future source validation nor a future production image propagation has been executed here.
