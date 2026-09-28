# Contextual Value v1 — frozen EOE P1P1 randomized-pack result

Date: 2026-09-28  
Issue: #529  
PR: #674  
Branch: `research/contextual-value-v1-h-freeze-audit-529`

## Status

The frozen EOE P1P1 randomized-pack study is complete.

Successful final execution:

- run **36482519871**;
- artifact **10998375100** — `contextual-value-v1-p1p1-eoe-primary-final`;
- artifact digest `sha256:ba7085279fc77ecf5db26c0b3f2a04eca21481c25923ae8d6e7414b579e0c879`.

The first outcome-job attempt in run `36475283530` failed before analysis because the workflow requested `preflight/card-metadata.json` instead of the retained artifact's actual `preflight/eoe-card-metadata.json`. No P1P1 result was produced by that failed attempt. The retry changed only the execution path and completed the already-frozen analysis.

## Frozen sample and outcome

Exact frozen cohort:

- **91,377** previously untouched EOE PremierDraft P1P1 drafts;
- exact archive SHA-256 `1dd9d1baf31fa56e06bbd2d9d9bb8c2c87cf342bc15872b5a30dbe9d4ecab648`;
- prior 13,000 EOE #529 IDs excluded exactly;
- observed outcomes: **91,377**;
- missing outcomes: **0**;
- nonterminal/retired records were not excluded.

Primary outcome remained recorded `event_match_wins`.

Exactly the preregistered ten-card family was tested with Bonferroni familywise alpha .05, giving two-sided **99.5%** intervals per card.

## Primary randomized-pack reduced form

| card | RF wins | 99.5% CI |
|---|---:|---:|
| Elegy Acolyte | **+0.3121** | **[+0.1478, +0.4764]** |
| Genemorph Imago | **+0.1732** | **[+0.0144, +0.3321]** |
| Nova Hellkite | +0.1497 | [-0.0072, +0.3065] |
| Warmaker Gunship | +0.1274 | [-0.0332, +0.2880] |
| Possibility Technician | +0.0615 | [-0.0927, +0.2156] |
| Thrumming Hivepool | +0.0614 | [-0.0939, +0.2167] |
| Anticausal Vestige | +0.0610 | [-0.1013, +0.2233] |
| Sunstar Chaplain | +0.0582 | [-0.0998, +0.2161] |
| Lumen-Class Frigate | +0.0533 | [-0.1034, +0.2100] |
| Mightform Harmonizer | -0.0293 | [-0.1817, +0.1232] |

Under the study's player-independent random-pack assumption, the primary reduced form estimates the effect of **receiving the randomized collated P1P1 pack shock containing the focal card**, not the effect of adding that card while holding the remainder of the pack fixed.

Two of ten preregistered reduced-form intervals are above zero after familywise multiplicity control:

- **Elegy Acolyte**
- **Genemorph Imago**

The other eight 99.5% intervals include zero.

## First stage and Wald estimates

Frozen full-cohort first-stage take rates when present were high, from 0.8115 to 0.9846.

The two multiplicity-adjusted positive Wald estimates are:

- Elegy Acolyte: **+0.3170 wins**, 99.5% CI **[+0.1501, +0.4838]**;
- Genemorph Imago: **+0.1954 wins**, 99.5% CI **[+0.0163, +0.3745]**.

Wald is more assumption-dependent than the reduced form. It additionally requires relevance, monotonicity and approximate exclusion, and must not be described as assumption-free proof of the effect of taking the card.

## Missing-outcome sensitivity

There were **zero missing outcomes**, so the prespecified missing-outcome worst-case bounds collapse to the observed reduced-form estimates for every focal card.

## Pre-draft balance

Recorded rank / skill / experience balance was generally small across the ten randomized pack-presence comparisons.

Across the focal cards:

- absolute skill standardized differences were at most about **0.067**;
- absolute experience standardized differences were at most about **0.058**;
- maximum rank-level probability difference was at most about **0.026**.

This is consistent with the intended player-independent pack assignment in the recorded covariates, while not proving the platform randomization mechanism.

## Collation and exclusion diagnostics

The final artifact includes outcome-free co-presence diagnostics for all **59** EOE cards with take rate >=30% when present, including the ten primary cards.

Rarity composition visibly co-moves with focal-card presence, as expected under booster collation. For example, focal-card presence can shift rare/mythic/uncommon composition. Therefore the P1P1 instrument is the **collated pack shock**, not an isolated card-addition experiment.

P1P9:

- P1P9 was logged for **100%** of the 91,377 frozen drafts;
- the average count of P1P1 card names still present at P1P9 was approximately **5.00**;
- focal-card return after being passed was rare: 0 for most primary cards, about **1.12%** for Genemorph Imago and **0.45%** for Possibility Technician among logged passed cases.

This reduces, but does not eliminate, downstream passed-card / neighbor-signal concerns.

Actual Arena booster-slot provenance is unavailable in the 17Lands archive. The archive records offered card counts but not which physical slot/replacement mechanism generated each card, so rare/wildcard/special-slot origin is explicitly labeled unavailable rather than inferred.

## Interpretation boundary

This study provides behavior-model-independent evidence about randomized **P1P1 pack receipt** for EOE.

It does **not**:

- directly compare A versus R;
- establish that the focal card alone caused the entire reduced-form effect independent of the rest of the collated pack;
- prove the Wald exclusion restriction;
- justify adding new cards or sets after seeing the results;
- estimate P1P2-P1P8 causal recommendation effects;
- authorize a production model change.

The R confirmation remains a separate observational OPE study and is not pooled with these P1P1 results.
