# P1P1 randomized-pack primary study — EOE freeze

**Issue:** #529  
**Date:** 2026-09-28 UTC / 2026-09-27 PT  
**Status:** outcome-free preregistration. No outcome from the new P1P1 cohort may be read before this freeze.

## Purpose

Use Arena's random P1P1 pack generation, conditional on EOE booster collation rules, as a behavior-model-independent source of variation.

This study is separate from observational R-LCB OPE. It does not alter R's gate.

## Primary set and fixed sample

Primary environment: **EOE**.

Exact public draft archive SHA-256:

`1dd9d1baf31fa56e06bbd2d9d9bb8c2c87cf342bc15872b5a30dbe9d4ecab648`

Outcome-free inventory run: **36388824016**.

EOE contains exactly **104,377** PremierDraft P1P1 records.

Exclude every exact ID in the prior #529 EOE 13k boundary:
- prior stable-hash 8,000 cohort;
- subsequent frozen 5,000 Q/Guard confirmation cohort.

Use **every remaining P1P1 draft ID**.

Frozen sample size: **N = 91,377 drafts**.

Do not condition on event completion, 7-win/3-loss status, rank, skill, selected card, or any model score.

If a frozen-sample draft lacks the prespecified outcome when outcomes are opened, report the missing count and run a prespecified missing-outcome sensitivity; do not silently replace the cohort.

## Primary outcome

Recorded `event_match_wins`.

Nonterminal/retired events are not excluded.

Pre-existing spent-data planning SD:

`sigma_Y = 2.1766 wins`.

## Primary ten-card family

Selected without outcomes by:

1. at least 1,500 appearances among the 91,377 untouched EOE P1P1 packs;
2. take rate when present >= 0.80.

Exactly ten cards qualify:

| card | appearances | take rate | planned Wald SE | 80% MDE |
|---|---:|---:|---:|---:|
| Elegy Acolyte | 1,560 | 0.98462 | 0.05645 | 0.20598 |
| Nova Hellkite | 1,591 | 0.94720 | 0.05812 | 0.21205 |
| Anticausal Vestige | 1,568 | 0.94388 | 0.05874 | 0.21433 |
| Lumen-Class Frigate | 1,577 | 0.90108 | 0.06136 | 0.22388 |
| Genemorph Imago | 1,571 | 0.88670 | 0.06247 | 0.22794 |
| Possibility Technician | 1,592 | 0.86055 | 0.06395 | 0.23333 |
| Warmaker Gunship | 1,517 | 0.84970 | 0.06632 | 0.24198 |
| Sunstar Chaplain | 1,557 | 0.82595 | 0.06736 | 0.24578 |
| Thrumming Hivepool | 1,557 | 0.82145 | 0.06773 | 0.24713 |
| Mightform Harmonizer | 1,602 | 0.81149 | 0.06761 | 0.24668 |

Planning uses Bonferroni familywise alpha .05 across ten cards:
- per-card two-sided alpha = .005;
- z(.9975) = 2.8070;
- 80% power z = .8416.

Predeclared worthwhile per-card Wald effect: **+0.25 event wins**.

## Primary randomized reduced form

For each frozen card c:

`Z_c = 1` iff c appears in the random P1P1 pack.

Report:

`RF_c = E[Y | Z_c=1] - E[Y | Z_c=0]`.

Under player-independent random pack generation, this is the causal effect of receiving the collated random-pack shock containing c versus the distribution of legal packs without c.

Report:
- point estimate;
- Bonferroni two-sided **99.5% CI**;
- unadjusted CI95 descriptively;
- presence counts;
- outcome-free balance of recorded pre-draft rank/skill/experience versus Z_c.

No covariate adjustment is primary.

## First stage and Wald ratio

`FS_c = P(take c | Z_c=1) - P(take c | Z_c=0)`.

Report:

`Wald_c = RF_c / FS_c`.

Use matching multiplicity control.

Interpret Wald as a complier-specific effect of taking c versus the natural alternative only under relevance, monotonicity and approximate exclusion.

The reduced form is always the primary causal result.

## Collation / exclusion diagnostics

Before interpreting Wald:
- report which pack composition/slot distributions co-move with c;
- compare rarity/special-slot composition;
- report associations with other high-pick cards;
- report P1P9 return behavior where measurable;
- preserve the downstream neighbor-signal caveat.

Do not describe Wald as adding c while holding the other pack cards fixed.

## Multiplicity

Exactly ten primary RF tests.

Bonferroni familywise alpha .05: each receives a two-sided 99.5% CI.

No additional card can enter the primary family after outcomes are opened.

## Secondary pooled/model analyses

Pooled candidate-feature IV/2SLS and random-pack score validation are authorized only after their exact outcome-free instrument/score definitions are committed.

If R's pre-run bundle is not frozen, do not define or compute an R pack score.

## Replication

FIN/TDM/DFT/MSH/SOS remain separate untouched replication resources. They may not be opened opportunistically based on EOE.

## Stop rule

Use all 91,377 untouched EOE P1P1 drafts. Do not add sets/cards after results and do not remove nonterminal events.

No production behavior changes from this study alone.
