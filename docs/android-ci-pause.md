# Android CI paused — November 16, 2026

Pack One is prioritizing the iOS app. The repository retains all Android
source, Google Play credentials/configuration, version history, signed-release
guards, and test scripts for a possible future restart, but **automatic Android
native builds and screenshots are paused**.

## Default CI behavior

- **Android internal testing** and **Android production bundle** workflows:
  only GitHub's explicit **Run workflow** action can start them. Pull requests
  and release-request file pushes no longer start Android jobs.
- **Mobile store screenshots**: PR, main, and ordinary automated requests
  continue running iPhone/iPad capture where selected. The Android emulator
  capture only runs when explicitly requested using the existing
  `android_only: true` input in a manual or reusable invocation.
- **Mobile exact-main RC smoke**: current-main validation and unsigned iOS
  archive still run. The Android Gradle bundle, manifest audit, and unsigned
  cache population are skipped by default, including on main pushes. A manual
  invocation with `include_android: true` restores that Android job. The
  resulting RC evidence explicitly records whether Android was built and still
  fails closed if a manually requested build fails.
- **Shared mobile/unit tests, iOS TestFlight, browser checks, and iOS native
  screenshots are unchanged.** Some fast shared tests mention Android or
  validate Android release-control source without building an Android app.

This change does **not** unpublish Android, alter Google Play tester groups,
start releases, delete code, or modify the iOS 1.2 TestFlight request.
Other Google Play release-request workflows remain separately protected and
dormant unless a reviewed request file is intentionally changed.

## Resuming Android

When Android development is again a priority, explicitly reinstate the PR
triggers on both dedicated Android workflows, automatic Android screenshot
capture, and automatic Android bundle coverage in the exact-main RC workflow;
review the current Play SDK/target API and app-privacy requirements before
signing or publishing a new binary. Keep the existing branch-protection and
signed-release controls intact.
