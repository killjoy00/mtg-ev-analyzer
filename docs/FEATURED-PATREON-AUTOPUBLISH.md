# Automated Patreon featured-pick publisher

**Status:** Code is staged for review. This is not live until the change is merged, the creator session is authorized, and the opt-in repository variable is enabled. An actual Patreon editor and API publication must be verified before calling it operational.

## What it does (no paid tools)

- Reuses the existing previous-day featured-pick selection, exact source-date checks, trophy-in-offered-choices integrity rule, JPEG cover, and generated `patreon.md`.
- Adds a separate `featured-patreon` job after the `featured` media artifact upload. Patreon failure cannot cancel Bluesky, Discord, or YouTube; those destinations keep their own receipts.
- Opens Patreon's documented creator **Image** post editor with Playwright Chromium on a standard GitHub Actions runner, fills title and body, uploads the real graphic, selects **Free access**, and invokes Publish. This is a normal public image/text post, not audio or a paid-tier post.
- Reads published posts using Patreon's **documented read-only OAuth v2 API** for the Pack One campaign, checks an exact day-unique title and `is_public=true`, and records a nonsecret, date-scoped receipt in existing issue #1135.
- Keeps possible partial submissions claimed rather than blindly publishing another copy. Safe failures before reaching Publish can retry through the independent 07:10/07:20/07:40 Pacific Neon dispatch. The current GitHub schedule remains a fallback.

GitHub standard runners for this public repository have no additional Actions compute charge under the currently applicable GitHub public-repository policy. There is no Browserbase, Zapier, n8n Cloud, or Patreon publishing service fee. Existing infrastructure and GitHub quotas still apply.

## One-time authorization and activation (owner only)

Use a local computer with Node and a browser. **Never paste Patreon cookies, tokens, or session JSON into chat, a public GitHub issue/PR, CI output, or a workflow artifact.** The capture file is under `artifacts/`, which is gitignored.

1. Check out the reviewed/merged repository and run `npm ci` then `npx playwright install chromium` on your own machine.
2. Run `node scripts/capture-patreon-session.mjs`. Sign in normally to the intended Patreon **creator account**, switch to creator mode, and press Enter in the terminal. This only captures the Patreon-origin browser state locally (mode 0600). It does not publish anything.
3. With GitHub CLI authenticated to the repository, install the saved state as an encrypted **Actions secret**:

   ```sh
   base64 < artifacts/patreon-auth-state.json | tr -d '\n' | gh secret set PACKONE_PATREON_STORAGE_STATE_B64 -R killjoy00/mtg-ev-analyzer
   ```

4. Remove the local copy after verifying that GitHub accepted the secret: `rm artifacts/patreon-auth-state.json`. The contents cannot safely be printed to diagnose failures.
5. The existing `PATREON_CREATOR_ACCESS_TOKEN` GitHub secret is reused **only** for the official read-only post listing. Check that it works with scope `campaigns.posts`; the existing Patreon OAuth connection does not grant a post-writing capability.
6. After PR checks pass and the release is reviewed, set repository Actions variable `PACKONE_PATREON_AUTOPUBLISH_ENABLED` to `true`. This is the explicit go-live gate; absent/false is inert. Leave it off until the owner has authorized the first public post.
7. Run the existing `post Pack One Daily to Bluesky and Discord` workflow with `live=true` on reviewed `main`, for the current Pacific Daily. This uses yesterday's real qualifying pick and is deduplicated by the existing receipts. Confirm the new `featured-patreon` job logs a **public** Patreon post URL and confirm the actual published post looks correct. Do not claim success based solely on a workflow dispatch or draft.

## Safety and operator behavior

- No credentials, browser state, raw player rows, or authenticated page screenshots are uploaded to artifacts or echoed to logs. The browser session secret is passed directly as an environment variable and parsed in memory. Never enable Playwright trace/video/screenshot upload on the live publishing job.
- A stored browser session may expire or encounter a CAPTCHA, 2FA prompt, geographic validation, or other challenge. The job **does not bypass** these protections. An expired session must be reauthorized using the local capture command. No free solution can promise permanent zero-intervention authentication.
- Patreon can change its editor controls. Playwright uses narrow, accessible selectors and fails closed when a title, image, Free access audience, or Publish button cannot be verified. Do not enable selectors that guess by nearby element position or skip public-access verification.
- To prevent duplicate public posts: (1) read-only exact-title lookup before any UI interaction, (2) date-scoped receipt claim, (3) read-only exact-title verification after submitting. If the browser may have clicked Publish but API verification fails, keep the receipt **claimed** and investigate rather than resetting it to failed. A later normal run checks the API again and will skip an existing matching post.
- Publishing is limited to reviewed `main` and a first-attempt job, today's Pacific scheduler date, and a qualifying featured pick from **yesterday**. A corrected source date or rerun must never overwrite a different day's post.
- A failure produces a red `featured-patreon` GitHub Actions job; turn on GitHub workflow-failure notifications or monitor this job. Existing Bluesky/Discord/YouTube publication continues independently.
- Disable new publication by setting `PACKONE_PATREON_AUTOPUBLISH_ENABLED` to `false` (or deleting it). This does not affect Patreon's existing member OAuth, reconciliation, tiers, or other Pack One channels.

## Validation

Run `node --test tests/featured-patreon.test.mjs`. Offline tests verify content provenance, public/private verification, pagination, duplicate handling, session-gate failures, claim behavior, current Pacific day guards, and workflow wiring. They intentionally do **not** contact a Patreon account or publish real content.

The live creator UI is **not proven compatible until the first owner-authorized canary succeeds**. If the first canary fails before Publish, review Patreon editor selectors without recording private browser state. If Patreon blocks GitHub-hosted browsers, stop: do not try to circumvent bot protection or silently substitute a paid service.
