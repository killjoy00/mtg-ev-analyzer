# Pack One Weekly and Patreon editorial schedule

**One application only:** [Unified publisher contract](PACK-ONE-PATREON-PUBLISHER.md) supersedes the previous split Windows setup. Both weekly formats run in one paired application. Season and Lab content must attach to the same publisher; no separate installer, pairing, process, or start-up entry.

## Approved cadence

- Pack One Weekly: Monday at 12:00 p.m. America/Chicago; previous completed Monday–Sunday Pacific game dates. First eligible recap: December 7, 2026 at noon Central, covering November 30–December 6 Pacific game dates. The November 30 edition is intentionally skipped without backfill for the Star Trek launch; the original named-results privacy cutoff is unchanged.
- Pick of the Week: Wednesday in the existing morning slot, 9 a.m. Central or later. Thursday is recovery only for the same immutable week, title, image and desktop journal. No automatic post on other days. A Wednesday attempt that may have queued or published is **not** safe to retry blindly; reconcile before retrying.
- Midseason Set Guide and Season Results & Awards: separate season-triggered automation, not shipped by this PR.
- Pack One Lab: proposed Friday publication, developed separately. New-set announcement, player interviews and product updates remain manual.

## Monday recap

The private collection module uses the existing weekly and season leaderboard scoring, first-attempt data, five ranks including ties, current publication-name eligibility and the global cutoff. It selects a meaningful Hardest Daily by comparing the lowest mean against that format's other six days (minimum 20 completed runs on each day, at least five points below the weighted rest-of-week mean). Easiest Pick is highest trophy-match rate from a qualifying scheduled pick (at least 50 distinct responses, full original pack and prior-pick art required). The output has the approved blue-highlighted winners, perfect Dailies, Hardest Daily comparison and leaderboard only, Easiest Pick friendly copy and trophy attribution, season boards without dates or commentary, and prominent packone.pro with unmodified official Apple and Google badges.

The renderer builds a historical component reconstruction with the repo's production styles, canonical brand assets and real source card art, captures private PNG buffers in memory, and validates fonts/images. It is not a capture of a live ranked run. No named outputs are ever written to public Actions artifacts or the public Patreon feed.

**Paired publisher architecture:** The existing Pack One growth backend generates the weekly article data and owns the publication receipt, clock, owner authorization, consent checks and official Patreon read API. The owner creates a revocable one-time pairing code in [Admin → Patreon](https://packone.pro/admin/?area=patreon); the server stores only its hash, tied to a current owner. The paired desktop receives the presentation snapshot (only intended public names, scores and card art) and an authenticated encrypted short-lived snapshot ticket. Raw account IDs are never returned in readable form. The server binds the receipt to that ticket and the rendered image hash, admits the exact server-derived placements immediately before queueing, and checks the public Patreon resource again before recording publication. The existing pending-name deletion and removal protections remain. The desktop renders the approved snapshot locally and uses PostyBirb's existing authenticated publishing session. It cannot query the database, change scores, submit arbitrary publication placements or receive the creator's Patreon API token. Revocation blocks future requests but cannot recall an external handoff already made.

The current local PostyBirb protocol supports one verified JPEG. The private runner uses the full approved scorecard composite rendered at 480 CSS pixels (960 image pixels), rejects horizontal overflow, records actual dimensions, and the caption contains ordinary clickable website and store destinations. The individual PNG panels remain available in memory for an eventual richer provider-supported layout. The store-badge artwork is not altered. A real signed-out Patreon rendering must prove that the tall composite is readable at mobile width; if the provider resizes/crops it unacceptably, do not claim visual acceptance. The historical pack is reconstructed with production CSS and verified source art, not a captured live ranked session.

### Remaining release gates

1. Review exact-head tests for owner pairing/revocation, gateway bearer isolation, encrypted ticket and receipt binding, real PostgreSQL privacy/removal contracts, browser rendering, and the Windows executable. No named production data in public CI.
2. Release migrations 0081 and 0082 (skip already-applied migrations) through the existing guarded development-then-production secure-auth release after the previous release completes. The backend receives the existing protected creator read-only token only in production. Never deploy secrets to development or public artifacts. Do not create a database login for the desktop; the earlier scoped-grants proposal is retired.
3. After the **Pack One Patreon Publisher for Windows** unified main release is verified, close any old Pack One helper. Open [Admin → Patreon](https://packone.pro/admin/?area=patreon), download the single reviewed unified ZIP, extract it and open PackOnePatreonPublisher.exe. Reuse the saved pairing or confirm the original notice commitment and generate one code. Check connection and enable automatic posting once. Both weekly article types use the same application, encrypted pairing, serial queue and Windows sign-in entry. Existing pick receipts are retained; old helper automatic startup is removed on takeover. Keep the PC, this one publisher and PostyBirb running.
4. On December 7 at or after noon Central, verify the first actual public post, including readable leaderboard clips, real historical pack art and working links. A reconstructed historical game panel is not a live ranked screenshot. If the provider blocks verification or crops the image, leave the receipt in review and reconcile without retrying an ambiguous submission. Never backdate or publish before the privacy cutoff.

**Release status:** paired backend and migrations 0081/0082 were deployed successfully via #1802. The unified replacement package needs exact-head CI, reviewed main release and owner-local activation. Both previously released standalone helpers are superseded; do not install them. No database role needs to be provisioned. Actual new-format public rendering and delivery remain unverified.

## Weekly disagreement cutover

The standalone `patreon-desktop-feed.yml` workflow schedules only Wednesday and Thursday. It has no write path on PRs. It uses existing aggregate selection gates, picks from all seven prior-week dates, renders one cover and freezes the exact public-only feed record by the Wednesday date. Each subsequent check uses that immutable record and the official read-only Patreon exact-title lookup. A Thursday check never changes the post title, media or journal key. The desktop bridge understands the new version-2 manifest and rejects it outside the Wednesday/Thursday window. The legacy daily Patreon feed and scheduled cloud publishing jobs are removed from the daily social workflow. Other channels' jobs are unchanged.

The unified Windows publisher uses the existing PostyBirb session and the original pick journal on one device. It accepts only version-2 weekly manifests, and it takes the legacy helper's process lock. It retires legacy automatic startup upon activation; do not run the old helper beside it. The cloud writer remains paused; don't trigger the legacy one-off canary while the desktop writer is active. API errors, unverified public claims, ambiguous queue states and missing artwork fail closed. If the frozen Wednesday path already contains an incompatible legacy daily feed during a cutover, stop and reconcile; never overwrite an earlier post.

The repository's existing provider-verification blocker still applies. A prepared feed, successful test run or merged code is not proof that a public Patreon post was published.

## Verification

`node --test tests/pack-one-weekly.test.mjs tests/patreon-desktop-feed.test.mjs tests/featured-patreon.test.mjs tests/admin-patreon-publishing.test.mjs`

`python -m unittest discover -s tests -p test_patreon_desktop.py -v`

PR tests use synthetic fixtures and no named production data. Before activation verify the actual historical screenshot layout, private runtime and publication verification; do not publish any named recap before the privacy gate.
