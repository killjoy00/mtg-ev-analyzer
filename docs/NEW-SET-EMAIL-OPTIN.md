# Account-ready email opt-in and new-set launch announcements

## User-facing contract

The existing **Your account is ready** / display-name step, on web and native,
offers an explicit **Yes / No** radio choice for new-set launch announcements.
Neither answer is preselected. A separate, unchecked checkbox optionally enables
weekly results and season standings. Both are optional: the display name saves
without answering, and the user can skip account-ready and still play; it must
never gate gameplay.

An explicit Yes or No saves both decisions with one authenticated
`signup:<news>:<weekly>` action. With no Yes/No answer, nothing is recorded for
announcements, and a checked weekly box alone sends `weekly:on`. The display name
is saved first and independently; if the email save then fails, the screen says
the name was kept, and **Skip for now** keeps the saved name's Daily validation.
Email permissions are independent of username ownership, public-name
publication choices, Daily reminders, Patreon membership, and gameplay.
An unavailable email service never blocks the **Skip for now** path.

The nonmodal Daily-home invitation and Account settings mirror these two topics.
Older accounts' previously granted **Results and news** choices continue to mean
both topics. Previously declined or unanswered choices remain off/unanswered.
Neither topic ever defaults to opted-in for a new account.

### Actions and older clients

| Action | Weekly results | New-set announcements |
| --- | --- | --- |
| `weekly:on` / `weekly:off` (new settings toggle) | changes | unchanged |
| `news:on` / `news:off` (new settings toggle) | unchanged | changes |
| `signup:<news>:<weekly>` | changes | changes |
| `settings:*`, `prompt:*`, `notice:*`, unsubscribe (pre-split) | changes | changes |

Older native builds and cached web pages still show one **Results and news**
control and send `settings:*`, `prompt:*` or `notice:*`. Those actions keep their
original meaning of both topics, so turning that control off also stops
announcements. New clients never send `settings:*`. Raising the mobile minimum
version is therefore not required for consent correctness, but it is still
recommended before a news campaign so every player sees the separate choices.

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
  verified address is explicitly authorized. Both topics share one
  `destination_hash`, so every topic-specific write (`signup:*`, `news:*`)
  first runs the shared address-change reset; a news opt-in can never rebind
  weekly consent to a new address, or the reverse.
- Every transition of either topic is appended to `results_email_changes`
  with its `topic` (`weekly` or `news`), source and destination fingerprint.
  The migration records each carried-over news choice as
  `legacy results and news` at its original time, so the news consent of every
  subscriber can be traced to where and when it was given.
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
