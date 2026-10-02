# Pack One mobile release runbook

Updated 2026-10-01.

This is the owner runbook for Pack One mobile releases. It covers normal releases, emergency fixes, rollback/containment, and the external release-security boundary.

## Plain-English meaning of the release-security requirement

The goal is simple: **a random branch, pull request, or compromised workflow should not be able to publish Pack One using Apple/Google release credentials.**

Repository code already enforces:
- publishing only from `main`
- checked-out commit must still equal current `origin/main`
- publishing jobs use the `pack-one-mobile-release` GitHub Environment
- PR jobs are validation-only and cannot publish
- release-request files create reviewed, auditable triggers

The final external evidence is outside Git:
1. Protect the `pack-one-mobile-release` GitHub Environment with the desired reviewer/branch rules.
2. Store Apple release secrets at that protected environment boundary, not as generally usable repository secrets.
3. Narrow Google Workload Identity so the Google service account accepts only the protected release-context OIDC subject, not every workflow in the repository.
4. Re-run the non-publishing Apple/Google access probes after the change.

Until those account-level settings are verified, the code is fail-closed but the cloud credential boundary is broader than ideal.

## Plain-English meaning of the release-operations requirement

This is not more product engineering. It is the written checklist for:
- how to ship the next version
- how to issue a hotfix
- how to stop a bad release
- how to force old clients to update if the backend must retire them

This file satisfies that operational-documentation requirement.

## Versioning

- User-facing marketing version is shared across iOS and Android.
- `1.0` remains `1.0` while uploading replacement release-candidate builds.
- Change the marketing version only for a new store version (for example `1.0.1` or `1.1`).
- iOS `CFBundleVersion` and Android `versionCode` advance for every store upload.
- Store-aware allocators choose monotonic build numbers/codes and must remain the source of truth.

## Exact-main source freeze before signed candidates

Before either platform's final signed candidate is uploaded:

1. Freeze the intended release source on reviewed `main`, including mobile code, release-workflow changes, release documentation, and any product data/source changes that must ship with v1.
2. Run the store-free `Mobile exact-main RC smoke` workflow for that exact `main` SHA.
3. Require all four stages to pass: exact-main deterministic validation, unsigned iOS production archive, Android production bundle, and the final evidence job that re-fetches `main` after both native builds.
4. Record the SHA/version/artifact evidence in #575.
5. Treat later `main` movement as invalidating final-source status **only when it changes shipped application/runtime code, native configuration, dependencies, build inputs, or release behavior that affects the binary**. Documentation-only and store-control-only changes do not require a new binary when a reviewed compare proves the shipped app bits are unchanged; record that equivalence in #575.

The store-free smoke proves source/build reproducibility only. It never substitutes for signed store processing or physical-device acceptance.

## Pack One 1.0 current release checkpoint

As of 2026-10-01:
- iOS current post-#837 candidate: build `100415`, source `fa588b40bc380946735385abfac0ff52586e1873`. Run `36957484955` completed successfully; App Store Connect reports `VALID` + `APP_STORE_ELIGIBLE`, and build `100415` is attached to App Store version 1.0.
- Android current post-#837 build artifact: versionCode `100444`, same source revision. Run `36957485029` built and signed the production AAB and verified the registered Play upload certificate. It is not yet uploaded/promoted.
- Android live qualification-track release remains versionCode `100368` on `production-access` with `releaseStatus=completed`. Upload/promote `100444` unchanged before final Android physical acceptance/submission.
- Apple first public app availability was set manually to **United States + Canada only** on 2026-10-01. The guarded repo path is now read-only verification only.
- Owner-only non-device console/account steps are maintained in `docs/mobile-store-submission.md`. Physical-device acceptance remains separate.

## Apple Elite subscription prerequisites

Before an iOS candidate can be treated as release-ready:

- App Store Connect must contain an auto-renewable subscription in a Pack One Elite subscription group with product ID `pro.packone.app.elite.monthly`.
- The App Store, not the binary, owns the live price and billing-period display. Configure the intended territory pricing and localization in App Store Connect and attach the subscription to the app version as required.
- Configure App Store Server Notifications V2 for both Production and Sandbox to `https://api.packone.pro/growth/v1/apple-subscriptions/notifications`.
- The subscription must be cleared for sale/testing under the required Apple agreements, tax and banking state.
- Do not treat a successful StoreKit sheet as entitlement proof. The backend must verify the Apple-signed transaction before the app finishes the transaction; gameplay continues to authorize only through server capabilities.
- Patreon/manual and Apple grants are independent sources. An Apple cancellation, expiry, refund or revocation must never remove a valid Patreon/manual grant.

## iOS normal release

1. Merge application changes to reviewed current `main`.
2. Update the TestFlight release-request file through a reviewed PR.
3. Merge only after required CI is green.
4. The guarded TestFlight workflow allocates a new App Store build number, signs the exact current-main revision, uploads an App Store-eligible TestFlight build, waits for App Store Connect processing, requires `VALID` + `APP_STORE_ELIGIBLE`, and attaches that exact build to the editable App Store version.
5. Wait for Apple processing.
6. Install that exact build on a physical iPhone.
7. Run the physical acceptance checklist: Dailies, practice, account flows, Apple/Google/email sign-in, career/leaderboard, share, relaunch/resume, slow-network sanity, accessibility basics, deletion, upgrade continuity, and Apple Elite subscribe/restore/manage.
8. Confirm Sign in with Apple Hide My Email delivery and Apple-confirmed account deletion/revocation. Separately exercise StoreKit Sandbox/TestFlight renewal, cancellation-at-period-end, billing grace, refund/revocation, Restore Purchases, same-account binding, wrong-account rejection, and duplicate-provider protection.
9. In App Store Connect version 1.0, attach that exact build.
10. Fill metadata from `docs/mobile-store-submission.md`.
11. Confirm the already-completed App Store availability setting remains **United States + Canada only** using the repo's read-only availability verifier; do not enable pre-order.
12. Select **Manually release this version**.
13. Submit for App Review.
14. After approval, keep the app in Pending Developer Release until the owner explicitly approves launch.
15. Manually release.

## Android normal release

1. Merge application changes to reviewed current `main`.
2. Update the Android internal-release request file through a reviewed PR.
3. Merge only after CI is green.
4. The guarded workflow allocates a new Play-safe `versionCode`, builds/signs the AAB, and uploads it to Internal Testing.
5. Verify the exact internal-track version through the read-only status workflow.
6. Install on a representative physical Android device and run the same product/account/upgrade acceptance pass.
7. Complete the Play App content and listing fields from `docs/mobile-store-submission.md`.
8. Publish the approved build to the Pack One `production-access` Closed Testing track.
9. Confirm installability through the tester opt-in flow and complete any Play production-access qualification period.
10. Apply for Production access when eligible.
11. For the first public production release, use the selected production countries. Google does not offer a percentage staged rollout for the first release.
12. For later Android updates, use a staged rollout when appropriate and increase only after reviewing Android Vitals / crash / ANR signals.

## Hotfix

### iOS

1. Fix the issue on a branch, review it, and merge to current `main`.
2. Upload a new build under the existing marketing version when Apple permits it; otherwise create the next patch version.
3. Validate the smallest relevant physical-device acceptance set plus all security/account flows touched by the fix.
4. Submit the replacement build.
5. For a qualifying urgent production problem, request Apple expedited review using Apple's current App Review process.
6. Keep manual release enabled so approval does not automatically ship before owner approval.

### Android

1. Fix, review, and merge to current `main`.
2. Produce a new monotonically higher `versionCode`.
3. Validate internally first.
4. Promote through the appropriate testing/production path.
5. For updates after the initial release, start with a staged rollout when practical.

## Stop / rollback / containment

### Before Apple release
- With manual release selected, simply do not click Release This Version.
- If a release action was initiated but should not proceed, cancel it in App Store Connect if the current state permits.

### After Apple release
- Ship a corrected build/version through App Review.
- If an unsafe old client must be retired, raise the server-controlled minimum supported iOS version/build only after the replacement is actually available in the App Store.

### Google Play
- Before publish, use Managed Publishing to keep approved changes from going live.
- For later staged updates, halt/pause the rollout if metrics or acceptance show a problem.
- Google can halt a fully rolled-out release when there is a prior version to restore, but the first release on a track cannot be halted back to a prior version because none exists.
- If an unsafe old client must be retired, raise the server-controlled minimum supported Android version/build only after the replacement is available to affected users.

## Force-update emergency procedure

1. Do not raise the minimum-supported version merely because a new build exists.
2. Confirm the replacement build is available to the intended store population.
3. Verify the replacement's cold-start version check succeeds.
4. Raise the Neon `mobile_minimum_supported_versions_v1` floor to the replacement marketing/build version.
5. Confirm the old version shows the blocking update-required screen and the replacement remains allowed.
6. Record the exact old/new versions, reason, time, and store availability evidence in the release issue.

## Evidence retained for every release

Record in the mobile tracker:
- merge commit SHA
- store marketing version
- iOS build number / Android versionCode
- CI run IDs
- signing/upload success
- store processing/status result
- physical-device acceptance result
- forced-update check result
- store submission/review status
- final release time and countries
- any rollback/hotfix action
