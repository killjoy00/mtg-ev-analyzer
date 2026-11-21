# Star Trek (TRK): draft printing and art-source review

**Prepared November 20, 2026 · pre-17Lands source review · not a publication approval**

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

Scryfall-derived card catalogs currently list `SDS` as a **masterpiece** companion of `TRK` with release date **2026-11-13**; this is among the policy's pre-existing `DRAFT_SHEET_SET_TYPES`. However, **physical booster inclusion does not prove Arena Premier Draft inclusion or verify Scryfall's per-printing `games` flag**. Validate those details against live input when available.

## Existing policy audited, no speculative change

In `scripts/fetch_card_metadata.py`:

1. `draft_printing_priority` prefers **same-set** `trk` card images, provided the printing isn't a promo, variation, oversized or textless.
2. The next priority is a same-release `arena` printing whose `set_type` is an approved booster-sheet type. Existing allowed set types already include `masterpiece`, so an eligible SDS printing needs **no special-case code change**.
3. A `trc` printing tagged `commander` cannot enter the same-release bonus tier. Neither can a paper-only SDS printing, a collector-only/promo variant, an Alchemy-only card, art-series printing, or any unknown nonapproved set type.
4. The resolver selects the sheet's **lowest collector number** before ordinary cosmetic penalties. The source rule should preserve intentional Stardates borderless art if the real Arena draft printing matches.
5. Every selected cross-set printing must be recorded as `sds/<collector_number>` in `corpus/draft-run/card-printings.json` after the full refresh produces its **proposed** record. The human-reviewed/PR-gated record is not modified pre-data. The full refresh checks the actual served inventory, including sets without replay shards.

The exact regression fixture in `tests/test_card_image_refresh.py` models the hypothetical case where SDS is Arena-available, and also proves that paper-only SDS / TRC / collector-only variants cannot win. This protects the existing policy without making an unverified assertion about Arena's actual pack distribution.

## After the actual Arena archive arrives

1. List exact TRK archive `pack_card_*` names and identify any reprinted or Stardates names actually present. Do not assume all 30 paper SDS cards are on Arena.
2. Cross-check each observed reprint/bonus card's **canonical Scryfall identity**, `flavor_name` / `printed_name` (e.g. a Stardates Star Trek title printed over an existing Magic card name), card faces and HTTPS image. **Never match by fuzzy similarity.** If an alias is not resolvable, fail closed and add a reviewed exact-name alias only with proof.
3. Verify Scryfall `set`, `set_type`, `released_at`, `games`, `collector_number` and promo/variation metadata for chosen SDS printings. Reject same-day Commander, unrelated premium treatments and card names not present in the archived draft.
4. Generate the full served card-image inventory and guarded full-refresh **proposal**. Compare the new `trk` printing choices to official booster contents. Review and commit any additions to `corpus/draft-run/card-printings.json` through a PR, then run the guarded release and verify actual backend-served cards.
5. Record discovered card aliases, chosen cross-set printings, any Scryfall/Arena mismatch and release evidence in #1728. If the card source is not resolved, keep the set Candidate.

**Status:** Source rules reviewed and documented; **no SDS art selected and no source archive inspected yet**. Neither a future source validation nor a future production image propagation has been executed here. 
