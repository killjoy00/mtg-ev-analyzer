# Morning featured pick: yesterday's debate

Status: implemented as a separate **featured** job in `.github/workflows/daily-social-post.yml`. The existing Daily announcement and the existing real-browser 10-second YouTube Short are preserved. Do not claim this job is in production until the PR is merged and a scheduled live run has been verified.

## Schedule and daily decision

The existing independently scheduled Neon dispatch at **07:10, 07:20, and 07:40 America/Los_Angeles**, with GitHub cron fallback, invokes the same workflow. The new job reads the **previous completed Pacific day** from the production Neon database, independently of the current day's Daily. All three environments' eight scheduled puzzles (24 total) are eligible.

Votes use each distinct player's **first committed pick** for that Daily environment/puzzle, with linked accounts deduplicated via `COALESCE(s.daily_account_id::text,s.player_id::text)` and `measurement_qa` excluded. The query uses the immutable scheduled puzzle IDs and the verified corpus payload. A puzzle must have at least **30 real distinct players**, a real trophy choice, and verified Scryfall image URLs for the selected cards.

Selection is tiered:

1. A **three-way split** qualifies if third choice >=15%, second >=20%, top choice <=60%, and top three collectively >=75%.
2. Otherwise a **two-way split** qualifies if second choice >=18%, top choice <=75%, and top two collectively >=65%.
3. Three-way takes precedence over two-way **across all environments**. Within each tier, Latest Set takes precedence over Mixed/Powered Cube. Remaining candidates rank on closeness, trophy surprise, sample size, and deterministic ties.
4. If no pick qualifies, **skip the featured post** rather than invent debate or post a tiny sample.

Three-way examples: Latest Set 42/34/16 beats Powered Cube 42/33/23 because of the explicit Latest Set preference. If Latest Set has only a two-way split, a qualifying Powered Cube three-way wins. For two-way-only days, Latest Set wins.

The featured source day is retained in `artifacts/featured-pick/pick.json` for reproducibility. The Instagram-style cover is a 1200x630 JPG built from real Scryfall art, and the silent 1080x1920 MP4 is a 20-second storyboard showing the prior picks, options, player split, trophy reveal and Pack One CTA. A human-readable `patreon.md` is also generated. All outputs appear in a private-by-default Actions artifact with seven-day retention; do not publish raw player measurements.

## Destinations

- **Bluesky**: Uses existing `PACKONE_BLUESKY_HANDLE` and `PACKONE_BLUESKY_APP_PASSWORD` secrets. Separate deterministic ATProto TID and copy, so it never replaces or collides with the standard morning Daily post. The attached graphic reflects the real recorded votes.
- **Discord**: Uses the existing opt-in `PACKONE_DISCORD_WEBHOOK_URLS` secret. A server must explicitly provide its webhook privately; an empty list means Discord is skipped. A separate SHA-256-derived receipt per webhook/date prevents duplicates. Do not paste private webhook URLs into repo files or issues.
- **YouTube**: Reuses existing `PACKONE_YOUTUBE_CLIENT_ID`, `PACKONE_YOUTUBE_CLIENT_SECRET`, `PACKONE_YOUTUBE_REFRESH_TOKEN`. A distinct featured-YouTube receipt per source day prevents duplicate uploads. `PACKONE_YOUTUBE_UPLOAD_PAUSED=true` pauses both normal and featured videos; `PACKONE_FEATURED_YOUTUBE_PAUSED=true` pauses only the featured upload. YouTube controls public/private visibility independently; verify returned visibility in the job log.
- **Patreon**: **Draft-only.** Patreon public API v2 supports reading posts but not creating them. The workflow generates a complete ready-to-publish `patreon.md` each eligible morning, but **does not** claim to publish to Patreon. Publish through the Patreon creator interface or a separately authorized computer-use workflow. Never use unsupported private/undocumented APIs.

The previous day's individual pick does not currently have a dedicated public permalink; the CTA points to today's Daily with `utm_campaign=featured_pick`. Don't pretend clicking the CTA opens yesterday's decision.

## Operations and failure behavior

- The current Daily announcement remains unchanged. The new featured job is isolated, with its own rendering, posting, and receipts.
- Manual `workflow_dispatch live=false` never publishes. `live=true` on reviewed main explicitly runs the featured pipeline alongside the standard Daily; retries are deduplicated.
- The publisher verifies current main's SHA and rejects old job re-runs. It validates Neon source day, checks the source is yesterday, requires real image decode, and never posts a fabricated/low-sample split.
- Published destinations use issue #1135 for nonsecret `posted/claimed/failed` receipts. A timeout leaves the channel **claimed** to avoid duplicate writes. Operators must reconcile by checking the destination and ledger before retrying; never blindly rerun a previous job attempt.
- Credentials are consumed only in GitHub Actions; the Neon database connection is obtained via the existing Actions `NEON_API_KEY` secret for read-only aggregate querying and is never printed or written to artifacts.
- Failure of a destination causes a nonzero job exit. Other successfully published destinations retain their receipts, so the next morning retry cannot double-post.
- If media rendering fails, the featured job fails closed before publication (no fake card art). The existing standard Daily social job is independent and continues to run.
- Tests: `node --test tests/featured-pick.test.mjs`. Preview a new feature after merging with Actions artifacts; verify actual Bluesky, YouTube and configured Discord receipts rather than assuming a dispatched job equals successful delivery.
