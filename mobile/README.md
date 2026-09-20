# Pack One mobile

Native iOS/Android client for Pack One, built with React Native + Expo.

## Current milestone

Foundation only. The app currently provides:

- Expo SDK 57 / React Native 0.86 foundation
- Expo Router navigation
- Pack One design tokens carried from the web visual system
- typed API transport with timeouts, bearer-token support and idempotency-key support
- SecureStore-only session persistence
- a guest Daily Draft Run vertical slice (guest session → start/resume → choose → confirm → feedback → next pick → result)
- EAS development/preview/production profiles

The current vertical slice uses the existing guest player-session authority through a gateway-scoped mobile-session header. Account authentication and guest-result claiming are the next milestones. Do not add database credentials, Patreon credentials, store credentials, or privileged API secrets to this directory. Any value prefixed with `EXPO_PUBLIC_` must be treated as public.

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
