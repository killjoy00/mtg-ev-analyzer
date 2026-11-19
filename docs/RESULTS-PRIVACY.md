# Results, news, and publication privacy controls

## Implementation and shipment plan

1. Schema: additive migration 0074 adds an initially unset launch date, separate
   three-state results-email preferences and audit history, destination suppressions,
   private publication records, removal tasks, and the manual contact preference.
   A deletion-tombstone trigger creates tasks at commitment before identity cleanup.
2. Backend: reuse first-party browser CSRF/Origin and native account authentication;
   atomically serialize consent and publication writes against account deletion.
   A sender admission helper and a publishable-name helper enforce the new rules.
3. Web: nonmodal home invitation, Account settings, and authenticated Admin Users
   counts, contact controls, and removal queue. Account changes invalidate stale UI.
4. Mobile: the same invitation on Daily home and choices inside Account settings.
   No app build, upload, submission, or testing-track change is part of this work.
5. Policy: exact approved paragraphs are in `releases/results-policy-copy.json`.
   Review copies are in `releases/results-privacy-preview/`. Live policy routes and
   shipped native policy text intentionally remain unchanged at this stage.
6. Release order: review draft → merge reviewed controls → approve the existing
   guarded secure-auth release (development first, then production) → verify schema,
   functions, gateway, web controls, and account/deletion behavior → approve the
   single launch date → final dated policy-only commit, landing policy text last.

The prompt's requested publication date cannot be stamped honestly before an
actual release date is chosen. The preview uses `{{RELEASE_DATE}}` deliberately;
that placeholder must never be copied into live policy files. The existing
website publishes main automatically, so the policy installation is a separate
final commit. No production migration or deployment is authorized by this draft.

## Single launch setting

`results_launch.launch_at` is the only launch switch and account cutoff. NULL or a
future timestamp keeps the new player-facing controls off. Server database time
is authoritative on web and mobile. A pre-launch or unavailable backend never
blocks playing. Older app versions make no results preference write.

After the controls release is verified and the owner chooses a launch date,
prepare a separate reviewed activation migration setting this timestamp through
`migrations/manifest.json` and the existing protected secure-auth release process.
Do not run direct production SQL, backdate activation, move an activated cutoff,
change the current release request, or deploy a branch as part of this PR.

After the active production backend is verified, the agent prepares the final
policy commit with `node scripts/prepare-results-policies.mjs YYYY-MM-DD --apply`.
The script checks the live launch endpoint and matching Central calendar date
before modifying `privacy/index.html`, `terms/index.html`, the in-app editorial
text, and the two native policy screens. Review and approve that final commit
separately. Merely preparing review copies does not change live policies.

No results publication is allowed until at least 14 full days after launch.
`pack1_results_record_publication` enforces that period and the publication date.
The name helper also requires each older account's notice to have been shown.
New accounts use the exact launch timestamp boundary, not a browser clock.

## Private email and publication interfaces

- `prepareResultsEmail(query, authId, content)` in `worker/results-privacy.mjs` is
  the mandatory final admission path for every future results/news email. It
  performs no delivery, scheduling, or weekly content generation. Do not cache
  admitted envelopes or put them in public artifacts. Call immediately before
  any future provider handoff; already handed-off messages cannot be recalled.
- Sender configuration: `PACK1_RESULTS_SENDER_NAME`,
  `PACK1_RESULTS_SENDER_EMAIL`, and `PACK1_RESULTS_POSTAL_ADDRESS`. No envelope is
  admitted if any sender field or the postal address is missing. Keep any private
  postal configuration in the private deployment configuration, not this repo.
- Signed unsubscribe links use the established `PACK1_RATE_LIMIT_SECRET` with a
  separate purpose. Preserve it across releases. GET is scanner-safe; the visible
  unsubscribe button and RFC 8058 one-click POST work without signing in. Off
  persists across address changes and never changes Daily reminder consent.
- Address association is a keyed digest of the normalized account email. A
  changed destination invalidates an on choice and allows one new ask; an off
  choice stays off. Every admission rechecks the current verified address.
- Before any future sender is enabled, configure a dedicated Resend webhook for
  `https://api.packone.pro/growth/v1/results/provider-event` and its private
  `PACK1_RESULTS_RESEND_WEBHOOK_SECRET`. Only signed bounce/complaint evidence
  tied to our immutable admission tag and destination creates suppression. Raw
  events, email contents, and addresses are not retained by the handler. Existing
  Daily bounce/complaint suppressions also block results/news admission.
- `publishableResultsName` is the required source for a publication identity.
  `recordResultsPublication` must record every named placement, with channel,
  final HTTPS link, and date. It rechecks eligibility under the deletion lock.
  These functions do not publish anything. A hidden/unowned/excluded/unnotified
  identity becomes `Anonymous player`; public profile visibility is independent.
- Publication rows and names are private database records. **Named results must
  never pass through this public repository, branches, logs, artifacts, issues,
  or PRs.** This also prohibits feeding them to the existing public
  `packone-patreon-feed` branch or `scripts/patreon-desktop-feed.mjs`.
  That workflow remains suitable only for its existing aggregate contested-pick
  material. A future named-results publisher needs a private data path.

## Removal and individual contact operations

Admin Users shows aggregate email states, notice outcomes and publication
exclusions. The private removal queue shows name/location evidence and due dates.
It is bounded to the earliest 200 tasks; finish those before the next batch.

Deleting an account automatically queues each named publication with its original
28-day deadline. Attribution to the Auth account is cleared immediately; only the
name and publication locator needed to remove it remain. Normal account cleanup,
provider recovery, sessions, and tombstones keep their existing behavior. The
owner uses the same queue for an emailed removal request without deletion.
Repeated requests cannot extend a deadline. After editing/removing the original
publication, mark the task removed: this deletes the task and its retained name
and publication evidence. Already delivered emails and third-party copies cannot
be recalled. Do not mark a task complete before the name is actually removed.

The owner can set/clear **Do not contact individually** on a user. The timestamp
is visible there. Check it before any individual nonessential message. It is
separate from results/news consent and from important account/security notices.
This feature sends no individual message.

## Acceptance and owner's remaining decisions

The agent handles implementation and release preparation; the owner does not
need to run commands locally.

- Review this draft and its exact-head required and affected CI results.
- Approve each guarded backend release stage. Do not bypass `test`, `browser`,
  backend/schema, reminder/results PostgreSQL, or affected native validation.
- Choose the launch date after production controls are proven; approve the
  activation migration and final dated policy commit in that order.
- Provide the sender postal address privately before any later email project.
  The initial controls release did not implement delivery. The separately guarded sender is documented in [Results and news delivery](RESULTS-EMAIL-DELIVERY.md).
- Make the email-use console changes in `mobile-store-submission.md`. App-store
  builds, submissions and tracks remain a separate authorized task.
- Use private synthetic acceptance accounts to verify notice vs prompt, both
  choices, exclusion, account switching, deletion, removal completion, and old
  unsubscribe links. Do not attach account details or screenshots to public CI.

Automated coverage is in `tests/results-privacy.test.mjs`,
`tests/results-privacy-postgres.mjs`, `tests/results-preferences-e2e.mjs`, and the
existing Daily reminder regression suite. The affected contract workflow requires
real PostgreSQL migrations and a Chromium web check; a file-presence assertion is
not acceptance of the database behavior.
