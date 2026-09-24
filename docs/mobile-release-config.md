# Pack One mobile release configuration

Updated 2026-09-24.

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

## Artwork

The current 1024×1024 P¹ release icon is committed at `mobile/assets/images/icon.png`.

Before store submission, inspect it on actual devices and in store-preview tooling. Platform-generated masking/cropping must not remove the P¹ mark.

## Signing / store access that remains external

These values are not committed to Git:

- Apple Developer signing certificates/profiles and Team access
- Android upload/signing key material

The verified Apple application record already exists.

Google Play Console now grants app-scoped testing access for `pro.packone.app` to `packone-play-ci@pack-one.iam.gserviceaccount.com`. The remaining Google-side setup is keyless GitHub Actions authentication through Workload Identity Federation. No JSON service-account key should be created or stored in GitHub.

## Store listing URLs

- Marketing: `https://packone.pro/`
- Support/contact: `https://packone.pro/contact/`
- Privacy: `https://packone.pro/privacy/`
- Terms: `https://packone.pro/terms/`

## Intentionally deferred

- Sign in with Apple provider/capability work
- store billing/purchase/restore architecture
- verified Universal Links / Android App Links
- remote crash telemetry


## Google Play CI authentication

The repository contains `.github/workflows/google-play-access.yml`. It is intentionally non-publishing: it authenticates with short-lived GitHub OIDC credentials, creates a temporary Google Play edit for `pro.packone.app`, reads its tracks, and deletes the edit without committing any change.

The workflow uses:

- Google Cloud project: `pack-one`
- service account: `packone-play-ci@pack-one.iam.gserviceaccount.com`
- GitHub repository: `killjoy00/mtg-ev-analyzer`
- OAuth scope: `https://www.googleapis.com/auth/androidpublisher`

The verified Workload Identity Provider is source-controlled as the non-secret resource name `projects/77537515004/locations/global/workloadIdentityPools/github/providers/mtg-ev-analyzer`; no GitHub repository variable or JSON key is required.

The Workload Identity provider must restrict admission to exactly `killjoy00/mtg-ev-analyzer`, and that repository identity must receive only `roles/iam.workloadIdentityUser` on the Pack One service account. Long-lived service-account JSON keys are intentionally not used.


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
    --attribute-condition="assertion.repository == '$REPO'" \
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
