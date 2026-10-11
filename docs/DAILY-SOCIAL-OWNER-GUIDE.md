# Pack One morning Daily posts — owner setup

The [Daily social workflow](../.github/workflows/daily-social-post.yml) runs live on **main only** at approximately **8:10 a.m. America/Los_Angeles**. Two UTC schedules handle daylight saving; the original GitHub run time identifies the intended Pacific Daily so delayed jobs can still post for the correct day. It posts one Daily link; the Daily homepage also offers Powered Cube and Latest Set. This does **not** replace the independent Neon Daily puzzle generation.

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

Bluesky now uses a valid, deterministic AT Protocol TID per Daily and verifies existing records before skipping. Text-only posts include an external link card. Discord uses persistent, non-secret receipt claims in [issue #1135](https://github.com/killjoy00/mtg-ev-analyzer/issues/1135) keyed by day and SHA-256 webhook fingerprint. Only receipts written by `github-actions[bot]` are trusted, so comments from anyone else on that public issue are ignored. If Discord answers with an HTTP error, the receipt is marked `failed` and the next scheduled trigger (three each morning) retries that server. Only a timeout or network failure leaves a receipt `claimed`, because the message may have been delivered: check that channel, then edit the bot comment's `status:` line to `posted` (it arrived) or `failed` (retry on the next trigger). Discord 429 responses get bounded retries. A malformed entry in `PACKONE_DISCORD_WEBHOOK_URLS` is reported by line number and does not stop other destinations. Both channels use source-specific UTM links with one stable campaign, `daily_post`. Unsubscribe from issue #1135 if the daily receipt comments notify you. Manual live runs are restricted to main; PR/dry-run work never shares live concurrency. GitHub scheduling is best-effort.

The job has read-only repository permissions and sends posts only to destinations supplied via Actions secrets. Tests never use real credentials or submit live posts.
