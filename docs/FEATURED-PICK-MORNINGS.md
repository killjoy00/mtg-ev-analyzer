# Morning featured pick: yesterday's debate

Status: implemented as a separate **featured** job in `.github/workflows/daily-social-post.yml`. The existing Daily announcement and the existing real-browser 10-second YouTube Short are preserved. Do not claim this job is in production until the PR is merged and a scheduled live run has been verified.

## Schedule and daily decision

The existing independently scheduled Neon dispatch at **07:10, 07:20, and 07:40 America/Los_Angeles**, with GitHub cron fallback, invokes the same workflow. The new job reads the **previous completed Pacific day** from the production Neon database, independently of the current day's Daily. All three environments' eight scheduled puzzles (24 total) are eligible.

Votes use each distinct player's **first committed pick** for that Daily environment/puzzle, with linked accounts deduplicated via `COALESCE(s.daily_account_id::text,s.player_id::text)` and `measurement_qa` excluded. The query uses the immutable scheduled puzzle IDs and the verified corpus payload. A puzzle must have at least **30 real distinct players**, a real trophy choice, and verified Scryfall image URLs for the selected cards.

Selection is tiered:

1. A **three-way split** qualifies if third choice >=15%, second >=20%, top choice <=60%, and top three collectively >=75%.
2. Otherwise a **two-way split** qualifies if second choice >=18%, top choice <=75%, and top two collectively >=65%.
3. **Hard display-integrity rule**: the original trophy-drafter card **must be inside the displayed top-three or top-two options**. Otherwise reject the whole puzzle. A fourth-card reveal is never permitted.
4. Three-way takes precedence over two-way **across all environments**. Within each tier, Latest Set takes precedence over Mixed/Powered Cube. Remaining candidates rank on closeness, trophy surprise, sample size, and deterministic ties.
5. If no pick qualifies, **skip the featured post** rather than invent debate or post a tiny sample.

Three-way examples: Latest Set 42/34/16 beats Powered Cube 42/33/23 because of the explicit Latest Set preference. If Latest Set has only a two-way split, a qualifying Powered Cube three-way wins. For two-way-only days, Latest Set wins.

The featured source day is retained in `artifacts/featured-pick/pick.json` for reproducibility. The Instagram-style cover is a 1200x630 JPG built from real Scryfall art, and the **original-scored** 1080x1920 MP4 is a 20-second storyboard showing the prior picks, options, player split, trophy reveal and Pack One CTA. A human-readable `patreon.md` is also generated. The Short includes a quiet original synthesized soundtrack (no third-party tracks or samples): warm chords, an arpeggio, gentle scene cues, and a small trophy-reveal flourish. FFmpeg must verify an AAC audio stream before upload; the upload path also rejects an audio-less render. All outputs appear in a private-by-default Actions artifact with seven-day retention; do not publish raw player measurements.

## Destinations

- **Bluesky**: Uses existing `PACKONE_BLUESKY_HANDLE` and `PACKONE_BLUESKY_APP_PASSWORD` secrets. Separate deterministic ATProto TID and copy, so it never replaces or collides with the standard morning Daily post. The attached graphic reflects the real recorded votes.
- **Discord**: Uses the existing opt-in `PACKONE_DISCORD_WEBHOOK_URLS` secret. A server must explicitly provide its webhook privately; an empty list means Discord is skipped. A separate SHA-256-derived receipt per webhook/date prevents duplicates. Do not paste private webhook URLs into repo files or issues.
- **YouTube**: Reuses existing `PACKONE_YOUTUBE_CLIENT_ID`, `PACKONE_YOUTUBE_CLIENT_SECRET`, `PACKONE_YOUTUBE_REFRESH_TOKEN`. A distinct featured-YouTube receipt per source day prevents duplicate uploads. `PACKONE_YOUTUBE_UPLOAD_PAUSED=true` pauses both normal and featured videos; `PACKONE_FEATURED_YOUTUBE_PAUSED=true` pauses only the featured upload. YouTube controls public/private visibility independently; verify returned visibility in the job log.
- **Patreon**: A separate **opt-in, $0 Playwright image/text publisher** is available (see [owner setup and safety](FEATURED-PATREON-AUTOPUBLISH.md)). Patreon’s official API cannot write posts; the publisher operates the normal authenticated creator editor, then checks the supported read-only posts API for the exact, **public** post. It reuses the existing `patreon.md` and `featured-cover.jpg` artifact, does not create audio posts, and is inert until `PACKONE_PATREON_AUTOPUBLISH_ENABLED=true` and a local creator browser session is installed as a GitHub secret. No automatic Patreon publication is established until an owner-authorized real canary succeeds. The existing artifact download remains useful for inspection and recovery.

The previous day's individual pick does not currently have a dedicated public permalink; the CTA points to today's Daily with `utm_campaign=featured_pick`. Don't pretend clicking the CTA opens yesterday's decision.

## Operations and failure behavior

- The current Daily announcement remains unchanged. The new featured job is isolated, with its own rendering, posting, and receipts.
- Manual `workflow_dispatch live=false` never publishes. `live=true` on reviewed main explicitly runs the featured pipeline alongside the standard Daily; retries are deduplicated.
- The publisher verifies current main's SHA and rejects old job re-runs. It validates Neon source day, checks the source is yesterday, requires real image decode, and never posts a fabricated/low-sample split.
- Published destinations use issue #1135 for nonsecret `posted/claimed/failed` receipts. A timeout leaves the channel **claimed** to avoid duplicate writes. Operators must reconcile by checking the destination and ledger before retrying; never blindly rerun a previous job attempt.
- Credentials are consumed only in GitHub Actions; the Neon database connection is obtained via the existing Actions `NEON_API_KEY` secret for read-only aggregate querying and is never printed or written to artifacts.
- Failure of a destination causes a nonzero job exit. Other successfully published destinations retain their receipts, so the next morning retry cannot double-post.
- If media rendering fails, the featured job fails closed before publication (no fake card art). The existing standard Daily social job is independent and continues to run.
- Tests: `node --test tests/featured-pick.test.mjs`. Preview a new feature after merging with Actions artifacts; verify actual Bluesky, YouTube, configured Discord, and (if activated) Patreon publication and receipts rather than assuming a dispatched job equals successful delivery.

## Corrective reissue on October 25, 2026

The initial October 25 featured pick was invalid: the Daily Latest Set P1P7 showed three choices but the trophy pick was a fourth card with 5.2% of votes. This implementation rejects that choice. The legitimate replacement is Draft Run P1P2 from the October 24 data, 284 players; Web Up 31.0%, Super Villain Lockup 29.9% (trophy), Thor Odinson 29.6%.

On the one-time guarded `push` event, the workflow regenerates media and publishes the corrected post. The Bluesky writer verifies and removes the exact known invalid deterministic record before reusing its record key. The corrected Discord message has a distinct receipt and acknowledges that the earlier message is invalid; its original message needs manual deletion because the old publisher did not retain Discord's message ID. The corrected YouTube video has a new receipt, and the publisher attempts removal of the known previous video. If the upload-only OAuth token lacks delete scope, the old video requires manual deletion through YouTube Studio; log the status plainly. Never change or delete ordinary Daily social posts.

## Featured Short soundtrack

`node scripts/render-featured-pick.mjs` synthesizes an original 20-second, 120-BPM instrumental bed in `scripts/featured-soundtrack.mjs`. It adds understated plucks/percussion and soft per-scene accent cues at 2, 5, 9, 13 and 17 seconds, plus a modest trophy reveal flourish. No samples, purchased tracks, voice cloning, or external music library is involved; original composition avoids Content ID disputes. The renderer encodes AAC and validates both H.264 video and AAC audio streams with `ffprobe` before writing the `render.json` manifest. The uploader requires the exact audio provenance marker. Source WAV and MP4 are included in the Actions artifact for owner listening/review. The standard 10-second Daily YouTube Short is unchanged.

Test with `node --test tests/featured-pick.test.mjs tests/featured-soundtrack.test.mjs` and inspect the PR preview's scored MP4 prior to merging. To avoid duplicate uploads, do not rerun the completed production job or change its YouTube receipt.
