# Pack One Android first-release signing

Pack One's Google Play application `pro.packone.app` is currently unpublished.

The production AAB build is verified, but Google Play rejected Internal App Sharing with `FAILED_PRECONDITION: NOT_PUBLISHED`. The bootstrap distribution path is therefore a normal **Internal Testing** release.

## Signing boundary

The first Play bundle must use a stable, dedicated Pack One upload key. The upload key is not committed to Git and is not pasted into chat.

The release workflow reads two secrets from Google Secret Manager through the already-configured GitHub Workload Identity Federation:

- `packone-android-upload-keystore-b64`
- `packone-android-upload-password`

The fixed key alias is `packone-upload`.

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
