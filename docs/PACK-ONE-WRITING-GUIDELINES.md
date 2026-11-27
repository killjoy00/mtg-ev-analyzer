# Pack One writing guidelines

Applies to player-facing web and app copy, Learn, editorial articles, emails, notifications and marketing. Write like a Magic drafter talking to another Magic drafter.

## Voice

- Use everyday language. Say "picks", "stats", "earlier picks", and "practice"; avoid "decisions", "career details", "prior draft context", and similar internal terms when ordinary words work.
- Lead with what the player can do or what happened. Buttons name the actual action: "Challenge a friend", "Start practice", "View your stats".
- Keep text short, specific, and conversational. Use contractions. Do not add filler, generic AI-style introductions, forced conclusions, or repeat information already visible. Remove needless instructions rather than rewriting them.
- Say what a number means. Use "You matched 5 of 8 trophy picks" (with the actual count and run length), not "5 trophy picks matched".
- Errors explain what failed and give a practical next action. Keep legitimate access, privacy, accessibility, timing and scoring qualifications.

## Avoid AI-style and internal product language

- Write as a Magic player, not as a product or marketing team. Use the simplest accurate wording: "picks", "stats", "earlier picks", "choose your sets", "saved progress", "membership".
- Use plain headings ("Practice", "Membership", "Your stats") instead of repeated rhetorical questions. Keep a question when it genuinely invites a player to make a pick.
- Delete filler such as "unlock your potential", "elevate your experience", "seamless", "tailored experience", "dive into", and "take your drafting to the next level". Do not replace these with vague synonyms.
- Never expose backend terminology in the UI. Avoid "failed lookup", "current signed-in account", "refresh access", "account capabilities", "custom corpus", "account-linked progress", "cross-device continuity", "expanded practice options", and "provider state" in player-facing copy. Technical docs and required legal disclosures are exempt.
- Prefer "picks" to "drafting decisions", "saved across devices" to "cross-device continuity", and "join the leaderboard" to "leaderboard participation".
- State the action or outcome: "Checking your membership…", "Your run is saved", "Try again". Avoid narrating requests, lookups, recovery machinery or permissions. Distinguish a loading/error state from confirmed loss of membership.
- Keep copy consistent across the three Dailies, regular practice, web, iOS and Android unless actual behavior differs. Don't change the rules or remove important qualifications just to shorten text.
- Review nearby and equivalent strings whenever fixing a wording problem, including conditional/empty/error states, accessibility labels and related tests. Review all new player-facing strings in every PR; prefer deletion over needless paraphrasing.

## Scoring and the model

- Do not use "based on the model" as a stand-alone explanation. Explain what it estimates: how likely drafters are to pick a card in that pack and draft context. The model learns from real drafting behavior.
- Use the word "model" when it clarifies methodology or uncertainty. Avoid anthropomorphism ("the model likes" or "dislikes" a card); use "rates", "estimates" or "ranks" when appropriate.
- Model estimates are not observed player percentages, calibrated probabilities of correctness, card win rates, or guarantees of a trophy. Do not claim partial credit measures winning or skill. Neither the model nor the trophy drafter is right every time.
- Preserve the scoring rules: a trophy match earns 100; other picks earn up to 95 according to the model's relative estimate; the final score is the average of the picks. Do not imply that scores are a raw pick rate.
- Approved result copy (use the actual run length): "Your final score is the average of your 8 picks. Match the trophy drafter for 100 points. Other picks earn up to 95 points, depending on how likely drafters are to take that card."
- On the detailed scoring page, explain that these are estimates and retain the qualifications and examples. Don't reproduce a full technical explanation on every result. For the short reveal, use: “The trophy pick earns 100 points. Other picks can earn up to 95.” Label normalized estimates “Model rating” and explain that the top pick is 100%, other cards are rated against it, and these are not win rates.

## Before merging

1. Read the copy aloud in the screen or message where it appears. Does it sound like something a player would say? Is every sentence useful and accurate?
2. Check matching web and native surfaces, including results, help, empty states, errors and accessibility text. Maintain consistency unless platform behavior genuinely differs.
3. Retain feature and scoring semantics, and update any exact-text tests/selectors and generated content at the source. Don't weaken behavior tests to make a copy change pass.
4. Review new or changed language against this guide. Prefer fixing the source over adding more explanatory text.
