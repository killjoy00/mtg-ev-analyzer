# Pack One morning Daily posts — owner setup

The [Daily social workflow](../.github/workflows/daily-social-post.yml) runs live on **main only**; its independent Neon clock targets **7:10 a.m. America/Los_Angeles**. Three UTC triggers handle daylight saving and retries; the original GitHub run time identifies the intended Pacific Daily so delayed jobs can still post for the correct day. It posts one Daily link; the Daily homepage also offers Powered Cube and Latest Set. Discord displays the short owned link `https://packone.pro/go/discord/`, which redirects to the regular Daily Draft Run with the existing Discord `daily_post` campaign attribution. The generic `https://packone.pro/go/daily/` link has no forced source or campaign tracking. The Bluesky linked label and destination are unchanged. This does **not** replace the independent Neon Daily puzzle generation.

## Independent morning clock (Neon)

GitHub Actions scheduled workflows can appear hours late; GitHub is not the authoritative posting clock. The production `pack1-daily-social-dispatch` Neon Function Trigger calls the protected `pack1growth/internal/daily-social-dispatch` route at **7:10, 7:20 and 7:40 a.m. America/Los_Angeles** (paired UTC hour crons, Pacific eligibility gate). It dispatches the **same** GitHub `daily-social-post.yml` workflow on reviewed `main`; existing GitHub cron stays as an emergency backstop. Production `pack1growth` uses the existing fine-grained, repository-scoped Actions-write credential already restricted to reviewed workflows. Discord and Bluesky credentials remain only in GitHub Actions.

Each Neon request carries the original Pacific date. A queued GitHub job skips if its source date is no longer today's Pacific Daily or it starts before 7 a.m. Duplicate GitHub runs are harmless: the shared live concurrency group, Discord receipt ledger (#1135) and deterministic Bluesky record prevent duplicate posts. Acceptance of a workflow dispatch is **not** evidence that the post was delivered. Verify the GH job and Discord receipt. Neon is more punctual than the GitHub schedule, but neither system guarantees execution at the exact second.

The new Neon trigger must be enabled **only after the guarded secure-auth production release** serves the matching code revision; a Git merge alone does not activate it. Keep the three legacy maintenance/Daily triggers enabled. To roll back only Daily social, disable `pack1-daily-social-dispatch` in Neon; the existing GitHub schedule and manual Run workflow continue working. Never print or move private webhook or PAT values into public issues.

**Do not use GitHub Actions "Re-run jobs" to recover a Daily social post.** Re-running an old workflow uses the original checkout, which can contain outdated Discord copy or URLs. A current live publisher refuses job attempts greater than one and checks its checkout SHA against current `main` before posting. Recover by starting a **new** live `workflow_dispatch` on current `main` (after verifying today's Daily and existing receipts), or rely on the independent Neon dispatch. The freshness check cannot retroactively change or block historical runs created before this guard was added. The displayed Discord link remains `https://packone.pro/go/discord/`; it intentionally redirects to the tracked Draft Run Daily URL.

## Configure destinations privately

In GitHub **Settings → Secrets and variables → Actions**, configure the destinations you want:

- Secret `PACKONE_BLUESKY_HANDLE`: dedicated Pack One Bluesky handle.
- Secret `PACKONE_BLUESKY_APP_PASSWORD`: Bluesky **app password**, never the primary account password.
- Secret `PACKONE_DISCORD_WEBHOOK_URLS`: one Discord incoming webhook URL per line, supplied privately by server admins who choose to opt in. Add or remove servers by editing this secret. **Do not** expose webhooks in public forms, pull requests, issues, or source code.
- Variable `PACKONE_DAILY_IMAGE_URL_TEMPLATE` (optional, after image feature #3 exists): a public Pack One-hosted URL template such as `https://packone.pro/daily/{date}.png`. If the image is missing, the post is text-only. Images must be PNG, JPEG, or WebP, at most 1 MB.

Until at least one destination is configured, the scheduled runs succeed without posting (the job log reports `no social destinations configured`), so the workflow can stay enabled before launch. A manual live run with nothing configured fails. A half-configured Bluesky account or a malformed Discord entry fails explicitly rather than posting silently to fewer destinations.

## Verify and operate

1. Open **Actions → post Pack One Daily to Bluesky and Discord → Run workflow**, with **live unchecked**. It performs an offline dry run, printing only the public copy and number of destinations.
2. Before enabling real publication, verify today’s Daily and the target accounts/channels. The Daily scheduling system is separate.
3. Once the PR is merged and credentials exist, scheduled runs automatically post each Pacific morning. A manually checked **live** run publishes immediately for the current Pacific day, so use deliberately.
4. Inspect the GitHub Actions job for errors. Failures set a nonzero exit code; neither webhook URLs nor account passwords are logged.
5. To opt in another server, have its administrator create a Discord incoming webhook for their chosen channel and pass the link privately to the Pack One owner. Append it as a new line to `PACKONE_DISCORD_WEBHOOK_URLS`.
6. To revoke a server, remove its URL from the secret and ask its administrator to delete or rotate its webhook.

Bluesky now uses a valid, deterministic AT Protocol TID per Daily and verifies existing records before skipping. Text-only posts end with a short `packone.pro` label that links to the tracked Daily URL, plus a link card showing the site's share banner ([`social-card-v1.png`](../social-card-v1.png): the 1200×240 `social-preview-v6.png` centered at the 1200×630 shape Bluesky crops link-card images to). If the banner upload fails, the card posts without it. Discord uses persistent, non-secret receipt claims in [issue #1135](https://github.com/killjoy00/mtg-ev-analyzer/issues/1135) keyed by day and SHA-256 webhook fingerprint. Only receipts written by `github-actions[bot]` are trusted, so comments from anyone else on that public issue are ignored. If Discord answers with an HTTP error, the receipt is marked `failed` and the next scheduled trigger (up to three each morning) retries that server. Only a timeout or network failure leaves a receipt `claimed`, because the message may have been delivered: check that channel, then edit the bot comment's `status:` line to `posted` (it arrived) or `failed` (retry on the next trigger). Discord 429 responses get bounded retries. A malformed entry in `PACKONE_DISCORD_WEBHOOK_URLS` is reported by line number and does not stop other destinations. Both channels use source-specific UTM links with one stable campaign, `daily_post`. Unsubscribe from issue #1135 if the daily receipt comments notify you. Manual live runs are restricted to main; PR/dry-run work never shares live concurrency. GitHub scheduling is best-effort.

The job has read-only repository permissions and sends posts only to destinations supplied via Actions secrets. Tests never use real credentials or submit live posts.
