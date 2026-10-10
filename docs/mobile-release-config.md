# Pack One mobile release configuration

Updated 2026-10-10 (CDT).

Pack One uses Expo SDK and Expo Prebuild as React Native tooling, but **does not require Expo Application Services (EAS), an Expo account, or an Expo project ID** to build or release the app.

## Production identity

The production identifier is fixed and source-controlled:

- iOS bundle identifier: `pro.packone.app`
- Android application ID: `pro.packone.app`
- App Store Connect app ID: `6814318676`
- App Store SKU: `packone-ios-001`
- App name: **Pack One**

Development and preview native builds use non-store identifiers so they can coexist with the production app:

- development: `pro.packone.development`
- preview: `pro.packone.preview`

The `packone://` custom URL scheme remains unchanged for the current native auth handoff.

## Marketing version

The **first public App Store/Play release target remains 1.0**, with its approval/qualification tracked in #575. TestFlight already has a newer **iOS 1.1 build 100733**; this does **not** indicate a public iOS 1.1 release or an Android 1.1 version.

`mobile/app.json` still provides the Expo base `version: 1.0`. The explicit platform targets in `mobile/store-release.json` currently specify `appStoreVersion: 1.1` and `playVersionName: 1.0`. Production Expo config and CI validate **each platform against its own target**: iOS generated `CFBundleShortVersionString=1.1`, Android generated `versionName=1.0`. Never require the two platforms to share a marketing version; the base Expo value is not evidence of the signed iOS version. See [iOS 1.1 exact-build feature and release inventory](mobile-ios-1.1-testflight-inventory-2026-10-10.md).

## Native generation and local builds

Expo's native tooling can generate the native projects locally:

```bash
cd mobile
npm install
PACKONE_BUILD_PROFILE=production npx expo prebuild --clean
```

After prebuild, the generated `ios/` and `android/` projects can be built with Xcode / Android Studio or Expo's local run commands. No EAS project linkage is required.

Development examples:

```bash
PACKONE_BUILD_PROFILE=development npx expo run:ios
PACKONE_BUILD_PROFILE=development npx expo run:android
```

Production/release compilation requires the normal native platform prerequisites and signing material.

## Release checks

`npm test` validates development, preview, and production Expo config.

`npm run release:check` additionally verifies:

- production iOS identity remains `pro.packone.app`
- production Android identity remains `pro.packone.app`
- no EAS project ID is required
- the production P¹ icon exists
- signed/generated iOS and Android marketing versions match **their own** `mobile/store-release.json` targets, not each other

## Artwork

The current 1024×1024 P¹ release icon is committed at `mobile/assets/images/icon.png`.

Before store submission, inspect it on actual devices and in store-preview tooling. Platform-generated masking/cropping must not remove the P¹ mark.

## Signing / store access that remains external

These values are not committed to Git:

- Apple Developer signing certificates/profiles and Team access
- Android upload/signing key material

The verified Apple application record already exists.

Google Play Console grants app-scoped testing access for `pro.packone.app` to `packone-play-ci@pack-one.iam.gserviceaccount.com`. Keyless GitHub Actions authentication through Workload Identity Federation is configured and the live Play edit probe passed. No long-lived service-account JSON key is needed.

## Store listing URLs

- Marketing: `https://packone.pro/`
- Support/contact: `https://packone.pro/contact/`
- Privacy: `https://packone.pro/privacy/`
- Account deletion: `https://packone.pro/privacy/#delete-account`
- Terms: `https://packone.pro/terms/`

## Free-launch work tracked separately

Sign in with Apple is implemented and tracked for final physical-device / relay / deletion-revocation acceptance in issue #575. It is not treated as post-launch or deferred work.

The minimum verified HTTPS linking needed for profile/share/continuation parity is also a #575 release gate. Native AASA/App Links configuration is implemented; final acceptance still requires the hosted association payloads to match the real Apple Team ID and Google Play app-signing certificate.

## Intentionally deferred

- iOS StoreKit billing/purchase/restore architecture if Patreon-derived digital practice remains gated on iOS; passive external-account OAuth alone is not treated as a 3.1.3(b) exemption
- additional Universal Links / Android App Links coverage beyond the minimum #575 parity routes
- remote crash telemetry beyond store-native diagnostics


## Google Play CI authentication

The repository contains `.github/workflows/google-play-access.yml`. It is intentionally non-publishing: it authenticates with short-lived GitHub OIDC credentials, creates a temporary Google Play edit for `pro.packone.app`, reads its tracks, and deletes the edit without committing any change.

The workflow uses:

- Google Cloud project: `pack-one`
- service account: `packone-play-ci@pack-one.iam.gserviceaccount.com`
- GitHub repository: `killjoy00/mtg-ev-analyzer`
- OAuth scope: `https://www.googleapis.com/auth/androidpublisher`

The verified Workload Identity Provider is source-controlled as the non-secret resource name `projects/77537515004/locations/global/workloadIdentityPools/github/providers/mtg-ev-analyzer`; no GitHub repository variable or JSON key is required.

The Workload Identity provider must restrict admission to `killjoy00/mtg-ev-analyzer` jobs that run from `refs/heads/main` inside the `pack-one-mobile-release` GitHub Environment, and that repository identity must receive only `roles/iam.workloadIdentityUser` on the Pack One service account. Every Google-authenticating job already runs in that environment, and only those jobs request `id-token: write`; pull-request smoke jobs get no OIDC token. Long-lived service-account JSON keys are intentionally not used.


### One-time Google Cloud trust setup

Run the following in Google Cloud Shell while signed into the `pack-one` project owner/admin account:

```bash
set -euo pipefail

PROJECT_ID="pack-one"
REPO="killjoy00/mtg-ev-analyzer"
POOL_ID="github"
PROVIDER_ID="mtg-ev-analyzer"
SERVICE_ACCOUNT="packone-play-ci@pack-one.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID"

gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  androidpublisher.googleapis.com \
  --project="$PROJECT_ID"

if ! gcloud iam workload-identity-pools describe "$POOL_ID" \
  --project="$PROJECT_ID" --location="global" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL_ID" \
    --project="$PROJECT_ID" \
    --location="global" \
    --display-name="GitHub Actions"
fi

if ! gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --project="$PROJECT_ID" --location="global" \
  --workload-identity-pool="$POOL_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --project="$PROJECT_ID" \
    --location="global" \
    --workload-identity-pool="$POOL_ID" \
    --display-name="mtg-ev-analyzer GitHub Actions" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository == '$REPO' && assertion.ref == 'refs/heads/main' && assertion.environment == 'pack-one-mobile-release'" \
    --issuer-uri="https://token.actions.githubusercontent.com"
fi

POOL_NAME="$(gcloud iam workload-identity-pools describe "$POOL_ID" \
  --project="$PROJECT_ID" --location="global" --format="value(name)")"

gcloud iam service-accounts add-iam-policy-binding "$SERVICE_ACCOUNT" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/$POOL_NAME/attribute.repository/$REPO"

gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="$POOL_ID" \
  --format="value(name)"
```

The verified provider resource is `projects/77537515004/locations/global/workloadIdentityPools/github/providers/mtg-ev-analyzer`. The GitHub workflow now uses it directly.

### Narrowing the existing provider

The provider was originally created with the repo-wide condition `assertion.repository == 'killjoy00/mtg-ev-analyzer'`, which admits any workflow on any branch. Narrow it in place (same Cloud Shell variables as above):

```bash
gcloud iam workload-identity-pools providers update-oidc "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location="global" \
  --workload-identity-pool="$POOL_ID" \
  --attribute-condition="assertion.repository == '$REPO' && assertion.ref == 'refs/heads/main' && assertion.environment == 'pack-one-mobile-release'"
```

Then dispatch `google-play-access.yml` from `main`; it must still pass. A token without the `environment` claim (any job outside `pack-one-mobile-release`) or from another ref is rejected by the provider.


## Store build numbering

Publishing jobs treat the stores as the monotonic source of truth. Before Expo Prebuild they query the highest number already accepted by the store and choose:

`max(store_high_water_mark + 1, 100000 + GITHUB_RUN_NUMBER)`

- iOS queries all App Store Connect builds for app `6814318676` and allocates the next `CFBundleVersion`.
- Android opens a temporary Google Play edit, lists all current AABs, and allocates the next `versionCode`; the probe edit is then deleted.
- PR-only smoke builds may still use `100000 + GITHUB_RUN_NUMBER` because they are never uploaded.

This keeps releases monotonic if a workflow file is renamed/replaced (which resets that workflow's run counter) and also makes a rerun advance past any number the earlier attempt already uploaded. The run-number formula is only a floor, not the publishing source of truth.

The values are injected through `PACKONE_IOS_BUILD_NUMBER` and `PACKONE_ANDROID_VERSION_CODE`. Config validation asserts that the requested values reach the generated Expo config. The iOS export disables Xcode's automatic build-number rewriting so the CI-assigned number is preserved.

## Minimum supported native versions

The production growth service exposes a public `GET /v1/mobile/version` compatibility check. The installed native app sends its platform, native marketing version, and native build number. Server authority lives in the Neon `settings` row `mobile_minimum_supported_versions_v1`; the initial policy is non-disruptive at `1.0` / build `1` for both platforms and can be raised later without shipping another client.

The native root layout blocks navigation only for the initial cold-start check. Once an allowed decision has mounted navigation, foreground resumes revalidate in place without replacing the navigation tree with a checking screen; only a validated response requiring an update swaps in the non-dismissible update-required gate linked to the official App Store or Play listing. Foreground checks are sequenced so an older overlapping response cannot overwrite a newer decision. Transport failures, 5xx responses, malformed responses, and unavailable native metadata fail open so a temporary version-service outage cannot strand otherwise supported clients. Store binaries read the actual native values through `expo-application`, not Expo manifest metadata.

## Store publishing boundary

The publishing workflows run only from reviewed `main` and require their checkout to equal current `origin/main`. Uploads may be triggered **by a reviewed release-request file on main or an explicitly authorized main dispatch**, not by feature-branch PR checks. They use the `pack-one-mobile-release` Environment. Uploading a signed build to Apple **does not** itself submit App Review, create a missing App Store 1.1 version, or release publicly; uploading an Android AAB to Play's bundle library **does not** assign a track. The latest exact-build and no-track-mutation evidence is in [iOS 1.1 exact-build feature and release inventory](mobile-ios-1.1-testflight-inventory-2026-10-10.md).

Current protected boundary: the `pack-one-mobile-release` Environment is main-only, and Google Workload Identity Federation has been narrowed to the repo, main ref and protected release context (verified by the [Google Play probe](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/37017937127)). The owner has **explicitly declined** re-scoping existing Apple release secrets solely for this purpose; do not relabel it as outstanding owner work absent a new decision. Repository checks alone do not substitute for the established external IAM/Environment restrictions.

## Review deadlines for deferred items

- **Export compliance:** the current internal TestFlight build may show Missing Compliance. The owner must answer App Store Connect's encryption questions before internal installation if Apple blocks the build. Source-control `ITSAppUsesNonExemptEncryption=false` only after the owner explicitly confirms that declaration is correct for the app.
- **External TestFlight / App Store review:** Sign in with Apple is implemented for native iOS and is also available through Pack One's web authorization flow for Android/web continuity. The secure-auth release requires repository secrets `APPLE_TEAM_ID`, `APPLE_SIGN_IN_KEY_ID`, `APPLE_SIGN_IN_KEY_P8`, and the independent 32-byte hex token-encryption key `APPLE_TOKEN_ENCRYPTION_KEY_V1`. The token key is versioned separately so routine rate-limit-secret rotation cannot make stored Apple refresh tokens unreadable. The exact public release candidate still needs physical-iPhone verification and the then-current App Review requirement re-check.
- **Apple Private Email Relay:** register Pack One's exact outbound email source/domain under Apple Developer → Sign in with Apple for Email Communication and verify SPF/DKIM before launch. Apple relay users can use legacy `privaterelay.appleid.com` or new `private.icloud.com` addresses. Apple-linked account deletion does **not** depend on relay email: Pack One requires a fresh Apple authorization bound to the existing Apple subject before deletion. Relay delivery still needs a real-device/inbox test because account/recovery communications to an unregistered sender can bounce.
- **Physical iPhone SIWA validation:** on the exact public RC, verify (1) first sign-in with both shared email and Hide My Email, (2) a real Pack One email reaches the relay address, (3) Apple re-authentication can permanently delete the Apple-linked account and the authorization is revoked, (4) the deleted Apple authorization cannot be reused, and (5) the Sign in with Apple control is at least as prominent as the Google control. The current native layout renders both social controls full-width at the same 52-point height.
- **Payments / Patreon access:** native purchase steering is removed and Patreon is presented only as existing-account OAuth. That presentation hardening does **not** settle Apple payment eligibility. Pack One is not a Reader app, and current 3.1.3(b) requires externally acquired digital features to also be available as IAP. Before App Store review, either ship equivalent StoreKit access, make/disable those premium practice modes on iOS so no external purchase unlock is required, or obtain explicit Apple confirmation of another applicable exception.
- **Production Google Play:** run **Narrowing the existing provider** before granting any production-release permission.
