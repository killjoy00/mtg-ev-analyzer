# Daily real-browser YouTube Short — owner guide

This is a **screen recording**, not an illustration, generated pack, or staged card image. The workflow opens the production `https://packone.pro` site as a new guest, validates today's actual Pacific-date main **Daily Draft Run**, loads and decodes **every real card image**, and records its homepage followed by the opening round. The 10-second output is a 1080 × 1920 MP4 assembled from two real browser video segments (1.6 seconds homepage, 8.4 seconds smoothly scrolling the first pack). It never clicks a card, locks a pick, completes a run, or reveals the trophy pick.

## Review a recording before publication

- Open [Record the real Pack One Daily Short](https://github.com/killjoy00/mtg-ev-analyzer/actions/workflows/daily-youtube-short.yml) in GitHub Actions.
- Run **workflow_dispatch** on `main` with **publish = false**, or open a PR changing the recording workflow. The PR event records a video but **never posts to YouTube**, and no credentials are exposed.
- Download the `packone-daily-short` artifact. It contains `packone-daily-YYYY-MM-DD-10s.mp4`, screenshots of the home and real card grid, and `capture.json` with date, first puzzle ID and card count. Retention is five days to minimize storage cost.
- A weekday schedule at **16:40 UTC** records one video daily: **8:40 AM Pacific Daylight Time / 9:40 AM Pacific Standard Time**, after the independent Daily reset and Bluesky workflow. A delayed/rerun schedule from a previous Pacific day exits without recording. The first pack is validated in the live run-start API, not inferred from local fixtures.
- If the live Daily, first pack or even one actual card image fails to load, **capture fails** rather than substituting placeholder/fake cards or uploading a broken Short. The video is silent (true site capture, no licensed background music).

## Connect YouTube (private owner step)

YouTube uploads are **disabled by default**. Review a captured MP4 and confirm the destination channel and your ability to upload a **private** test video before turning on scheduled publication.

1. In a Google Cloud project, enable **YouTube Data API v3**, configure the **OAuth consent screen**, and create an OAuth client. Grant `https://www.googleapis.com/auth/youtube.upload` through a one-time user consent flow for the **Pack One YouTube channel**. Use a production OAuth configuration as appropriate: a Google OAuth consent screen in `Testing` may issue short-lived refresh tokens.
2. Privately configure GitHub Actions secrets `PACKONE_YOUTUBE_CLIENT_ID`, `PACKONE_YOUTUBE_CLIENT_SECRET`, and `PACKONE_YOUTUBE_REFRESH_TOKEN` under **Settings → Secrets and variables → Actions**. Never place OAuth credentials or refresh tokens in source, issues, screenshots, or video artifacts.
3. Verify access, intended channel, and public visibility restrictions. Google can force API uploads from unverified projects to **private**, requiring a compliance audit. The uploader reports the actual visibility it receives, without claiming publication succeeded publicly when it did not.
4. When tested and approved, set Actions variable `PACKONE_YOUTUBE_UPLOAD_ENABLED` to exactly `true`. Scheduled runs then upload the newly captured 10-second Short. A manual **publish = true** run on reviewed `main` performs an explicit live upload; on PRs neither mode is possible.

The YouTube video points to the Daily with attribution `utm_source=youtube&utm_medium=short&utm_campaign=daily_post`. Each day uses a `github-actions[bot]` receipt in existing Daily social ledger [issue #1135](https://github.com/killjoy00/mtg-ev-analyzer/issues/1135). `posted` means upload was acknowledged; `claimed` means **possibly uploaded** and requires human reconciliation before retry; no automatic duplicate upload is allowed. Removing the Actions variable disables scheduled upload while daily video recording continues.

## Cost and boundaries

The one Linux capture job uses the repository's pinned Playwright, Chromium and FFmpeg. It runs **once per day** plus explicit previews, and keeps videos/screenshots for only five days. No Mac runner, AI video API or replay/corpus job is used. Only two scoped GitHub tokens exist: a read-only recorder token (also for PRs), and an `issues: write` token in the main-only uploader. The video remains a real live-site screen recording, not an advertisement assembled from card placeholders.