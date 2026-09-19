# Pack One product contract

Authoritative rebuild contract, 2026-09-18. Deployment evidence is separate in [CURRENT-STATE](CURRENT-STATE.md).

## One game, two environments

A Draft Run contains exactly eight independent decisions from distinct, qualified trophy source drafts. Each shows the real pack and the drafter's earlier pool. The player's earlier answers do not modify subsequent historical states. Regular Draft Run and Powered Cube are separate environments.

The homepage presents Daily Draft Run and Daily Powered Cube immediately. After one is completed, its result is compact and the other remains the strongest action. After both, results remain visible and applicable practice becomes prominent. There is no checklist layer or wall of practice options.

## Daily access and comparison

Both Dailies are free once per Eastern date. Browser/device identity provides best-effort anonymous enforcement. Managed authentication and database uniqueness provide authoritative account enforcement across devices. A started attempt resumes. Guests can complete, score and share, but do not become durable identified leaderboard entries. Signing in later does not retroactively make a guest Daily ranked.

A Daily schedule is universal and immutable after generation, including puzzle IDs, corpus/scoring/selection/difficulty versions. Its corpus pins the model. Neither Daily permits rerolls. Later corpus lifecycle changes affect only newly generated schedules and sessions. An already-generated historical schedule retains its original shape for everyone joining that day.

Daily sharing publishes a score and the universal Daily entry link; it never creates a private match or changes eligibility. Practice sharing means **share this run and compare**: a stable run identity supplies the exact same eight decisions. Shared recipients cannot reroll them. Historical published links remain readable.

## Sources and selection

Regular decisions use P1P1 through P1P8, one per round. Powered Cube's archive omits complete P1P1, so its eight complete decisions use P1P2 through P1P9, with true numbering and the inherited first card visible. Never invent a missing opening pack.

Regular Daily composition uses only released, Live eligible regular sets, ordered by metadata release date: two decisions from the newest set; four sampled with replacement from its three immediate predecessors; two further draws from all eligible regular sets. Both weighted pools use `2 ** (-rank / 4)`, with rank zero at the newest member of that pool. The predecessor weights are approximately 1, 0.841 and 0.707. Optional full-corpus weight halves every four releases. This guarantees at least six of eight decisions from the newest four, keeps older sets possible, and does not force a pick from each predecessor. Every source must differ and satisfy usability, pick-window and difficulty gates. New selection also requires the trophy pick’s implied model score, `round(95 × raw trophy support / strongest raw support)`, to be at least 20. This eligibility filter never changes the 100-point trophy award or an existing fixed game. [Distribution simulation](../results/rebuild-2026-09-18/DAILY-DISTRIBUTION.md).

The full historical corpus is retained. Lifecycle controls new-play eligibility, not existence of historical evidence. Existing fingerprint exclusions remain compatibility constraints, not authorization for additional deletion.

Premier trophies include **7-0, 7-1 and 7-2**. Retain the experienced/high-quality drafter standard: at least 100 prior games and the existing per-set qualified cohort. Legacy archives without win-rate fields retain their documented independently observed rank cohort. The broader qualified cohort trains the production model; puzzle sources are trophies and cannot train their own held-out grader.

Traditional 3-0 first-eight research is separate from production. Pooling model evidence and publishing playable Traditional puzzles are distinct decisions. [Experiment and limitations](../results/rebuild-2026-09-18/TRADITIONAL-RESULTS.md).

## Scoring

An exact historical trophy match always earns **100**, even when the model disagrees. All other choices receive at most 95, approximately `95 × f(selected raw model support / strongest raw model support)`. A model-preferred alternative can earn 95 while the trophy pick earns 100. Probability calibration and partial-credit calibration are separate. The run score is the rounded mean of its eight pick scores. Historical results retain their recorded version and denominator.

## Practice and capabilities

Anonymous users receive the two Dailies. A free authenticated account adds `unlimited_regular_practice`. Future grants may add `unlimited_cube_practice` and `custom_corpus`; provider names and tiers do not belong in core product logic. Backend identity and entitlement state are authoritative. The provider adapter exists; no Patreon integration or payment UI is active.

Custom practice accepts one or more Live eligible regular sets, assigning eight decisions as evenly as possible: 8; 4/4; 3/3/2; 2/2/2/2. Corpus size does not weight this allocation. Non-Daily unshared practice can retain matched rerolls.

## Corpus operations

The authenticated admin measurement console remains intact. Its separate Corpus area shows inventory, manifests/versions, freshness, counts, exclusions, pick coverage, metadata/images, model/support checks, gates, serving state and audit history where available. Unknown data remains visibly unknown.

States are Candidate, Live, Paused and Retired. Discovery and unfinished imports remain non-serving operational records. A newly ingested set becomes Candidate only after objective quality gates pass. Authenticated admins explicitly publish Live; every transition records actor, timestamp, old/new state and optional reason. Activation requires fresh passing checks. Publication never follows solely from archive availability. [Operations and thresholds](CORPUS-OPERATIONS.md).

## Presentation and provenance

Mobile-first play, recognizable prior cards at approximately 85% of pack-card width, quick first-pack access, explicit trophy/model distinction and accessible feedback are core requirements. Attribution links to 17Lands and the source license and explains the adaptation without implying endorsement. [Policy review](17LANDS-DATA-REVIEW-2026-09-18.md).

Retired opening-pack products and the former task-board homepage have no current navigation, marketing or normal gameplay role. Compatibility code is isolated for historical links. This game does not simulate a draft table, alternate wheel contents or a constructed deck.
