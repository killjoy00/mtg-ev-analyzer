// Production API hosts that browser e2e tests must never reach (#803). Kept apart
// from tests/e2e-production-guard.mjs so a unit test can check it against
// leaderboard-config.js without importing Playwright.
export const PRODUCTION_API_HOST=/(^|\.)neon\.tech$|^api\.packone\.pro$/i;

// Chromium resolves these hosts to nothing. That also stops requests no route
// intercepts: in local runs these were mostly /v1/events analytics posts that
// bypassed even tests which stub the whole API host.
export const CHROMIUM_RESOLVER_RULES='--host-resolver-rules=MAP *.neon.tech ~NOTFOUND, MAP api.packone.pro ~NOTFOUND';
