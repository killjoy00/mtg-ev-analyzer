# Automated Patreon featured posts

**Live status: blocked.** The saved profile can be found and official API checks pass, but a fresh browser session displays Patreon security verification. No successful live image/text post has been confirmed. Automatic profile activation is paused. Do not repeat login or represent the integration as operational; a provider-supported solution and a verified post are required first.

The publisher uses Patreon's normal creator editor because the supported API has no create-post operation. It posts the existing featured JPEG and text, selects Free access, reads the exact public title through API v2, and independently checks the title, full body and loaded cover-shaped image from a signed-out browser. A connection check is not a successful live publication.

## Connect once on a phone

1. Open [Browserless Profiles](https://www.browserless.io/account/profiles) and sign into the existing Browserless account. Use the same API-token context as the key already saved in GitHub; profiles are scoped to that token.
2. Choose **New Profile**, name it **packone-patreon**, select **Sign in via remote browser**, and set the starting URL to **https://www.patreon.com/**.
3. Tap **Continue**, then **Open auth flow in new tab**. Sign into Patreon normally, complete any security verification and switch to the **Pack One creator** profile. Save with **Save profile** in the remote-browser toolbar (or **Done** in the original setup dialog).
4. After the provider verification problem is resolved, the existing morning workflow can use the saved profile. For an immediate optional test, open [Connect and verify Patreon publishing](https://github.com/killjoy00/mtg-ev-analyzer/actions/workflows/patreon-publishing.yml), choose **Run workflow**, keep **main**, check **publish_once**, and run it. This publishes the latest eligible generated feature once. It requires yesterday's media from a trusted morning workflow; stale media is rejected.

The same links and instructions are in Admin → Patreon publishing. No Codespace, terminal, downloaded cookie file, clipboard session or new login server is needed. Admin links to Browserless's authenticated profile setup; it does not embed or receive the Patreon login. Never paste credentials into chat or public repository content.

## How automatic posting is gated

The prepared profile path uses `PACKONE_PATREON_AUTO_ACTIVATE=true`, but the production workflow currently sets it to **false** because fresh-session access failed. Before enabling this path, first establish provider-supported access and verify a real public post. Before reading the media or claiming a publication it verifies:

- The existing Browserless key can access the named saved profile and it contains cookies.
- The existing Patreon creator token can read the configured campaign and its posts. A membership-only token is insufficient.
- The signed-in creator's **My page** navigation points to Pack One. Missing or changed navigation fails closed.

A missing profile is a normal waiting state, with no attempted post. Other connection errors fail visibly. A connection check only opens the existing login; it never creates a post. The optional first-post workflow uses the same main/first-attempt and date restrictions, publication code, receipts and concurrency group as the mornings.

The legacy `PACKONE_PATREON_STORAGE_STATE_B64` path remains supported for existing installations. Profile mode reuses Browserless's **default browser context**; creating a new Playwright context would discard the saved login. Normal cookie rotation is saved back to the same Browserless profile after submission, without exporting the session into GitHub.

Set the repository Actions variable `PACKONE_PATREON_AUTOPUBLISH_ENABLED=false` to pause morning posts. An unset variable allows the reviewed profile setup path; `true` retains the legacy explicit-enable behavior. The optional manual `publish_once` test is a separate explicit publication request.

## Publication and duplicate protection

- Preserve selection, source date, real card imagery and trophy-in-offered-choices requirements.
- Look up the complete exact-title post set through the supported read-only API before opening an editor.
- Claim the date/channel receipt in issue #1135 under the existing workflow identity; public commenters cannot forge trusted receipts.
- Before submission, verify the creator, retained title/body, image upload and Free access controls.
- After submission, verify API public state and a signed-out browser view before marking the receipt posted.
- Once Publish may have been clicked, a failure keeps the claim ambiguous. Do not automatically reset it or submit another post. A subsequent run can reconcile an existing exact-title public post without creating a duplicate, but must verify its public body and image too.
- The dedicated first-post workflow and morning workflow share `packone-social-live` serialization. Other destinations retain their existing independent jobs.
- No authenticated screenshots, page HTML, cookies, provider responses or token-bearing URLs are logged or uploaded. Only fixed status categories and already-public post URLs are returned.

Admin distinguishes the latest connection job from the latest first-post test. Its overall morning history is not proof of Patreon publication. Expired sessions or editor changes produce a failed Patreon job while other destinations can continue. Reconnect a revoked/expired login using the same profile name; indefinite authentication cannot be guaranteed by this integration.

## Limits and evidence

Browserless currently documents a Free plan with 1,000 units/month, two concurrent browsers and a **two-minute absolute session limit**. A profile creation is bounded by the plan limit even though paid plans can allow longer. Have credentials/MFA ready before starting. No paid upgrade is automatically authorized. A daily readiness check, one short publisher session and one anonymous verification session are designed to fit that allowance, but actual login success, editor timing and usage require live verification.

Sources checked October 27, 2026:

- [Browserless authenticated profiles](https://docs.browserless.io/baas/features/authenticated-profiles)
- [Browserless pricing and session limits](https://www.browserless.io/pricing)
- [Patreon API v2](https://docs.patreon.com/)

Offline regressions: `node --test tests/featured-patreon.test.mjs tests/patreon-publishing-connection.test.mjs tests/admin-patreon-publishing.test.mjs`. They cover profile context reuse, cleanup, wrong creator/campaign, missing post-read scope, public verification ordering, waiting/paused behavior, stale media and duplicate ambiguity. The merged workflow checks real configuration without exposing values. Only a completed real first post proves the live editor is compatible; document that outcome separately after authorization.

## Windows PostyBirb bridge

The cloud browser remains paused after the verified fresh-session Cloudflare failure. The desktop alternative uses the owner's normal PostyBirb+ login. It is not considered operational until a real public image post succeeds.

`Patreon Windows helper` builds `PackOnePatreon.exe` on Windows, runs the protocol tests and packaged-runtime self-test, and publishes a download only from reviewed `main`. It requires no Python installation. The helper checks PostyBirb's logged-in campaign and its `Everyone` folder, uploads the daily JPEG and text to the local app, validates the returned draft and queues that one Patreon destination. It does not read Patreon cookies or expose a listening service. Local authentication is sent only after the loopback TLS peer matches the certificate in PostyBirb's own Windows data directory.

The existing morning dispatch delivers the validated public image and text through its separate `featured-patreon-feed` job immediately after the rendered artifact is available, even if another destination fails. The independent morning clock therefore drives desktop content delivery directly. `Public Patreon desktop feed` also copies only the validated public feature image and text from today's first-attempt main-branch morning artifact to the data-only `packone-patreon-feed` branch. Every 15 minutes it refreshes an exact-title/publication check using the supported read-only Patreon API. A failed or stale check cannot authorize a new desktop post. This API check confirms the public post and title; it does not claim anonymous visual verification of the image or body.

First use: leave PostyBirb open, open the helper, and click **Publish today** once. After the public post is confirmed, enable **Post automatically and start this helper at Windows sign-in**. This saves a local copy and a current-user startup entry; unchecking it removes that entry. Also enable PostyBirb's tray-menu **Open on startup** once. The computer, helper and PostyBirb must be running with network access. Sleep, logout, expired login and renewed website challenges can interrupt posting.

A local exclusive journal is written and flushed before any draft creation. The helper sets General on both the default and Patreon sections. It can resume the original missing-rating draft only when its journal proves no queue request was made, there is exactly one unposted draft, no matching log exists, every destination/content option matches, and the stored image hash is unchanged. It updates only the missing default rating and revalidates before queuing. Queue errors, crashes after a possible queue request and uncertain publication responses never cause an automatic retry; matching local drafts/logs and public-post checks also prevent a new submission. Use one Windows worker. This is not a distributed cross-device lock and cannot protect against an independent manual publisher racing the desktop. Do not delete local journals to retry an uncertain publication. Inspect the public destination and PostyBirb first. The cloud publisher must remain paused while the desktop worker is used.

The app uses PostyBirb+'s default local port 9247 and Windows data directory. Custom ports or profiles are not yet supported. No tokens, local account records or diagnostic exception contents are written to the public feed or release logs.

Patreon titles use `Pack One's Contested Daily Pick YYYY-MM-DD`, dated for the featured Daily. The body lists each choice percentage once, uses “Pack One players,” and names the trophy choice without repeating its percentage. Existing rendered artifacts retain their original deterministic copy; once a day's public post is confirmed, its feed title, body and image stay pinned when later style changes roll out. The desktop helper validates date provenance without hardcoding the headline wording, and opening an updated helper preserves an already-enabled startup preference.
