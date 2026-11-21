# Star Trek draft names and artwork

Star Trek (TRK) uses its main-set draft printings and the Stardates bonus sheet (SDS). TRC is the Commander product. Wizards lists 30 Stardates printings. Scryfall lists all 30 English printings as single-faced and Arena-available. On November 21, 2026, the canonical names, printed names and normal image URLs in the [reference list](../corpus/stardates-printings.json) matched the [Scryfall SDS catalog](https://api.scryfall.com/cards/search?q=set%3Asds&unique=prints). None of its canonical identities also appeared in the TRK main-set search. [Wizards booster contents](https://magic.wizards.com/en/news/feature/collecting-star-trek)

| SDS printing | Archive identity | Player-facing title |
| --- | --- | --- |
| 11 | Sheoldred, the Apocalypse | Khan, Engineered Evil |
| 3 | Kenrith, the Returned King | General Picard, Earth Warlord |
| 15 | Bristly Bill, Spine Sower | Leonard McCoy, Country Doctor |

The 27 renamed cards and the three same-name cards use the image from their exact SDS printing. The API supplies that image and title to packs, prior picks, results, creator comparisons, Insights and trophy decks. Saved pick IDs, grading names and strength joins use source identities. Exact TRK lookup rejects ambiguous or unresolved names. Import and full image refresh check observed SDS images against the reference, and corpus health checks raw pack and prior-pick images before public formatting.

At launch, reconcile the draft and game columns with all 30 identities. Distinguish missing columns, zero observations and actually served cards. Record the observed printings in [issue #1728](https://github.com/killjoy00/mtg-ev-analyzer/issues/1728), review the [guarded image proposal](CARD-IMAGE-MAINTENANCE.md) for the serving inventory, release it and verify the deployed API. Archive availability, approval of the served inventory, and release remain separate milestones.
