# Account-ready email opt-in and new-set launch announcements

## User-facing contract

The existing **Your account is ready** / display-name step, on web and native,
offers an explicit **Yes / No** radio choice for new-set launch announcements.
Neither answer is preselected. A separate, unchecked checkbox optionally enables
weekly results and season standings. The user can skip account-ready without
answering and still play; it must never gate gameplay.

Both decisions are saved together with one authenticated `signup:<news>:<weekly>`
action. Email permissions are independent of username ownership, public-name
publication choices, Daily reminders, Patreon membership, and gameplay.
An unavailable email service never blocks the **Skip for now** path.

The nonmodal Daily-home invitation and Account settings mirror these two topics.
Older accounts' previously granted **Results and news** choices continue to mean
both topics. Previously declined or unanswered choices remain off/unanswered.
Neither topic ever defaults to opted-in for a new account.

## Backend consent and delivery

Migration `0078_separate_news_email_consent.sql` adds `news_email_state` and
`news_changed_at` alongside existing weekly-results `email_state` and
`changed_at`. The same verified-email destination fingerprint, suppression
rules, account deletion lock, owner approval gate, unsubscribe nonce, and signed
provider callback are reused.

- Only `news_email_state='on'` permits an admin `news` campaign, including a
  Star Trek set launch. Generic unrelated offers should not be sent under
  this narrowly described consent.
- Only `email_state='on'` permits weekly and season result digests.
- Both topics are rechecked at campaign claim and immediately before provider
  handoff. Accounts that opted in after campaign approval are not included.
- A changed account email invalidates affected on-consents until the new
  verified address is explicitly authorized.
- The existing one-click Unsubscribe stops both results and announcements.
  Daily reminders remain independently managed.

`Admin → Users → Results and news emails` still requires owner review and
manual approval of every news campaign. **Do not** auto-send a Star Trek
announcement or import account emails into unrelated mailing systems.

## Launch and verification

The release requires review of web and native signup UX, real PostgreSQL
migration/concurrency tests, email admission and unsubscribe tests, affected
Chromium browser tests, and the mobile account screen. Review App Store email
marketing disclosures before any native public release. Keep existing secure
development-then-production release gates. No production SQL, deployment,
store submission, or provider reconfiguration is authorized by this PR alone.

For the eventual Star Trek launch, draft the announcement in Admin, confirm the
new-set subscriber count, explicitly approve, and monitor provider delivery,
bounces and unsubscribes. Compare the return rate of subscribed inactive players
with other returning players, without making a causal claim.
