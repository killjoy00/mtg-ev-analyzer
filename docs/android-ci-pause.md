# Android CI reactivated — November 19, 2026

The owner confirmed Pack One's Android app is live, so routine native Android
testing has resumed alongside iOS. This file retains its original name because
existing release audits link to it. The pause ran from November 16 until this
reactivation; a narrowly scoped signed-AAB request path had already resumed
on November 18.

## Automatic validation now enabled

- **Android internal testing**: Android upload-signing configuration smoke
  runs on pull requests that change shared native code, assets, dependencies,
  mobile validation, or its own workflow. It uses validation-only signing
  values; **pull requests do not authenticate to Google Play**. The separate
  protected internal publisher remains explicitly manual, with no automatic
  `push` trigger.
- **Android production bundle**: routine native PRs run unsigned Android
  prebuild/Gradle smoke and merged-manifest privacy checks, using the
  existing fast/full classifier. On `main`, only the reviewed
  `.github/android-production-bundle-request.json` change or manual dispatch
  can start the protected Play-upload-key signing job. That signed build
  produces an AAB artifact; it **does not upload to Google Play**.
- **Mobile store screenshots**: Android emulator screenshots and full
  `native-acceptance.py` run automatically alongside iPhone/iPad capture on
  screenshot-relevant pull requests and reviewed screenshot requests on
  `main`. Manual and reusable calls still support `android_only: true`.
  Fixture captures are preview builds; they do not change Play tracks.
- **Mobile exact-main RC smoke**: relevant native pushes to protected `main`
  build and audit both unsigned iOS and Android RC artifacts. Manual dispatch
  includes Android by default, but may explicitly opt out using
  `include_android: false`. A failed or unexpectedly skipped Android build
  must not yield a passing cross-platform RC evidence manifest. Both release
  candidate artifacts remain **non-publishing**.
- **Shared mobile lint, typecheck, tests, iOS/TestFlight, and browser checks**
  remain intact. PR-native scope filtering prevents irrelevant non-mobile PRs
  from starting expensive Android jobs.
- **Native UX baseline evidence** still runs manually only: it recreates a
  historical 2026 Android build, not current live-app acceptance. It is not a
  routine test and should not be reenabled for every PR.

## Publication safety

Reactivating CI **does not** deploy a website, enable Android ads, build a
Play production release, promote a testing track, reset a testing clock, alter
tester groups, or change App Store Connect or Play Console settings.

The protected signing/build request and the separately reviewed exact-artifact
release/import/promotion workflow retain their independent safeguards. Before
any subsequent Android update is distributed, review target SDK, Play Console
privacy and advertising declarations, physical device acceptance, source
identity, signing and version codes. The fact that Android testing is active
is not authorization to publish another binary.

## Historical pause (November 16–18)

Android native compilation, PR smoke, and emulator captures were deliberately
paused while iOS release work was prioritized. The November 18 scoped
signed-AAB release-request path stayed available for explicit reviewed work.
The November 19 reactivation reverses the **routine CI pause**, not the
store-release protections.
