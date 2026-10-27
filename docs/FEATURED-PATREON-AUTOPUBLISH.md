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
