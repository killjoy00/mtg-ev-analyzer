# Pack One

[Play Pack One](https://packone.pro): eight decisions from real trophy drafts. Choose a card, then see the trophy drafter's pick and model-supported alternatives.

The homepage starts with **Daily Draft Run**, **Daily Powered Cube** and **Daily Latest Set**. Each is a separate universal, fixed challenge per Eastern date, with no rerolls. The latest-set game uses only the newest Live released set. All support anonymous play and sharing. A signed player linked to an account before starting is ranked; guest starts remain unranked after later sign-in. A valid account session adds unlimited regular practice. Elite members can choose sets for balanced random practice from the homepage.

**100 means you matched the trophy drafter. Other choices earn up to 95 based on model support.** The model is the partial-credit engine.

## Read first

- [Current implementation and deployment state](docs/CURRENT-STATE.md)
- [Product contract](docs/CHARTER.md)
- [Corpus and selection](docs/DATA-MANAGEMENT.md), [Corpus Operations](docs/CORPUS-OPERATIONS.md)
- [Scoring](docs/SCORING-AND-DIFFICULTY.md), [Traditional research](results/rebuild-2026-09-18/TRADITIONAL-RESULTS.md)
- [17Lands attribution review](docs/17LANDS-DATA-REVIEW-2026-09-18.md)

## Architecture and development

GitHub Pages serves the browser. Three Neon Functions own the historical API, accounts/admin, and Draft Run API. Neon Postgres stores immutable puzzles, versioned schedules, sessions, results, corpus manifests, lifecycle policy and account capabilities. Existing decision measurements remain at `/admin/`; Corpus Operations is a separate area.

Run `npm test` for syntax, JavaScript and Python checks. Pull requests also run browser coverage; backend changes run SQL tests on disposable Neon branches. Deploy reviewed main revisions to development, verify the complete corpus and gameplay, then promote the same revision to production. A Pages deployment alone does not deploy backend code.

Older modes have no current launch/navigation surface. Readers, data and compatibility remain where needed for old results and published links.

Public 17Lands archives are used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Pack One transforms them into puzzles, statistics and model evidence. [Source and license](https://www.17lands.com/public_datasets). Card metadata/images come from Scryfall; card intellectual property belongs to its respective rights holders. No endorsement is implied.
