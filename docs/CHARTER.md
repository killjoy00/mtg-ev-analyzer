# Pack One product contract

Authoritative rebuild contract, 2026-09-18. Deployment evidence is separate in [CURRENT-STATE](CURRENT-STATE.md).

## One game, three Dailies

A Draft Run contains exactly eight independent decisions from distinct, qualified trophy source drafts. Each shows the real pack and the drafter's earlier pool. The player's earlier answers do not modify subsequent historical states. Regular Draft Run and Powered Cube are separate environments.

The homepage presents Daily Draft Run, Daily Powered Cube and Daily Latest Set immediately. Completed results become compact and unfinished Dailies stay first. After all three, signed-in players receive one prominent handoff to the dedicated Practice hub. Practice and Elite options are not duplicated below unfinished Dailies; signed-in navigation keeps Practice available throughout.

## Daily access and comparison

All three Dailies are free once per Pacific date. Browser/device identity provides best-effort anonymous enforcement. Managed authentication and database uniqueness provide authoritative account enforcement across devices. A started attempt resumes. Guests can complete, score and share while anonymous. On the same Pacific game date, a guest may explicitly sign in or link the completed first attempt to an account and validate it for the leaderboard, provided the username is owned and that account does not already have a ranked score for that Daily environment/date. A signed player already linked to an account is ranked at first Daily creation even if its active Auth header is missing. Account operations and practice still require a valid Auth session. Completed guest runs are not retroactively ranked after that Daily date. Before the first pick, the run explicitly shows the ranked name or guest warning.

A Daily schedule is universal and immutable after generation, including puzzle IDs, corpus/scoring/selection/difficulty versions. Its corpus pins the model. No Daily permits rerolls. Later corpus lifecycle changes affect only newly generated schedules and sessions. An already-generated historical schedule retains its original shape for everyone joining that day.

Daily sharing publishes a score and the universal Daily entry link; after all three Dailies are complete, the Daily home may also share the three aggregate scores with the universal Pack One home link. Neither form creates a private match or changes eligibility. Practice sharing means **share this run and compare**: a stable run identity supplies the exact same eight decisions. Shared recipients cannot reroll them. If the share creator reopens their own practice link, Pack One recovers the creator's original authoritative run/result; it does not create a second challenge session, compare the player against themself, or count a self-result in challenge history. Historical published links remain readable.

## Sources and selection

Regular decisions use P1P1 through P1P8, one per round. Powered Cube's archive omits complete P1P1, so its eight complete decisions use P1P2 through P1P9, with true numbering and the inherited first card visible. Never invent a missing opening pack.

Regular Daily composition uses only released, Live eligible regular sets, ordered by metadata release date: two decisions from the newest set; four sampled with replacement from its three immediate predecessors; two further draws from all eligible regular sets. Both weighted pools use `2 ** (-rank / 4)`, with rank zero at the newest member of that pool. The predecessor weights are approximately 1, 0.841 and 0.707. Optional full-corpus weight halves every four releases. This guarantees at least six of eight decisions from the newest four, keeps older sets possible, and does not force a pick from each predecessor. Every source must differ and satisfy usability, pick-window and difficulty gates. New selection also requires the trophy pick’s implied model score, `round(95 × raw trophy support / strongest raw support)`, to be at least 20. This eligibility filter never changes the 100-point trophy award or an existing fixed game. [Distribution simulation](../results/rebuild-2026-09-18/DAILY-DISTRIBUTION.md).

Daily Latest Set has a separate immutable schedule and leaderboard under `latest`. It uses eight independent P1P1–P1P8 decisions exclusively from the newest released Live regular set, ordered by release metadata. If that set cannot meet selection gates, the Daily is unavailable; it never silently mixes or substitutes older sets. Pack One competitive seasons advance when a newer regular set first appears in this immutable Latest Set Daily. Temporary fallback to an older set does not roll the competitive season backward; season boundaries follow the Pack One Daily calendar rather than the official Magic release date.

The full historical corpus is retained. Lifecycle controls new-play eligibility, not existence of historical evidence. Existing fingerprint exclusions remain compatibility constraints, not authorization for additional deletion.

Premier trophies include **7-0, 7-1 and 7-2**. Retain the experienced/high-quality drafter standard: at least 100 prior games and the existing per-set qualified cohort. Legacy archives without win-rate fields retain their documented independently observed rank cohort. The broader qualified cohort trains the production model; puzzle sources are trophies. Strict exclusion of a source from its own grader remains a requirement. The September 19 audit found indirect held-fold influence in the production stage reference; [issue #164](https://github.com/killjoy00/mtg-ev-analyzer/issues/164) requires a versioned correction and assessment before the next model release. Do not present current direct-count exclusion as complete isolation or silently rewrite the frozen corpus.

Qualified Traditional 3-0 trophy drafts may contribute playable decisions only after source-specific evidence, staging and explicit publication pass. The production scoring model remains Premier-trained. Pooling model evidence and publishing playable Traditional puzzles are distinct decisions. [Experiment and limitations](../results/rebuild-2026-09-18/TRADITIONAL-RESULTS.md).

## Scoring

An exact historical trophy match always earns **100**, even when the model disagrees. All other choices receive at most 95, approximately `95 × f(selected raw model support / strongest raw model support)`. A model-preferred alternative can earn 95 while the trophy pick earns 100. Probability calibration and partial-credit calibration are separate. The run score is the rounded mean of its eight pick scores. Historical results retain their recorded version and denominator.

## Practice and capabilities

Anonymous users receive all three Dailies. A free authenticated account adds `unlimited_regular_practice`. Elite grants add `unlimited_cube_practice` and `custom_corpus`; provider names and tiers do not belong in core product logic. Backend identity and entitlement state are authoritative. Public Patreon linking is active with exact campaign and tier matching: Supporter is $3 and Elite is $7, but entitlements are derived from campaign, tier and state IDs rather than price. Supporter grants no premium practice capabilities. Qualifying Supporter and Elite memberships are ad-free while signed in and connected, including still-entitled former patrons, free trials and gifts; declined/refunded/fraud/deleted states are not. Signed-out members are guests for advertising purposes. One Daily-home-only monetization slot is wired outside gameplay. While Google delivery remains disabled pending approval, consent/privacy work and owner authorization, that slot shows the TCGplayer affiliate fallback to advertising-eligible visitors; qualifying ad-free memberships suppress it too, and Google activation replaces rather than stacks with the affiliate promotion. Real OAuth, reconnect, paid practice and authoritative API sync are verified; actual billing transitions and signed webhook delivery remain separate acceptance observations.

Custom practice accepts one or more Live eligible regular sets, assigning eight decisions as evenly as possible: 8; 4/4; 3/3/2; 2/2/2/2. Corpus size does not weight this allocation. Non-Daily unshared practice can retain matched rerolls.

## Corpus operations

The authenticated admin measurement console remains intact. Its separate Corpus area shows inventory, manifests/versions, freshness, counts, exclusions, pick coverage, metadata/images, model/support checks, gates, serving state and audit history where available. Unknown data remains visibly unknown.

States are Candidate, Live, Paused and Retired. Discovery and unfinished imports remain non-serving operational records. A newly ingested set becomes Candidate only after objective quality gates pass. Authenticated admins explicitly publish Live; every transition records actor, timestamp, old/new state and optional reason. Activation requires fresh passing checks. Publication never follows solely from archive availability. [Operations and thresholds](CORPUS-OPERATIONS.md).

## Presentation and provenance

Mobile-first play, recognizable prior cards at approximately 85% of pack-card width, quick first-pack access, explicit trophy/model distinction and accessible feedback are core requirements. Attribution links to 17Lands and the source license and explains the adaptation without implying endorsement. [Policy review](17LANDS-DATA-REVIEW-2026-09-18.md).

Retired opening-pack products and the former task-board homepage have no current navigation, marketing or normal gameplay role. Compatibility code is isolated for historical links. This game does not simulate a draft table, alternate wheel contents or a constructed deck.
