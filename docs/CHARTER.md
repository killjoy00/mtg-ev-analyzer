# Pack One product charter

Status: working charter for the trophy-puzzle rebuild.

## Product promise

Pack One is a fast Limited decision game built from real 17Lands Premier Draft data. It is not a deck builder and it is not a counterfactual draft simulator. The player makes difficult draft choices, sees what an elite drafter actually did, and gets a compact score that also respects strong-player consensus.

The product has two core modes.

## Mode 1: Pack One

The existing opening-pack game stays intact.

- Show one real P1P1.
- The player ranks their top three cards.
- Grade against the existing strong-player consensus model.
- Historical drafter choice remains supplementary context.
- Unlimited seeded friend challenges and Daily can continue to use the same opening pack for everyone.

This mode is the quick, low-context version of Pack One.

## Mode 2: Draft Run

Working name: **Draft Run**.

A Draft Run is ten independent first-pack puzzles. Each puzzle comes from a different real Premier Draft trophy draft by a very strong, experienced 17Lands drafter. The ten questions do **not** pretend to be one continuous draft.

Each question shows:

1. the set;
2. every card the source drafter had already taken in Pack 1, in pick order;
3. the real pack that reached that drafter at the sampled pick;
4. one player choice.

After the choice, reveal:

- the card the trophy drafter actually took;
- the held-out strong-player consensus ranking/support for that exact historical state;
- the player's score for the question.

The source draft's actual choice is the primary target because deeper Pack 1 decisions are increasingly path-specific. Consensus is the secondary signal, not a claim that the trophy drafter's choice was objectively correct.

## Source corpus

### Puzzle eligibility

A source draft must be:

- 17Lands public **PremierDraft** data;
- a trophy (`event_match_wins == 7`);
- from an experienced drafter (`user_n_games_bucket` lower bound at least 100);
- from the high-win-rate cohort for that set/format;
- complete enough to reconstruct the relevant first-pack state.

Default elite cohort: top 15% of experienced drafters by `user_game_win_rate_bucket`, matching the existing Pack One cohort logic. This threshold is a data-quality default, not a marketing claim, and can be tightened after corpus-size audits.

### Consensus training

The puzzle corpus is trophy-only. The consensus model should be trained on the broader elite-drafter cohort, not only trophies. This keeps the comparison statistically useful and avoids making "consensus" synonymous with selection into a 7-win outcome.

Every puzzle must be scored out-of-fold by draft ID so the source draft never contributes to its own consensus estimate.

### Set coverage

Ingest every set for which 17Lands publishes Premier Draft draft data. Frozen historical sets are built once. Active sets may be refreshed when the public bulk dataset changes.

Raw 17Lands archives are build inputs only. Do not commit or ship raw archives to the browser. Store only the derived trophy puzzle corpus and compact model outputs needed by the game.

## Ten-question progression

The run should feel progressively more contextual without mechanically forcing question N to equal P1PN.

Target windows:

| Round | Eligible first-pack pick |
| --- | --- |
| 1 | P1P1 |
| 2 | P1P2 |
| 3 | P1P3 |
| 4 | P1P3-P1P5 |
| 5 | P1P4-P1P6 |
| 6 | P1P5-P1P7 |
| 7 | P1P5-P1P8 |
| 8 | P1P6-P1P9 |
| 9 | P1P7-P1P10 |
| 10 | P1P8-P1P11 |

Sampling should reject trivially forced questions. Within the round window, prioritize useful decisions and corpus diversity rather than always choosing the latest possible pick.

### Set diversity

- A normal ten-question run should not repeat a set when at least ten eligible sets exist.
- Never use the same source draft twice in a run.
- A replacement question must not collide with another question already in the run.

## Question scoring

The trophy drafter is the primary target; consensus gives graded partial credit.

1. If the player matches the source trophy drafter, the question score is **100**.
2. Otherwise, the held-out consensus leader is the highest-scoring alternative.
3. Consensus #2 is the next-highest alternative, and so on monotonically by model support.
4. Consensus credit is capped below 100 and gradually matters less at deeper pick positions.

Initial formula for a non-historical selection:

`score = consensus_cap(pick_number) * (selected_support / leader_support) ^ 0.75`

with the cap starting near 96 at P1P1 and tapering toward the high 80s by late Pack 1. The exact taper is a calibrated product parameter and must be covered by distribution tests.

This guarantees that an idiosyncratic trophy pick can still be the game's full-credit answer while a strong consensus alternative receives substantial partial credit.

## Run scoring

The main Draft Run score is the arithmetic mean of the ten question scores, rounded to an integer.

Why equal weighting:

- the sampler already controls question quality/difficulty;
- every round is legible as 10% of the run;
- reroll matching is easier to keep fair;
- Daily comparisons remain understandable.

Difficulty is used to select and match questions, not to secretly change their weight after the player answers.

## Rerolls

Every Draft Run gets exactly two one-use rerolls before a choice is made:

### Set reroll

Replace the current question with a question from a **different set** at similar pick depth and decision difficulty.

### Pack reroll

Keep the **same set**, but replace the current question with a different source draft/puzzle at similar pick depth and decision difficulty.

A rerolled-away question disappears and has no scoring effect.

Replacement matching should consider:

- round/pick window;
- candidate count;
- consensus leader-vs-second gap;
- normalized support entropy;
- prior-pool size.

Daily rerolls must be deterministic: everyone gets the same base ten questions and the same two replacement options for each eligible question.

## Daily and unlimited play

### Daily Draft Run

- One shared ten-question run per Eastern game day.
- Same base questions and deterministic reroll replacements for every player.
- First completed score is the ranked score.
- Global daily/weekly/monthly/all-time leaderboard treatment can mirror the current Daily framework.

### Unlimited Draft Run

- Randomized ten-question runs from the same corpus.
- Personal stats and friend challenges are allowed.
- No global ranked leaderboard credit.

## Presentation principles

- Always show all prior Pack 1 picks for contextual questions.
- Do not imply that consensus is objective truth.
- Do not imply that the source drafter's trophy proves a card was causally correct; it is the game target because it is a real successful draft path.
- Reveal both signals clearly: **Trophy drafter took** and **Elite consensus**.
- Favor score/support magnitude over misleading ordinal labels for low-support outliers.
- Keep the active game ad-free.

## Non-goals

- Simulating the other seven seats.
- Reconstructing a counterfactual pack after the player makes a different choice.
- Building a 40-card deck.
- Letting one question's choice alter the next question.
- Using live model/LLM calls for scoring.

## Data architecture direction

Neon is the source of truth for the derived Draft Run corpus. Store source-draft metadata and one queryable puzzle row per historical first-pack decision. The browser should receive only the selected puzzle payloads through a server endpoint.

The existing static opening-pack corpus remains appropriate for Pack One / Top 3.

## Working name shortlist

1. **Draft Run** — recommended; clear, game-like, flexible.
2. **Trophy Run** — emphasizes the source material, but may imply the player is drafting a trophy deck themselves.
3. **Ten Picks** — maximally clear, less ownable as a mode name.
4. **Draft Gauntlet** — communicates a sequence of tests, slightly more competitive/serious.
5. **Pick Run** — short and game-like, but less immediately descriptive than Draft Run.

Use **Draft Run** as the implementation name until product naming changes.