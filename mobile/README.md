# Pack One mobile

Native iOS/Android client for Pack One, built with React Native + Expo.

## Current milestone

The native client now includes:

- Expo SDK 57 / React Native 0.86 foundation with Expo Router
- SecureStore-backed Pack One player and account sessions
- all three fixed Daily Draft Run environments with server-authoritative scoring
- email and Google account sign-in, guest score claiming, sign-out, and supported account deletion
- native Daily/week/month/all leaderboard views
- native career summary and paginated history
- free-account regular Draft Run practice with rerolls
- server-backed Elite entitlement recognition for Powered Cube and custom-set practice
- a native custom-set picker using only server-approved practice sets
- native How to Play, Scoring, and Method guides
- a live native Sets archive read from the serving corpus
- EAS development, preview, and production profiles

All game selection, scoring, account linking, leaderboard state, career persistence, and entitlement checks remain server-authoritative. Do not add database credentials, Patreon credentials, store credentials, or privileged API secrets to this directory. Any value prefixed with `EXPO_PUBLIC_` must be treated as public.

## Remaining store-readiness work

Sign in with Apple is blocked on Apple provider configuration. Store subscription purchase/restore, production crash diagnostics, and final deep-link/store signing configuration remain separate milestones. Existing Pack One account entitlements can be recognized by the app, but this client does not currently sell or change memberships.

## Environment

Optional public configuration:

- `EXPO_PUBLIC_PACKONE_ENV=development|preview|production`
- `EXPO_PUBLIC_PACKONE_API_ORIGIN=https://api.packone.pro`

The default API origin is the existing first-party Pack One API. Preview/staging can override it in EAS without changing source.

## Checks

```sh
npm install
npm test
```

Routine device builds are intended to run in EAS; local Xcode/Android Studio is not part of the owner workflow.
