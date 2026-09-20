# Pack One mobile release configuration

Updated 2026-09-20.

This document separates values that can be committed safely from irreversible store identity and signing values that must come from the owner accounts.

## Implemented in source

- Development builds use the display name `Pack One Dev` and non-store identifier `pro.packone.development`.
- Preview builds use the display name `Pack One Preview` and non-store identifier `pro.packone.preview`.
- Production builds use the display name `Pack One`.
- The `packone` custom URL scheme remains shared across profiles because the existing Google handoff currently returns to that scheme.
- EAS profiles explicitly select development, preview, and production environments.
- EAS remote app-version management is enabled, and production builds auto-increment developer-facing build versions.
- A production Expo config fails closed until the final iOS bundle identifier, Android package, and Expo project ID are provided.
- Mobile CI validates development, preview, successful production-shaped config, and the missing-production-identity failure case.

## Production EAS environment values still required

Create these as plain-text values in the EAS **production** environment. They are identifiers, not secrets.

- `PACKONE_IOS_BUNDLE_IDENTIFIER` — final App Store bundle identifier. Do not change it after release.
- `PACKONE_ANDROID_PACKAGE` — final Google Play application ID. Do not change it after release.
- `PACKONE_EXPO_PROJECT_ID` — UUID of the Expo/EAS project after it is linked.

The repository intentionally does not guess these values.

## Signing values still required later

These are not committed to Git.

- Apple Developer Team ID and signing credentials
- App Store Connect application record / numeric app ID
- Android upload/signing key material and resulting SHA-256 fingerprint
- Google Play service-account access if automated submission is enabled

The Apple Team ID and Android signing certificate are also needed before verified Universal Links / Android App Links can be published.

## Release artwork

The repository did not contain a reusable logo/favicon/app-icon source when this milestone began, so production artwork is intentionally not fabricated here.

Before a store build, add:

- `mobile/assets/images/icon.png` — square 1024×1024 PNG
- `mobile/assets/images/splash-icon.png` — transparent 1024×1024 PNG
- `mobile/assets/images/adaptive-icon.png` — Android adaptive foreground PNG
- `mobile/assets/images/monochrome-icon.png` — Android 13+ themed icon source

Then configure those paths in the Expo app config and add the `expo-splash-screen` config plugin. Test the splash screen in a preview or production build, not Expo Go/development-client rendering.

## Store listing URLs already available

- Marketing: `https://packone.pro/`
- Support/contact: `https://packone.pro/contact/`
- Privacy: `https://packone.pro/privacy/`
- Terms: `https://packone.pro/terms/`
- Disclosure: `https://packone.pro/disclosure/`

## Draft store identity copy

- App name: **Pack One**
- Subtitle / short positioning: **Draft Decision Trainer**
- Category direction: strategy/card-game training
- Website: `https://packone.pro/`

Store descriptions, screenshots, age/content ratings, privacy labels/data-safety declarations, and subscription metadata should be reviewed as a separate submission milestone after billing, Apple sign-in, and remote diagnostics decisions are final.
