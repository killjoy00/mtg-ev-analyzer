# Pack One Android first-release signing

Pack One's Google Play application `pro.packone.app` is currently unpublished.

The production AAB build is verified, but Google Play rejected Internal App Sharing with `FAILED_PRECONDITION: NOT_PUBLISHED`. The bootstrap distribution path is therefore a normal **Internal Testing** draft release.

## Signing boundary

The first Play bundle uses a stable, dedicated Pack One upload key. The upload key is not committed to Git and is not pasted into chat.

The release workflow reads two secrets from Google Secret Manager through the already-configured GitHub Workload Identity Federation:

- `packone-android-upload-keystore-b64`
- `packone-android-upload-password`

The fixed key alias is `packone-upload`. CI reads version `1` of both secrets explicitly; rotating the upload key therefore requires a deliberate workflow change rather than silently following `latest`.

## Upload-key setup status

The dedicated Pack One upload key is now established. On 2026-09-24, the one-time keyless bootstrap:

- authenticated from GitHub Actions to Google Cloud through Workload Identity Federation
- generated a new PKCS12 key only inside an ephemeral GitHub runner
- created secret version `1` for both `packone-android-upload-keystore-b64` and `packone-android-upload-password`
- granted `packone-play-ci@pack-one.iam.gserviceaccount.com` `roles/secretmanager.secretAccessor` on those two secrets
- removed the one-time bootstrap workflow after completion

The upload certificate SHA-256 fingerprint is:

`FD:44:7E:18:F9:3B:E2:63:59:CD:26:C9:82:A2:0F:DF:44:2F:15:C8:D5:FD:F3:EF:0D:06:50:F7:B8:B9:18:7C`

The keystore and password were not written to the repository or pasted into chat.

## First-release behavior

Because `pro.packone.app` is still a draft/unpublished Play app, the API creates Internal Testing releases with status `draft`.

The first authenticated release was uploaded successfully on 2026-09-24:

- package: `pro.packone.app`
- track: `internal`
- version code: `100015`
- release name: `Pack One internal 9f0b499`
- initial API release status: `draft`
- Google Play edit committed: `true`
- AAB signer verified against the dedicated upload-key fingerprint above

The owner then completed the first rollout in Google Play Console. A live Google Play API status probe confirmed the same release and version code on the `internal` track with status `completed`.

The release workflow intentionally creates draft releases for the unpublished app. The reusable read-only status workflow `.github/workflows/android-internal-status.yml` can verify the current Internal Testing track without uploading a new bundle.

## Build numbering

The Android publishing job queries Google Play before every build. It creates a temporary edit, lists all current AAB version codes, deletes the probe edit, and assigns:

`max(highest Play versionCode + 1, 100000 + GITHUB_RUN_NUMBER)`

Expo receives that value through `PACKONE_ANDROID_VERSION_CODE` before Prebuild, and config validation asserts that the override reaches `android.versionCode`.

The GitHub run count is therefore only a floor. Renaming/replacing the workflow (which resets its run count) cannot move the published version code backward, and rerunning a job after an earlier attempt uploaded successfully advances past the already-used store number.

A live non-publishing probe after version code `100015` confirmed the allocator chose `100016`.

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

The intended active Android upload key lives only in Google Secret Manager. The temporary project-level `Secret Manager Admin` grant used for one-time bootstrap should be removed from `packone-play-ci@pack-one.iam.gserviceaccount.com`; the workflow only needs the per-secret accessor bindings created above.

Older GitHub repository secrets named `ANDROID_UPLOAD_KEYSTORE_BASE64` and `ANDROID_UPLOAD_KEY_PASSWORD`, if still present, are obsolete and should be deleted.

Any pre-WIF `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` repository secret and its corresponding Google Cloud service-account key should also be deleted.

The temporary `PACKONE_SECRETS_TOKEN` repository secret, if still present, should be deleted.
