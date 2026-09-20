# Mobile implementation decisions

Terse log for decisions that affect future mobile work.

## 2026-09-19 — repository structure

**Decision:** add `/mobile` to the existing repository; do not reorganize the live web app.  
**Alternatives:** immediate `/apps/web` + `/apps/mobile` monorepo conversion; separate mobile repository.  
**Reason:** the current Pages/Neon release system is mature and flat. Moving it creates risk without helping the first native vertical slice.  
**Migration:** extract shared packages later only when code is demonstrably platform-neutral.

## 2026-09-19 — Expo release baseline

**Decision:** stable Expo SDK 57 / React Native 0.86, Expo Router, EAS development builds.  
**Alternative:** SDK 58 beta.  
**Reason:** SDK 58 is still beta; the first mobile release should not take framework-preview risk.  
**Source:** Expo SDK 57 docs/repository, checked 2026-09-19.

## 2026-09-19 — native credential boundary

**Decision:** mobile credentials live in OS secure storage and will use a Pack One native session/token contract. Browser host cookies and CSRF remain browser-specific.  
**Alternative:** reuse the website’s `__Host-pack1_account` cookie flow inside native networking.  
**Reason:** that would couple native auth to browser origin/cookie behavior and undermine the clean revocation/linking boundary.  
**Migration:** additive backend routes/auth acceptance; no web-session rewrite.

## 2026-09-19 — billing deferred from foundation

**Decision:** do not add RevenueCat, StoreKit/Play billing, external purchase links, or final bundle/package identifiers in the foundation PR.  
**Reason:** owner agreements/accounts and storefront rules must be confirmed first; billing must remain feature-flagged when implemented.  
**Primary sources checked 2026-09-19:** Apple App Review Guidelines §§3.1.1, 3.1.3(b), 4.8 and 5.1.1(v); Google Play Payments policy, account-deletion policy, and production-access testing requirements.

Current policy implications recorded for implementation:
- Apple requires in-app purchase for unlocking digital features in the ordinary case.
- Apple’s multiplatform-services rule permits access to qualifying subscriptions/features acquired elsewhere when the same items are also available as in-app purchases, subject to current conditions.
- With third-party/social login, the mobile login set must satisfy Apple’s login-services rule; Sign in with Apple is planned.
- Apps supporting account creation must offer in-app account deletion.
- For Google Play personal developer accounts created after 2023-11-13, current production-access guidance requires a closed test with at least 12 testers continuously opted in for 14 days before applying for production access. Whether that rule applies to the owner’s account is still unverified.

Policy URLs:
- https://developer.apple.com/app-store/review/guidelines/
- https://support.google.com/googleplay/android-developer/answer/14151465
- https://support.google.com/googleplay/android-developer/answer/9858738
- https://support.google.com/googleplay/android-developer/answer/10144311

## 2026-09-19 — server authority

**Decision:** the app renders state; Pack One servers own scoring, leaderboard legitimacy, entitlement and account linkage.  
**Reason:** preserves one product across web/iOS/Android and limits modified-client abuse.  
**Migration:** no scoring fork and no direct mobile database credentials.

## 2026-09-19 — guest mobile session transport

**Decision:** use the existing signed `p1_` guest player session for the Phase 2 guest-only vertical slice, transported to the first-party gateway in `x-pack1-mobile-session`. The gateway maps it to upstream bearer auth only on fixed Draft Run player routes.  
**Alternative:** forward arbitrary caller `Authorization` in production.  
**Reason:** production intentionally strips caller authorization today. A shaped, route-scoped guest header preserves that boundary and cannot be used on account routes. Browser cookie identity still wins when present.  
**Migration:** account auth will use a separately designed revocable native session; this guest bridge is not the final account-token contract.

## 2026-09-19 — native account session and guest score claim

**Decision:** keep two native credentials: the signed Pack One player token and a separate revocable opaque account-session token. Both live only in SecureStore.  
**Alternative:** replace the player token with the account token, or reuse browser cookies.  
**Reason:** gameplay ownership and authenticated account authority already have distinct server responsibilities. Keeping them separate makes account logout/revocation mechanical without changing Draft Run subject identity.

**Decision:** completed unranked Daily runs mint a random 256-bit, 15-minute claim token. Only its SHA-256 hash is stored. The claim is bound to the guest player and run and is consumed by the account-link transaction path.  
**Alternative:** submit a run ID after login.  
**Reason:** a run ID is an identifier, not proof that the caller produced the run. The claim token satisfies the native handoff requirement for a server-issued, guest-bound, short-TTL, one-use proof.

## 2026-09-19 — account deletion data policy

**Decision:** account deletion removes the Pack One auth user and the linked player-owned product record rather than retaining an anonymized leaderboard ghost. This includes profile/career data, scores, Draft Run sessions/shares, challenges, achievements, player analytics events, provider links, Pack One account sessions and entitlement grants. Corpus/model source data is unrelated to the user account and remains. Product corpus-audit history may retain the change itself but the deleted Pack One account identifier is cleared.  
**Alternative:** preserve historical scores under an anonymous player.  
**Reason:** the first mobile deletion contract should be unambiguous full account deletion; leaderboard continuity does not outweigh keeping deleted player-owned records.  
**Authentication:** email/password deletion requires password reauthentication. Provider-only accounts remain blocked until Google/Apple provider reauthentication is implemented. Better Auth's documented built-in deletion is disabled by default; Pack One's managed Neon Auth stores users/accounts/sessions directly in Postgres with user-linked auth rows cascading from `neon_auth.user`. Sources checked 2026-09-19: Better Auth User & Accounts deletion documentation; Neon managed Better Auth architecture/schema.

## 2026-09-20 — native Google OAuth handoff

**Decision:** reuse Pack One's existing server-side Google provider rather than shipping Google OAuth client secrets or a second account system in the app. The app opens the provider authorization URL in the system authentication browser. Pack One's HTTPS callback exchanges the Neon Auth verifier, then redirects to the fixed `packone://account` deep link with a short-lived one-time handoff token.  
**Security:** the OAuth start creates a random 256-bit flow token bound to the initiating Pack One guest/player. The callback replaces it with a second random 256-bit handoff token; only digests are stored. The finish route requires the same signed player credential, consumes the handoff atomically, and only then issues the revocable Pack One mobile account session. Intercepting the custom-scheme URL without the initiating device's player credential is insufficient to finish sign-in.  
**Alternative:** embed a Google native client ID and exchange a provider ID token directly from the app.  
**Reason:** production already has a working server-side Google provider. Reusing it reduces provider configuration and keeps the Pack One backend authoritative for account/session issuance. Current Better Auth and Expo guidance supports native social OAuth via system-browser/deep-link returns; Pack One keeps its own handoff layer because the managed auth server is not controlled by the mobile app.  
**Apple:** still blocked on provider configuration; do not present Apple login until the production provider exists.

## 2026-09-20 — Google reauthentication for destructive deletion

**Decision:** a Google-only account can be deleted only after a fresh Google OAuth round trip that resolves to the same Pack One auth user as the currently signed-in account.  
**Mechanism:** deletion OAuth flows are marked with purpose `delete` and the expected Pack One auth-user ID. The callback refuses to mint a handoff if Google resolves to a different user. The deletion endpoint requires the current revocable Pack One account session, the same player identity that initiated reauthentication, and the one-time Google handoff; handoff consumption and account deletion occur in one database statement.  
**UX:** password accounts continue to require the current password. Google-only accounts get an explicit destructive confirmation before the system browser opens. Apple remains unavailable until its provider is configured.

## 2026-09-20 — native practice start idempotency

**Decision:** native non-Daily Draft Run creation uses a client-generated random 256-bit `x-idempotency-key`. The gateway accepts and forwards that header only for `POST /draft/v1/runs`; the Draft Run service stores only the SHA-256 digest and a digest of the normalized start request.
**Retry semantics:** an exact retry returns the original run. Concurrent requests with the same key converge on one row through a player-scoped unique index. Reusing a key for a different environment, custom-set selection, challenge, or QA intent returns `409` rather than silently returning a mismatched run.
**Web compatibility:** the key remains optional server-side so existing browser practice behavior is unchanged. Native practice must always generate a fresh key for each intentional new run and reuse it for retries of that same start attempt.
**Reason:** a mobile timeout can occur after the server commits a practice run but before the response reaches the app. Without a server-side idempotency contract, retrying would create a second run and duplicate analytics/history.
