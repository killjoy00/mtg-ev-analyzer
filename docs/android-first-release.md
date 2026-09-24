# Pack One Android first-release signing

Pack One's Google Play application `pro.packone.app` is currently unpublished.

The production AAB build is verified, but Google Play rejected Internal App Sharing with `FAILED_PRECONDITION: NOT_PUBLISHED`. The bootstrap distribution path is therefore a normal **Internal Testing** release.

## Signing boundary

The first Play bundle must use a stable, dedicated Pack One upload key. The upload key is not committed to Git and is not pasted into chat.

The release workflow reads two secrets from Google Secret Manager through the already-configured GitHub Workload Identity Federation:

- `packone-android-upload-keystore-b64`
- `packone-android-upload-password`

The fixed key alias is `packone-upload`. CI reads version `1` of both secrets explicitly; rotating the upload key therefore requires a deliberate workflow change rather than silently following `latest`.

## Release workflow

`.github/workflows/android-internal-testing.yml`:

1. authenticates keylessly as `packone-play-ci@pack-one.iam.gserviceaccount.com`
2. reads the Pack One upload key from Secret Manager
3. generates the production Android project for `pro.packone.app`
4. replaces Expo's generated release signing config with the dedicated upload key
5. builds and verifies the signed AAB
6. creates a Google Play edit
7. uploads the AAB
8. updates the `internal` testing track
9. commits the edit
10. deletes an abandoned edit if any pre-commit step fails

No production-track release is created by this workflow.


## First-release behavior

Because `pro.packone.app` is still a draft/unpublished Play app, the API creates the first Internal Testing release with status `draft`. The edit is committed so the owner can inspect the release and complete the first rollout in Google Play Console after any required declarations/setup are satisfied.

The workflow does not attempt a `completed` rollout for the unpublished app.

## Build numbering

Store version codes are assigned as:

`100000 + GITHUB_RUN_NUMBER`

for the Android Internal Testing workflow. Expo receives the value through `PACKONE_ANDROID_VERSION_CODE` before Prebuild, and config validation asserts that the override reaches `android.versionCode`.

## Credential cleanup

The intended active Android upload key lives only in Google Secret Manager. Older GitHub repository secrets named `ANDROID_UPLOAD_KEYSTORE_BASE64` and `ANDROID_UPLOAD_KEY_PASSWORD`, if still present, are obsolete and should be deleted. Any pre-WIF `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` secret and its corresponding Google Cloud service-account key should also be deleted.
