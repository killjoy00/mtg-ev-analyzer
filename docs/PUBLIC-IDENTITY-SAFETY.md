# Public Identity safety and moderation

Updated 2026-09-30. This runbook covers Pack One's limited UGC surface: account-owned usernames and public profile identity.

## Product boundary

Pack One does not provide posts, comments, DMs, image uploads, or anonymous chat. Public identity can appear on leaderboards, public profiles, and attributed shares. Gameplay/career records are separate from public identity and must not be deleted merely because an identity is moderated.

## Publication requirements

Leaderboards are a signed-in feature: guests are never ranked, and a guest nickname is never public. The sign-in/sign-up screens and the leaderboard-name/public-profile save controls on web, iOS, and Android state that continuing or saving means agreeing to the Pack One Terms, including the Public Identity rules. There is no separate checkbox, and rules acceptance is never a ranking gate; accounts that predate the rules keep their leaderboard place. Saving a leaderboard name or public profile records the current rules version and time (`public_identity_terms_version`, `public_identity_terms_accepted_at`).

On sign-in, the server claims the nickname the player was already using as their owned username only when it is free, passes the server-side name filter below, and the identity has no moderation history. A guest-to-account merge carries a free nickname onto the account the same way: the merge leaves it unowned and the sign-in claim applies the same checks. Otherwise the account stays unranked until it saves an allowed, unique name.

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
6. If an appeal or later review supports restoration, use the audited **restore** action. Restore only clears the moderation block; it must not automatically re-own or republish the previous username, including on a later sign-in. The user must explicitly publish a currently compliant identity again.
7. Escalate threats, credible safety concerns, legal requests, or repeated moderation evasion to the owner rather than improvising account/data changes.

## Operational expectations

There is no requirement for routine alert spam. Review reports through the admin workflow as part of normal operations. A moderation action should create an audit record, not a recurring notification loop. Store-review questions can reference the exact safeguards summarized in `docs/mobile-store-submission.md`.

## Verification

Automated coverage must continue to prove prohibited-name rejection (including on the sign-in nickname claim), that leaderboards do not gate on rules acceptance, that saving records acceptance, report/block behavior, moderation hide/restore, prevention of immediate republishing after moderation, block-aware public reads, and preservation of gameplay/career records.
