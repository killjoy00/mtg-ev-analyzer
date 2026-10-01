# Public Identity safety and moderation

Updated 2026-09-30. This runbook covers Pack One's limited UGC surface: account-owned usernames and public profile identity.

## Product boundary

Pack One does not provide posts, comments, DMs, image uploads, or anonymous chat. Public identity can appear on leaderboards, public profiles, and attributed shares. Gameplay/career records are separate from public identity and must not be deleted merely because an identity is moderated.

## Publication requirements

Before an account can publish an owned username/profile identity, the server requires acceptance of the current Public Identity rules. A linked account without current acceptance remains private/unranked. Guest-to-account merges may carry a nickname onto the account record, but the nickname stays unowned/private until the account explicitly accepts the current rules and the name passes validation/uniqueness checks.

Server-side name validation rejects clearly prohibited high-severity content, Pack One staff impersonation, URLs/contact information, and invisible/control-character abuse. The filter is intentionally conservative; contextual abuse is handled through report/block/moderation rather than broad lexical censorship.

## User report and block flow

Public profile surfaces expose Report and Block in-app on web, iOS, and Android. Reports store reporter, target, reason, optional bounded detail, status, and timestamps. Only one open report per reporter/target pair is allowed. A user cannot report or block themselves.

Blocking is viewer-specific. Where Pack One knows the viewer identity, a blocked target is omitted from personalized public-profile/leaderboard identity surfaces. Blocking does not alter the target's gameplay history or global account state.

## Moderation response procedure

1. Review open reports in the authenticated admin user surface and inspect the reported public identity plus prior moderation history.
2. If the identity is allowed, dismiss the report with no public-identity change.
3. If the identity violates the rules, use the audited **hide** action with a concise reason. Do not directly edit database flags outside the moderation action.
4. Hiding an identity must remove it from public/ranked identity surfaces, disable profile publication/ownership, and scrub attributed shared identity to the generic **A friend** label while preserving gameplay/career data.
5. Resolve related open reports once action is taken. The moderation action log is the audit record for who acted, what action was taken, when, and why.
6. If an appeal or later review supports restoration, use the audited **restore** action. Restore only clears the moderation block; it must not automatically re-own or republish the previous username. The user must explicitly publish a currently compliant identity again.
7. Escalate threats, credible safety concerns, legal requests, or repeated moderation evasion to the owner rather than improvising account/data changes.

## Operational expectations

There is no requirement for routine alert spam. Review reports through the admin workflow as part of normal operations. A moderation action should create an audit record, not a recurring notification loop. Store-review questions can reference the exact safeguards summarized in `docs/mobile-store-submission.md`.

## Verification

Automated coverage must continue to prove prohibited-name rejection, terms gating, report/block behavior, moderation hide/restore, prevention of immediate republishing after moderation, block-aware public reads, and preservation of gameplay/career records.
