# November 16 native privacy/results release

The owner authorized native candidates for the controls and approved policies merged in #1581 and #1590.

- Certified application source: `439c0c8dcd9b7a8e750b13cf4f44f94c8231dcf9`.
- Exact-main RC smoke: [43902562499](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/43902562499), all four stages passed: deterministic validation, unsigned iOS production archive, Android bundle, and final current-main evidence.
- Compared with `3e141135331cd568a47dc396717acf798b8d76eb`: no differences in `mobile/`, root dependency manifests, or the native validation/build/release workflows. Later changes are web presentation and store disclosure controls; the native binary inputs remain certified. Release-request and evidence edits are store controls only.
- Candidates: iOS 1.1 and Android 1.0, with fresh store-allocated build numbers. Signed processing, TestFlight availability, and Android track state require independent verification after upload.
- Existing testers, groups, countries, Closed Testing qualification, pending reviews, subscription configuration, and manual public release remain intact.
- Physical-device acceptance and the Apple email-use disclosure must be complete before public App Review/release. A CI simulator pass does not establish physical acceptance.

Do not infer public availability from an uploaded candidate. Record exact store build identifiers and verified distribution state after the protected runs complete.
