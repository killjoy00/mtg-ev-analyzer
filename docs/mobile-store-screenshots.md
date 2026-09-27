# Pack One store screenshot environment

Updated 2026-09-27.

This environment exists only to produce deterministic store-submission screenshots from the real native Expo / React Native screens. It does not replace exact-RC device acceptance.

## Safety boundary

Screenshot fixtures are enabled only when EXPO_PUBLIC_PACKONE_SCREENSHOT_MODE=1 and the public Pack One environment is not production. The production release preflight fails immediately if screenshot mode is present, so fixture data cannot be used in a shipping store build.

All screenshot API calls fail closed. If a screen requests an endpoint that has no explicit fixture, the screenshot build throws instead of falling through to api.packone.pro.

## Scenes

The harness captures:

1. Daily decision
2. Reveal / trophy comparison
3. Daily hub
4. Practice
5. Career
6. iOS Membership / App Review subscription screenshot

The iOS Membership scene uses the production Membership component with a screenshot-only StoreKit adapter that displays the approved business price, $7.00 per month, and the Subscribe, Restore Purchases, and Manage Apple Subscription controls. The shipping iOS build continues to read its localized price from StoreKit.

## GitHub Actions

Run the Mobile store screenshots workflow, or update .github/mobile-store-screenshots-request.json on main.

The workflow builds the preview application, never the production store identifier, and uploads:

- pack-one-ios-store-screenshots: iPhone 6.9/6.7-inch-compatible captures plus iPad 13/12.9-inch-compatible captures and the subscription-review capture.
- pack-one-android-store-screenshots: five phone captures from the same deterministic native scenes.

The iOS capture script validates every image against the accepted Pack One target dimensions before upload.

## Local capture

From mobile:

- npm run screenshots:ios:capture -- /path/to/PackOne.app
- npm run screenshots:android:capture -- /path/to/app-release.apk

Build the app with PACKONE_BUILD_PROFILE=preview, EXPO_PUBLIC_PACKONE_ENV=preview, and EXPO_PUBLIC_PACKONE_SCREENSHOT_MODE=1 before running either capture command.

These screenshots are suitable for store artwork generation and metadata setup. Final release acceptance still uses the exact signed RC on physical devices as tracked in #575.
