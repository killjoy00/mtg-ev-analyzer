# Mobile Phase 0 — architecture audit

As of 2026-09-19. Scope is deliberately short: facts needed to build the native client safely.

## Current production map

**Browser.** GitHub Pages serves a flat JavaScript/MJS/CSS application. The current visual system is the light tournament/editorial treatment in `visual-c.css`: Source Sans/Barlow on web, square card treatments, navy accent (`#1e4d7a`), white surfaces, and `#f7f8fa` page background.

**API.** `api.packone.pro` is the first-party gateway. It routes to three Neon Functions: `pack1api` (legacy scores/challenges), `pack1growth` (guest/profile/account/Patreon/analytics), and `draftrunapi` (Draft Run/Dailies/Cube). Backend releases are separate from GitHub Pages releases.

**Data.** Neon Postgres is authoritative for accounts, capabilities, sessions, results, schedules and corpus state. Card metadata/images are stored with Pack One puzzle data and sourced from Scryfall; the client should consume stored HTTPS image URLs rather than query Scryfall per pick.

**Game.** The live product is an eight-decision Draft Run family: mixed Daily, Powered Cube Daily, Latest Set Daily, plus authenticated practice and Elite custom-set/Cube capabilities. `draftrunapi` already exposes run start/resume, pick, reroll, view, share, leaderboard, set catalog, capabilities and daily status. Scoring stays server-authoritative.

**Identity.** Production web auth now uses first-party, host-scoped Secure/HttpOnly account and player cookies with CSRF on writes. Google sign-in is live on web. Legacy bearer/session compatibility remains in backend code. Apple sign-in is not implemented. Mobile must not copy the browser-cookie model or store credentials in AsyncStorage; it needs a native token/session exchange backed by SecureStore.

**Entitlements.** Patreon is already a linked provider, not the Pack One identity. Effective capabilities are represented server-side and can outlive/disconnect independently by grant source. This is the correct base for adding Apple/Google billing sources later; do not create a separate “mobile Elite” truth.

**Monetization.** Patreon linking is live. Google display ads remain disabled. TCGplayer affiliate routing is active on web. Mobile billing is intentionally not part of the foundation PR.

**Instrumentation.** Web gameplay/retention events and extensive backend/release diagnostics exist. No native crash-reporting SDK exists yet; adding a paid service requires owner approval.

## Native API work

Read-only service/catalog routes are structurally reusable. Browser account routes are not native-ready because their security contract is cookie + CSRF + trusted web origin. A legacy guest token route exists, but Phase 2 must prove the exact production-gateway behavior before making it the native contract.

Additive native work should therefore:

1. establish a provider-independent mobile session token issued by Pack One, stored only in SecureStore;
2. resolve both guest and authenticated sessions to one server-side subject identifier;
3. accept native bearer auth on the narrow mobile-safe routes while preserving browser cookies unchanged;
4. add idempotency keys to run creation, pick/reroll, result/claim, linking and deletion mutations;
5. add a short-TTL, single-use, guest-session-bound run-claim token for guest → account conversion;
6. add account deletion plus explicit deletion/anonymization rules.

No direct Neon access belongs in the binary.

## Repository decision

Add `/mobile` beside the existing site. Do **not** move the web application into `/apps/web` now. Shared packages can be extracted only when mobile actually needs code that is safe and framework-independent. This minimizes regression risk to a live flat-site deployment.

Foundation uses stable Expo SDK 57 / React Native 0.86, Expo Router, development builds and EAS. SDK 58 is beta as of this audit and is not the release baseline.

## Phase 2 performance targets

Measure release-mode builds on a named mid-tier Android device and a real iPhone.

- **Pick confirmation → next decision interactive:** p95 ≤ **900 ms** on warm network.
- **Next decision primary card images ready:** p95 ≤ **1.5 s**; UI must remain usable while individual images finish.
- **Interaction/transition rendering:** sustained **≥55 fps** on a 60 Hz mid-tier Android device during card selection and next-pick transition.
- **Cold launch → usable home:** p95 ≤ **2.5 s**, excluding a required OS-level auth handoff.

These are targets, not measurements. Phase 2 must publish device names, release build identifiers and measured results.

## Risks that drive order

1. Native identity cannot safely reuse the web cookie contract.
2. Draft Run image/performance behavior must be proven on real Android hardware early.
3. Guest-completion claiming is new behavior relative to today’s “guest start stays unranked” web contract.
4. Account deletion is absent and is a store-review blocker.
5. Store billing/link behavior is policy- and storefront-dependent; implement only after owner/store prerequisites are confirmed.
