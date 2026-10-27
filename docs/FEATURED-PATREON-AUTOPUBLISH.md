# Automated Patreon featured-pick publisher

**Status:** Code is staged for review. This is not live until the change is merged, the creator session is authorized, and the opt-in repository variable is enabled. An actual Patreon editor and API publication must be verified before calling it operational.

## What it does (no paid tools)

- Reuses the existing previous-day featured-pick selection, exact source-date checks, trophy-in-offered-choices integrity rule, JPEG cover, and generated `patreon.md`.
- Adds a separate `featured-patreon` job after the `featured` media artifact upload. Patreon failure cannot cancel Bluesky, Discord, or YouTube; those destinations keep their own receipts.
- Opens Patreon's documented creator **Image** post editor with Playwright Chromium on a standard GitHub Actions runner, fills title and body, uploads the real graphic, selects **Free access**, and invokes Publish. This is a normal public image/text post, not audio or a paid-tier post.
- Reads published posts using Patreon's **documented read-only OAuth v2 API** for the Pack One campaign, checks an exact day-unique title and `is_public=true`, and records a nonsecret, date-scoped receipt in existing issue #1135.
- Keeps possible partial submissions claimed rather than blindly publishing another copy. Safe failures before reaching Publish can retry through the independent 07:10/07:20/07:40 Pacific Neon dispatch. The current GitHub schedule remains a fallback.

GitHub standard runners for this public repository have no additional Actions compute charge under the currently applicable GitHub public-repository policy. There is no Browserbase, Zapier, n8n Cloud, or Patreon publishing service fee. Existing infrastructure and GitHub quotas still apply.

## One-time authorization from an iPhone (no local code)

**You do not need a Mac, PC, terminal, Playwright install, or local Git checkout.** A special one-time GitHub Codespace runs a normal desktop browser with a private, password-protected noVNC view. GitHub Codespaces private forwarded ports require the Codespace owner's GitHub authentication. The browser helper never asks you to paste a password into Pack One or ChatGPT.

[Open the Patreon connection Codespace](https://github.com/codespaces/new?repo=1201587098&ref=feature%2Fautomatic-patreon-featured-publishing&devcontainer_path=.devcontainer%2Fpatreon-auth%2Fdevcontainer.json)

1. On your phone, open the link, keep **2 cores** selected, confirm configuration **Pack One Patreon — mobile sign-in**, and tap **Create codespace**. The special configuration installs and starts the browser automatically. If GitHub says free quota is exhausted, **do not approve paid use**; this flow requires unused personal-account Codespaces free allocation.
2. The **Connect Pack One to Patreon** page should open automatically. Otherwise, in GitHub Codespaces open the **Ports** tab and choose the private forwarded **6081** port. **Never switch port 6080 or 6081 to Public.**
3. Tap **Open Patreon browser**. Enter the temporary remote-browser password displayed on your connection page, log in normally to the Pack One **creator** identity, and complete any Patreon security verification. Use the noVNC keyboard controls as needed on the phone. Return to the original connection tab.
4. Tap **Save Patreon connection**. The helper uses GitHub's encryption-aware CLI to attempt to store the browser state as the repository Actions secret **`PACKONE_PATREON_STORAGE_STATE_B64`**, without writing credentials to any committed file or CI artifact.
5. If GitHub denies the Codespace's secret-writing permission, the page offers **Copy session securely** and **Open GitHub Actions secret form**. Use your phone's Copy/Paste to create the secret named **`PACKONE_PATREON_STORAGE_STATE_B64`** in that form. **Never paste it into ChatGPT or an issue/PR. Clear your clipboard afterward.** This is a one-time browser interaction, not coding.
6. Once GitHub has saved the secret, **delete the temporary Codespace** at [Your GitHub Codespaces](https://github.com/codespaces). Deleting it destroys the temporary cloud browser session; the encrypted Actions secret remains in GitHub.
7. The existing **`PATREON_CREATOR_ACCESS_TOKEN`** Actions secret is reused only to **read** published posts through Patreon's official API. It must support campaign post reading; it cannot write new posts. After merging the PR and validating a canary, set the repository Actions variable **`PACKONE_PATREON_AUTOPUBLISH_ENABLED`** to **`true`** from GitHub's web Settings UI. Until then the publisher remains disabled.
8. To test live, run **post Pack One Daily to Bluesky and Discord** from GitHub Actions with **live=true** for the current Pacific day. Verify the independent **featured-patreon** job and the public post. All subsequent eligible mornings are automated, with retries and duplicate checks.

The GitHub personal account's included Codespaces allowance is free within its monthly compute/storage quotas. Codespaces is *not* continuously required for publishing: only the one-time sign-in uses it. Check your Codespaces balance and spending settings before starting. The saved session can expire, in which case repeat the one-time cloud login.

## Safety and operator behavior

- No credentials, browser state, raw player rows, or authenticated page screenshots are uploaded to artifacts or echoed to logs. The browser session secret is passed directly as an environment variable and parsed in memory. Never enable Playwright trace/video/screenshot upload on the live publishing job.
- A stored browser session may expire or encounter a CAPTCHA, 2FA prompt, geographic validation, or other challenge. The job **does not bypass** these protections. An expired session must be reauthorized through the phone-only Codespaces connection page. No free solution can promise permanent zero-intervention authentication.
- Patreon can change its editor controls. Playwright uses narrow, accessible selectors and fails closed when a title, image, Free access audience, or Publish button cannot be verified. Do not enable selectors that guess by nearby element position or skip public-access verification.
- To prevent duplicate public posts: (1) read-only exact-title lookup before any UI interaction, (2) date-scoped receipt claim, (3) read-only exact-title verification after submitting. If the browser may have clicked Publish but API verification fails, keep the receipt **claimed** and investigate rather than resetting it to failed. A later normal run checks the API again and will skip an existing matching post.
- Publishing is limited to reviewed `main` and a first-attempt job, today's Pacific scheduler date, and a qualifying featured pick from **yesterday**. A corrected source date or rerun must never overwrite a different day's post.
- A failure produces a red `featured-patreon` GitHub Actions job; turn on GitHub workflow-failure notifications or monitor this job. Existing Bluesky/Discord/YouTube publication continues independently.
- Disable new publication by setting `PACKONE_PATREON_AUTOPUBLISH_ENABLED` to `false` (or deleting it). This does not affect Patreon's existing member OAuth, reconciliation, tiers, or other Pack One channels.

## Validation

Run `node --test tests/featured-patreon.test.mjs`. Offline tests verify content provenance, public/private verification, pagination, duplicate handling, session-gate failures, claim behavior, current Pacific day guards, and workflow wiring. They intentionally do **not** contact a Patreon account or publish real content.

The live creator UI is **not proven compatible until the first owner-authorized canary succeeds**. If the first canary fails before Publish, review Patreon editor selectors without recording private browser state. If Patreon blocks GitHub-hosted browsers, stop: do not try to circumvent bot protection or silently substitute a paid service.
