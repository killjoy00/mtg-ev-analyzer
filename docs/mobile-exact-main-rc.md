# Exact-main mobile RC smoke

Tracking: #575.

The `Mobile exact-main RC smoke` workflow exists to validate the exact current `main` revision without publishing anything to App Store Connect or Google Play.

It is manual-only and fails closed unless the checked-out SHA still equals current `main`. It runs the full deterministic mobile test/lint/typecheck/config/preflight suite, creates an unsigned production iOS archive, creates a production Android bundle, verifies version metadata/signature structure, and uploads those artifacts plus a source-SHA manifest to GitHub Actions.

The workflow intentionally has no App Store Connect, Google Play, distribution-certificate, upload-key, or mobile-release-environment credentials. Its artifacts are build evidence only: the iOS archive is unsigned and cannot substitute for a TestFlight/device build, and the Android smoke bundle is not evidence of Google Play app-signing identity.

A successful run therefore closes the reproducible exact-main build-evidence gap but **does not** close physical iPhone/iPad/Android acceptance, HTTPS association-file verification, storefront/purchase-policy review, signing identity verification, or store publication.
