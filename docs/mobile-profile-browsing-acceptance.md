# Native profile browsing and privacy acceptance

Tracker: #575. This batch extends public-profile browsing and fixes the private Career account-switch boundary. It does not certify full profile/archive/sharing parity or a public release.

## Private Career contract

A loaded account A record may survive a temporary refresh failure only after secure storage confirms that A is still the current identity. When account B is observed, A's profile, history cursor, rows, and sharing controls must be removed before B's requests finish. A failed B request cannot restore A. Session notifications invalidate outstanding requests; reads recheck persisted identity after asynchronous responses and before pagination/sharing. If secure storage is unreadable, the private record is removed rather than assuming that the old identity is still current.

Late initial-load, pagination, error, and share-preflight results are scoped to their request generation. A stale unauthorized response cannot clear the newer account's mounted record. Current-session authentication errors show sign-in without deleting stored credentials or changing any server session. Pagination retains loaded rows for transient failures, exposes explicit retry, suppresses duplicate in-flight requests, deduplicates within and between pages, and stops cyclic cursors.

The existing mounted Career identity regression retains every assertion. Its mock now supplies the persisted session and subscription boundary that the production screen consumes.

## Public browsing contract

Public browsing uses the existing GET `/growth/v1/profile/<16-hex>` and `/history` endpoints. It does not create a guest session or send native player/account headers. The shared request client supports explicit `credentials: omit` for these requests without changing authenticated callers' defaults. Server opt-in and public-key validation remain authoritative; no gateway/backend route or authorization policy is expanded.

Changing the route key creates a new mounted browsing scope immediately. Previous profile data and actions must not remain visible while the next key loads. Foreground/focus and explicit refresh revalidate the same key. A transient failure may preserve that key's loaded public view, but 401/403/404/410, private responses, or mismatched identity payloads remove the entire cached profile and history.

The public screen now exposes cursor-paginated recent games, mode/grade/outcome detail, explicit history retry, and canonical public-profile sharing. Sharing performs a fresh opt-in read first; a failed or revoked preflight cannot open the share sheet. The link contains only the public key. It is also selectable using the platform's text selection UI; this is not a custom clipboard button or an image-share-card implementation.

Public record details include the server-provided favorite environment, unlocked showcase label, best final Daily percentile, mode breakdown, and all returned played-environment counts/averages/bests/Daily counts/last-played dates. This is not a claim that unplayed catalog exploration, full achievement badge/share behavior, individual Daily sharing, or every web trend visualization is complete.

## Automated evidence

- `mobile/tests/public-profile-api.test.cjs`: actual public API and shared request-client modules; public-only routes, omitted credentials, invalid keys/cursors, private/mismatched/malformed payloads, preserved privacy HTTP status, canonical URLs, and unchanged authenticated-client defaults.
- `mobile/tests/profile-browsing.test.cjs`: mounted production Career, PublicProfile, ProfileOverview, API adapters, guest/session and secure-storage modules; mock only transport, native platform/configuration, and router lifecycle boundaries. Cases cover failed account switches, silent persisted identity changes, sign-out, locked storage, late responses, pagination retry/deduplication/cycles, route changes, privacy revocation, share preflight, and record details.
- All 60 existing mobile cases remain in `npm test`; no lint, TypeScript, configuration, release preflight, or prior assertion is disabled.

Record actual CI results on the exact head/merge ref in #575. Local TypeScript transpilation checks syntax, not full project type safety. A passing API-only test is not evidence that the React suites executed. Mocked network/navigation tests do not certify live backend visibility or physical-device acceptance.

## Exact-candidate acceptance still required

On iPhone, iPad, and Android, switch accounts with a private Career open, interrupt the new account's network, and verify that the old record and share controls disappear. Repeat while loading a page, while opening a share sheet, on sign-out, and with a locked/unavailable secure store. Verify same-account offline recovery preserves the intended view.

Open public profiles from leaderboard and external links as both a guest and a signed-in player. Switch rapidly between keys, page through history, retry a failed page, and change the subject's public visibility on another device before refreshing, paginating, or sharing. Verify that newly private content disappears and a revoked share preflight cannot open. Check large text, long names/outcomes, Back behavior, keyboard/screen-reader order, real platform text selection and share-sheet cancellation, and iPad layout on the exact RC.

No production deployment request, database migration, entitlement/scoring change, store upload, dependency upgrade, or minimum-supported-version change is included. The broader #575 parity and release gates remain open.
