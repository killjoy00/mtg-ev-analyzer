# Pack One current state

Updated: September 2026.

This file is the short operational reference for the product as it exists now. Older launch and migration documents remain useful history, but this file should win when they describe an earlier rollout state.

## Primary product

Pack One has two primary games on the home page:

- **Draft Run** — ten independent Pack 1 decisions from verified trophy drafts across eligible expansion sets.
- **Powered Cube** — ten independent Powered Cube trophy decisions, beginning at P1P2 because the source does not contain a complete P1P1 pack.

Top 3 and Full Pack remain available under **More modes**. They are secondary study modes, not the default landing-page product.

## Daily loop

Draft Run and Powered Cube each have an independent ranked Daily, leaderboard and first attempt. A player can complete both on the same Eastern game day.

The home page now treats those two Dailies as one simple daily check-in: show whether each is finished, show the completed score/rank when available, and show progress toward finishing both. Reading the Today surface must never reserve or start a Daily; clicking Play / continue enters the normal Daily route, which resumes an existing attempt when one exists.

## Scoring and difficulty

The historical trophy pick remains the full-credit target at 100. Other choices receive contextual partial credit capped at 95.

Difficulty is an internal run-composition and reroll-matching heuristic. Unanswered player-facing puzzles do not show difficulty ratings/bands or grading support before the choice is locked. Human calibration should come from non-QA first-attempt observations before any future threshold change.

## Decision feedback and phone layout

Locked Draft Run/Cube answers show the trophy choice and elite consensus separately, the player's relative support, the three leading alternatives, and an expandable comparison of every card. Relative support is not a correctness or win probability. The pack remains available in an expandable review, and card enlargement works in both the pack and feedback. Revealed comparison cards link to TCGplayer; commission tracking still requires the configured Impact template.

Phone packs use three columns, compact ordered prior-pick thumbnails, and a sticky dock containing selection, lock, and rerolls. Progress always identifies rounds separately from earned points. Full set names come from the checked-in `data/set-display-names.json` snapshot of [Scryfall set metadata](https://api.scryfall.com/sets), verified 2026-09-14, with set codes as a network-failure or new-set fallback. Refresh the display-name snapshot when registering a new environment; it does not control corpus eligibility or recency weighting.

Result sharing defaults to spoiler-free text with ten score squares, trophy matches, game family and the actual Eastern Daily date. Image sharing remains an explicit secondary option. The date identifies the Daily without inventing a historical launch-based puzzle number. Native iPhone sharing still needs real-device verification.

## Powered Cube contract

- Cube is isolated from expansion Draft Run.
- New Cube runs begin at P1P2 with the real P1P1 card visible in the inherited pool.
- Cube has two pack rerolls and no set reroll.
- New Cube selection is capped at P1P11.
- Cube has separate Daily scheduling, leaderboard treatment, friend challenges and career attribution.
- Current Cube gameplay is owned by the dedicated Draft Run frontend. Old Cube Full Pack presentation code is compatibility history and must not be loaded on the current runtime path.

## Card images

The Powered Cube image refresh is display-only. It may replace image URL, mana cost, rarity and type-line display metadata, but it must not change puzzle identity, candidate identity, scoring evidence, source trajectory or model values.

The refresh prefers readable standard English printings, protects against Prepared/face-name alias collisions, runs the full test/data gates, verifies development gameplay, then verifies production gameplay before refreshed metadata is promoted.

## Profile

Account/Profile remains one destination. The profile should be useful without becoming a second application. Keep the emphasis on a compact career snapshot: total games, average/best, Daily streak, challenges, environments, Draft Run record, Cube record, best Daily finish, recent form and the existing archive/achievement/history sections.

Guest-first play remains the default. Account claiming is for persistence and public identity, not access to core gameplay.

## Baseline artifacts vs production corpus

Checked-in verified corpus artifacts document reproducible release baselines. Production may contain later validated imports from the complete trophy importer. Do not treat an older checked-in baseline count as the live production count without checking the production database/import manifests.

## What finishing the job means

For the current product chapter, 'finished' does **not** mean adding another game mode. It means:

1. Product behavior and documentation agree.
2. Current Cube gameplay has one runtime owner; retired presentation paths are not loaded.
3. Draft Run and Cube both pass unit, browser and backend smoke gates.
4. The Cube image identity audit stays clean and image refresh cannot alter gameplay data.
5. Today/Profile surfaces use existing authoritative data rather than creating parallel state.
6. Analytics cleanly separate QA from real first-attempt player behavior before calibration decisions are made.
7. Remaining work is retention, challenge-loop polish, human difficulty calibration and distribution — not core-mechanics reconstruction.

See `CHARTER.md`, `DATA-MANAGEMENT.md`, `SCORING-AND-DIFFICULTY.md` and `LAUNCH_REVIEW.md` for deeper history and contracts.
