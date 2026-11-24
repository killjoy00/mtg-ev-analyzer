# Pack One Weekly and Patreon editorial schedule

## Approved cadence

- Pack One Weekly: Monday at 12:00 p.m. America/Chicago; previous completed Monday–Sunday Pacific game dates. Initial target November 30, 2026.
- Pick of the Week: Wednesday in the existing morning slot, 9 a.m. Central or later. Thursday is recovery only for the same immutable week, title, image and desktop journal. No automatic post on other days. A Wednesday attempt that may have queued or published is **not** safe to retry blindly; reconcile before retrying.
- Midseason Set Guide and Season Results & Awards: separate season-triggered automation, not shipped by this PR.
- Pack One Lab: separate editorial work. New-set announcement, player interviews and product updates remain manual.

## Monday recap

The private collection module uses the existing weekly and season leaderboard scoring, first-attempt data, five ranks including ties, current publication-name eligibility and the global cutoff. It selects a meaningful Hardest Daily by comparing the lowest mean against that format's other six days (minimum 20 completed runs on each day, at least five points below the weighted rest-of-week mean). Easiest Pick is highest trophy-match rate from a qualifying scheduled pick (at least 50 distinct responses, full original pack and prior-pick art required). The output has the approved blue-highlighted winners, perfect Dailies, Hardest Daily comparison and leaderboard only, Easiest Pick friendly copy and trophy attribution, season boards without dates or commentary, and prominent packone.pro with unmodified official Apple and Google badges.

The renderer builds a historical component reconstruction with the repo's production styles, canonical brand assets and real source card art, captures private PNG buffers in memory, and validates fonts/images. It is not a capture of a live ranked run. No named outputs are ever written to public Actions artifacts or the public Patreon feed.

**Not operational yet:** this PR provides private data/calendar and layout/capture foundations. It does not establish a private named-results delivery service, persistent Monday publication ledger, scheduler invocation, or verified Patreon write path. Do not claim a live Monday schedule before these exist. A private runtime must recheck names and consent immediately before submission, verify publication, record each named placement and handle opt-out/deletion or ambiguous outcomes. Never route these names or captures through the public branch. No sample email or production data was committed.

## Weekly disagreement cutover

The standalone `patreon-desktop-feed.yml` workflow schedules only Wednesday and Thursday. It has no write path on PRs. It uses existing aggregate selection gates, picks from all seven prior-week dates, renders one cover and freezes the exact public-only feed record by the Wednesday date. Each subsequent check uses that immutable record and the official read-only Patreon exact-title lookup. A Thursday check never changes the post title, media or journal key. The desktop bridge understands the new version-2 manifest and rejects it outside the Wednesday/Thursday window. The legacy daily Patreon feed and scheduled cloud publishing jobs are removed from the daily social workflow. Other channels' jobs are unchanged.

The Windows helper must be updated from the reviewed main release and run with the existing PostyBirb session on one device. Old helpers reject the new version-2 manifest rather than publish incorrectly. The cloud writer remains paused; don't trigger the legacy one-off canary while the desktop writer is active. API errors, unverified public claims, ambiguous queue states and missing artwork fail closed. If the frozen Wednesday path already contains an incompatible legacy daily feed during a cutover, stop and reconcile; never overwrite an earlier post.

The repository's existing provider-verification blocker still applies. A prepared feed, successful test run or merged code is not proof that a public Patreon post was published.

## Verification

`node --test tests/pack-one-weekly.test.mjs tests/patreon-desktop-feed.test.mjs tests/featured-patreon.test.mjs tests/admin-patreon-publishing.test.mjs`

`python -m unittest discover -s tests -p test_patreon_desktop.py -v`

PR tests use synthetic fixtures and no named production data. Before activation verify the actual historical screenshot layout, private runtime and publication verification; do not publish any named recap before the privacy gate.
