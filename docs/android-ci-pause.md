# Android routine CI paused — November 16, 2026; scoped release lane resumed November 18

Pack One is prioritizing the iOS app. The repository retains all Android
source, Google Play credentials/configuration, version history, signed-release
guards, and test scripts for a possible future restart, but **automatic Android
native builds and screenshots are paused**.

## Default CI behavior

- **Android Internal Testing** remains manual-only. A routine mobile
  source or documentation change cannot start its native or Play upload jobs.
- **Android production bundle** can start by explicit **Run workflow** or by a
  reviewed change to `.github/android-production-bundle-request.json` merged
  into protected `main`. The only automatic Android PR smoke is scoped to
  that release request or its own workflow, and has no signing credentials.
  Routine mobile PRs and pushes still do not start Android Gradle. The protected
  bundle job signs and audits an AAB but does **not** upload it to Google Play;
  the separate exact-artifact release request is required for any track change.
- **Native UX baseline evidence**: the old-Android-baseline reproduction job is
  also manual-only. It no longer starts on PRs that change its workflow/script.
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
Google Play release-request workflows remain separately protected; the
exact-artifact import/promotion must independently pin the signed source SHA,
artifact ID, digest and version code, then target only the existing Closed
Testing track. Public Production must not be changed by this workflow.

## Resuming Android

When Android development is again a priority, explicitly reinstate the PR
triggers on both dedicated Android workflows, automatic Android screenshot
capture, and automatic Android bundle coverage in the exact-main RC workflow;
review the current Play SDK/target API and app-privacy requirements before
signing or publishing a new binary. Keep the existing branch-protection and
signed-release controls intact.
