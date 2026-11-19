# Pack One Android first-release signing

This file records the original Android signing/bootstrap path. For current launch status, use `docs/mobile-store-submission.md` and issue #575.

Current 1.0 state as of 2026-10-02: signed versionCode `100444` is uploaded and active on Closed Testing `production-access` for the qualification period. The original Internal App Sharing rejection and Internal Testing bootstrap below are historical evidence, not current release instructions.

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

## First-release behavior — historical bootstrap

During the original unpublished-app bootstrap, the API created Internal Testing releases with status `draft`.

The first authenticated release was uploaded successfully on 2026-09-24:

- package: `pro.packone.app`
- track: `internal`
- version code: `100015`
- release name: `Pack One internal 9f0b499`
- initial API release status: `draft`
- Google Play edit committed: `true`
- AAB signer verified against the dedicated upload-key fingerprint above

The owner then completed the first rollout in Google Play Console. A live Google Play API status probe confirmed the same release and version code on the `internal` track with status `completed`.

The Internal Testing workflow remains available for future candidate uploads. For the current 1.0 launch, versionCode `100444` has already been uploaded and promoted unchanged to `production-access`; do not treat another Internal Testing bootstrap as required launch work. The reusable read-only status workflow `.github/workflows/android-internal-status.yml` can verify Internal Testing without uploading a new bundle.

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

## Historical credential cleanup notes

The active Android upload key path is Google Secret Manager through WIF. Legacy/bootstrap cleanup notes are retained only as historical maintenance context and are **not #575 launch blockers or owner tasks**. Do not ask the owner to recreate, recover, or rotate lost secret values solely to satisfy historical cleanup/re-scoping guidance unless the owner explicitly reopens that work.
