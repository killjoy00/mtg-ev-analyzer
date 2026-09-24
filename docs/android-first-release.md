# Pack One Android first-release signing

Pack One's Google Play application `pro.packone.app` is currently unpublished.

The production AAB build is verified, but Google Play rejected Internal App Sharing with `FAILED_PRECONDITION: NOT_PUBLISHED`. The bootstrap distribution path is therefore a normal **Internal Testing** draft release.

## Signing boundary

The first Play bundle uses a stable, dedicated Pack One upload key. The upload key is not committed to Git and is not pasted into chat.

The release workflow reads two secrets from Google Secret Manager through the already-configured GitHub Workload Identity Federation:

- `packone-android-upload-keystore-b64`
- `packone-android-upload-password`

The fixed key alias is `packone-upload`. CI reads version `1` of both secrets explicitly; rotating the upload key therefore requires a deliberate workflow change rather than silently following `latest`.

## One-time upload-key setup

Run this in Google Cloud Shell while authenticated to the `pack-one` project. The script:

- enables Secret Manager
- stops if either target secret already exists
- generates a new PKCS12 upload key
- keeps the random password only in a private temporary file
- stores both values directly in Secret Manager as version 1
- grants `packone-play-ci@pack-one.iam.gserviceaccount.com` accessor rights only on those two secrets
- removes the local keystore/password on exit
- deletes any secrets it created if setup fails before completion
- prints only the safe SHA-256 certificate fingerprint

```bash
set -euo pipefail
umask 077

PROJECT_ID="pack-one"
SERVICE_ACCOUNT="packone-play-ci@pack-one.iam.gserviceaccount.com"
KEYSTORE_SECRET="packone-android-upload-keystore-b64"
PASSWORD_SECRET="packone-android-upload-password"
KEY_ALIAS="packone-upload"

gcloud config set project "$PROJECT_ID"
gcloud services enable secretmanager.googleapis.com --project="$PROJECT_ID"

for SECRET in "$KEYSTORE_SECRET" "$PASSWORD_SECRET"; do
  if gcloud secrets describe "$SECRET" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "STOP: Secret already exists: $SECRET"
    echo "Do not create a second version. Inspect the existing secret before continuing."
    exit 1
  fi
done

WORKDIR="$(mktemp -d)"
CREATED_SECRETS=()
SETUP_COMPLETE=0

cleanup() {
  rm -rf "$WORKDIR"
  if [[ "$SETUP_COMPLETE" != "1" ]]; then
    for SECRET in "${CREATED_SECRETS[@]:-}"; do
      gcloud secrets delete "$SECRET" --project="$PROJECT_ID" --quiet >/dev/null 2>&1 || true
    done
  fi
}
trap cleanup EXIT

openssl rand -hex 32 > "$WORKDIR/password"

keytool -genkeypair \
  -keystore "$WORKDIR/packone-upload.p12" \
  -storetype PKCS12 \
  -alias "$KEY_ALIAS" \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000 \
  -storepass:file "$WORKDIR/password" \
  -keypass:file "$WORKDIR/password" \
  -dname "CN=Pack One Android Upload,O=Gaming Forward LLC,C=US"

FINGERPRINT="$(
  keytool -list -v \
    -keystore "$WORKDIR/packone-upload.p12" \
    -storepass:file "$WORKDIR/password" \
    -alias "$KEY_ALIAS" \
  | awk -F': ' '/SHA256:/{print $2; exit}'
)"

base64 "$WORKDIR/packone-upload.p12" | tr -d '\n' > "$WORKDIR/keystore.b64"

gcloud secrets create "$KEYSTORE_SECRET" \
  --project="$PROJECT_ID" \
  --replication-policy="automatic" \
  --data-file="$WORKDIR/keystore.b64"
CREATED_SECRETS+=("$KEYSTORE_SECRET")

gcloud secrets create "$PASSWORD_SECRET" \
  --project="$PROJECT_ID" \
  --replication-policy="automatic" \
  --data-file="$WORKDIR/password"
CREATED_SECRETS+=("$PASSWORD_SECRET")

for SECRET in "$KEYSTORE_SECRET" "$PASSWORD_SECRET"; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --project="$PROJECT_ID" \
    --member="serviceAccount:$SERVICE_ACCOUNT" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
done

SETUP_COMPLETE=1

echo
echo "ANDROID UPLOAD KEY SETUP COMPLETE"
echo "SHA-256: $FINGERPRINT"
```

Send back only the completion line and SHA-256 fingerprint. Do not send the keystore, base64 value, or password.

## First-release behavior

Because `pro.packone.app` is still a draft/unpublished Play app, the API creates the first Internal Testing release with status `draft`. The edit is committed so the owner can inspect the release and complete the first rollout in Google Play Console after any required declarations/setup are satisfied.

The workflow does not attempt a `completed` rollout for the unpublished app.

## Build numbering

Store version codes are assigned as:

`100000 + GITHUB_RUN_NUMBER`

for the Android Internal Testing workflow. Expo receives the value through `PACKONE_ANDROID_VERSION_CODE` before Prebuild, and config validation asserts that the override reaches `android.versionCode`.

## Release workflow

`.github/workflows/android-internal-testing.yml`:

1. authenticates keylessly as `packone-play-ci@pack-one.iam.gserviceaccount.com`
2. reads secret version 1 of the Pack One upload key from Secret Manager
3. generates the production Android project for `pro.packone.app`
4. replaces Expo's generated release signing config with the dedicated upload key
5. builds and verifies the signed AAB
6. creates a Google Play edit
7. uploads the AAB
8. updates the `internal` track with a `draft` release
9. commits the edit
10. deletes an abandoned edit if any pre-commit step fails

No production-track release is created by this workflow.

## Credential cleanup

The intended active Android upload key lives only in Google Secret Manager. Older GitHub repository secrets named `ANDROID_UPLOAD_KEYSTORE_BASE64` and `ANDROID_UPLOAD_KEY_PASSWORD`, if still present, are obsolete and should be deleted.

Any pre-WIF `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` repository secret and its corresponding Google Cloud service-account key should also be deleted.

The temporary `PACKONE_SECRETS_TOKEN` repository secret, if still present, should be deleted.
