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
- `packone://` deep links for every Expo Router screen
- native rewriting of Pack One web-style Daily, leaderboard, account, How to Play, Scoring, Method, and Sets links
- navigator-level crash-safe screen recovery and a native stale-link/not-found screen
- cross-platform safe-area handling for iOS and Android edge-to-edge layouts
- foreground revalidation for Dailies, practice access, career, and leaderboard state
- accessible Draft Run progress/feedback, press-and-hold card zoom, and native result sharing
- EAS development, preview, and production profiles
- environment-aware app identity with non-store dev/preview IDs and fail-closed production identity
- remote EAS build-number management with production auto-increment

All game selection, scoring, account linking, leaderboard state, career persistence, and entitlement checks remain server-authoritative. Do not add database credentials, Patreon credentials, store credentials, or privileged API secrets to this directory. Any value prefixed with `EXPO_PUBLIC_` must be treated as public.

## Remaining store-readiness work

Sign in with Apple is blocked on Apple provider configuration. Store subscription purchase/restore and production remote crash diagnostics remain separate milestones. Final App Store/Play identifiers, Expo project linkage, and approved icon/splash artwork are explicit release inputs; see `../docs/mobile-release-config.md`. Physical-device verification for VoiceOver/TalkBack, large text, rotation, keyboard behavior, and the smallest supported screens is still required before beta. Custom-scheme deep links and Pack One web-URL rewriting are implemented; verified iOS Universal Links and Android App Links still require the final bundle/package identities plus Apple Team ID and Android signing certificate. Existing Pack One account entitlements can be recognized by the app, but this client does not currently sell or change memberships.

## Environment

Public runtime configuration:

- `EXPO_PUBLIC_PACKONE_ENV=development|preview|production`
- `EXPO_PUBLIC_PACKONE_API_ORIGIN=https://api.packone.pro`

Release/build configuration:

- `PACKONE_BUILD_PROFILE` is set by `eas.json`.
- Production EAS environment must provide `PACKONE_IOS_BUNDLE_IDENTIFIER`, `PACKONE_ANDROID_PACKAGE`, and `PACKONE_EXPO_PROJECT_ID`.
- Development and preview use non-store identifiers so CI and internal builds never reserve or accidentally ship a guessed production identity.

The default API origin is the existing first-party Pack One API. Preview/staging can override it in EAS without changing source.

## Checks

```sh
npm install
npm test
```

Routine device builds are intended to run in EAS; local Xcode/Android Studio is not part of the owner workflow.
