# Pack One

[Play Pack One](https://packone.pro): eight decisions from real trophy drafts. Choose a card, then see the trophy drafter's pick and model-supported alternatives.

The homepage starts with **Daily Draft Run**, **Daily Powered Cube** and **Daily Latest Set**. Each is a separate universal, fixed challenge per Pacific date, with no rerolls. The latest-set game uses only the newest Live released set. All support anonymous play and sharing. A signed player linked to an account before starting is ranked immediately only when that player owns a unique username. A linked account whose current nickname is already owned stays linked but remains unranked until it chooses a free username; Pack One warns before the Daily and keeps the recovery action visible in My Pack One. A guest who completes a fixed Daily can explicitly sign in/link on that same Pacific game date to validate that completed first attempt and make it leaderboard-eligible; if username ownership blocks validation, the pending validation can complete after a unique username is saved. The run must belong to the resolved player, the account identity must still be attachable, the run must be complete and still unranked, and there must not already be a score for that player/date/environment. A valid account session adds unlimited regular practice. Elite members can choose sets for balanced random practice from the dedicated Practice hub. Competitive leaderboards use **Today**, **This week**, **This season** and **All time**. Seasons advance from immutable Latest Set Daily history and never roll backward during a temporary fallback to an older set; legacy `month` board links canonicalize to the current season. My Pack One and public profiles show current-season standings when the player has season results.

**100 means you matched the trophy drafter. Other choices earn up to 95 based on model support.** The model is the partial-credit engine.

## Read first

- [Current implementation and deployment state](docs/CURRENT-STATE.md)
- [Campaign Links owner guide](docs/CAMPAIGN-LINKS-OWNER-GUIDE.md)
- [Username identity, recovery and admin monitoring](docs/USERNAME-IDENTITY.md)
- [Product contract](docs/CHARTER.md)
- [Corpus and selection](docs/DATA-MANAGEMENT.md), [Corpus Operations](docs/CORPUS-OPERATIONS.md)
- [Scoring](docs/SCORING-AND-DIFFICULTY.md), [Traditional research](results/rebuild-2026-09-18/TRADITIONAL-RESULTS.md)
- [17Lands attribution review](docs/17LANDS-DATA-REVIEW-2026-09-18.md)

## Architecture and development

GitHub Pages serves the browser. Three Neon Functions own the historical API, accounts/admin, and Draft Run API. Neon Postgres stores immutable puzzles, versioned schedules, sessions, results, corpus manifests, lifecycle policy and account capabilities. Recurring Daily pre-generation and account-deletion maintenance are owned by reviewed Neon Function Triggers; the corresponding GitHub workflows are manual recovery/verification only. See [Neon scheduled maintenance](docs/NEON-SCHEDULERS.md). Existing decision measurements remain at `/admin/`; Corpus Operations is a separate area. Campaign link construction and validation is available at `/admin/?area=campaign-links`; static `/go/<slug>/` routes are published from the reviewed `campaign-links.json` registry and generated pages.

Run `npm test` for syntax, JavaScript and Python checks. Pull requests also run browser coverage; backend changes run SQL tests on disposable Neon branches. The two required merge checks stay present on every PR, with a narrow native-mobile fast path and automatic reruns when a stacked PR is retargeted to `main`; see [CI and merging](docs/CI-AND-MERGING.md). Deploy reviewed main revisions to development, verify the complete corpus and gameplay, then promote the same revision to production. A Pages deployment alone does not deploy backend code.

Older modes have no current launch/navigation surface. Readers, data and compatibility remain where needed for old results and published links.

Public 17Lands archives are used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Pack One transforms them into puzzles, statistics and model evidence. [Source and license](https://www.17lands.com/public_datasets). Card metadata/images come from Scryfall; card intellectual property belongs to its respective rights holders. No endorsement is implied.
