# Account-ready email opt-in: Pack One news and weekly results

## User-facing contract

The existing **Your account is ready** / display-name step, on web and native,
offers an explicit **Yes / No** radio choice for **Pack One news**: "New sets,
new features, events, and occasional offers." The categories are deliberately
broad so future campaigns stay within what subscribers agreed to, but they are
named, because consent that describes nothing specific is the easiest to
challenge. Consent copy never names a specific licensed set.
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

| Action | Weekly results | Pack One news |
| --- | --- | --- |
| `weekly:on` / `weekly:off` (new settings toggle) | changes | unchanged |
| `news:on` / `news:off` (new settings toggle) | unchanged | changes |
| `signup:<news>:<weekly>` | changes | changes |
| `settings:*`, `prompt:*`, `notice:*`, unsubscribe (pre-split) | changes | changes |

Older native builds and cached web pages still show one **Results and news**
control and send `settings:*`, `prompt:*` or `notice:*`. Those actions keep their
original meaning of both topics, so turning that control off also stops
Pack One news. New clients never send `settings:*`. Raising the mobile minimum
version is therefore not required for consent correctness, but it is still
recommended before a news campaign so every player sees the separate choices.

## Backend consent and delivery

Migration `0078_separate_news_email_consent.sql` adds `news_email_state` and
`news_changed_at` alongside existing weekly-results `email_state` and
`changed_at`. The same verified-email destination fingerprint, suppression
rules, account deletion lock, owner approval gate, unsubscribe nonce, and signed
provider callback are reused.

- Only `news_email_state='on'` permits an admin `news` campaign. Keep each
  campaign within the agreed categories: new sets, new features, events and
  occasional offers. Mail outside those categories needs a new opt-in.
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
- The existing one-click Unsubscribe stops both results and Pack One news.
  Daily reminders remain independently managed.

`Admin → Users → Results and news emails` still requires owner review and
manual approval of every news campaign. **Do not** auto-send a new-set
announcement or import account emails into unrelated mailing systems.

## Audience check before a news announcement

The owner Publishing email controls now show how many accounts would be eligible
for a **new** Pack One news campaign approved now, not merely how many have
news switched on. The read-only snapshot checks:

- account still exists and has not entered deletion;
- owner do-not-contact flag is clear;
- account email is verified and matches the secret HMAC destination fingerprint
  saved with the consent (an email change needs fresh consent);
- news consent has a valid timestamp and is current;
- neither results/news nor Daily email has a bounce/complaint suppression.

The breakdown includes opted-out and unanswered accounts separately. Email
addresses and individual recipient IDs are used only inside the private server
request and are **never returned, logged, cached or exported** to the UI. The
count uses keyset pages of 250 and deliberately reports `unavailable`, not a
made-up total, if more than 5,000 opted-in accounts need inspection or the
population changes during the read. The existing owner-only campaign endpoint
and privileges are reused; there is no public report.

Migration `0079_results_news_audience_guard.sql` also enforces the existing
owner do-not-contact flag in actual weekly/news delivery claiming **and** final
admission. This protects someone marked do not contact after an email was queued.
The account's opt-ins are unchanged and a future owner reversal of the flag
does not grant new consent.

The displayed number is an as-of snapshot, not proof that mail was sent or
delivered. Final checks run again immediately before every provider handoff.
Sender configuration, delivery-check verification, owner draft preview and
explicit approval remain separate requirements. No Star Trek announcement
is created or sent by this reporting change.

## Launch and verification

The release requires review of web and native signup UX, real PostgreSQL
migration/concurrency tests, email admission and unsubscribe tests, affected
Chromium browser tests, and the mobile account screen. Review App Store email
marketing disclosures before any native public release. Keep existing secure
development-then-production release gates. No production SQL, deployment,
store submission, or provider reconfiguration is authorized by this PR alone.

For a new-set launch, draft the announcement in Admin, confirm the
Pack One news subscriber count, explicitly approve, and monitor provider delivery,
bounces and unsubscribes. Compare the return rate of subscribed inactive players
with other returning players, without making a causal claim.
