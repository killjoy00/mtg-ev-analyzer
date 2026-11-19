# November 16 native privacy/results release

The owner authorized native candidates for the controls and approved policies merged in #1581 and #1590.

- Certified application source: `439c0c8dcd9b7a8e750b13cf4f44f94c8231dcf9`.
- Exact-main RC smoke: [43902562499](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/43902562499), all four stages passed: deterministic validation, unsigned iOS production archive, Android bundle, and final current-main evidence.
- Compared with `3e141135331cd568a47dc396717acf798b8d76eb`: no differences in `mobile/`, root dependency manifests, or the native validation/build/release workflows. Later changes are web presentation and store disclosure controls; the native binary inputs remain certified. Release-request and evidence edits are store controls only.
- Signed source: `c1d838cacb27027913be01cc968a78bf3b1ac522`. iOS **1.1 (101002)** passed protected signing, upload, App Store-eligible processing, and the finalizer's internal TestFlight availability/group checks in [43925032542](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/43925032542). Android **1.0 (100970)** passed protected signing, bundle audit and upload in [43925032404](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/43925032404).
- Existing testers, groups, countries, Closed Testing qualification, pending reviews, subscription configuration, and manual public release remain intact.
- Physical-device acceptance and the Apple email-use disclosure must be complete before public App Review/release. A CI simulator pass does not establish physical acceptance.

## Verified distribution

The separately reviewed Internal Testing activation from #1597 completed in [43931997601](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/43931997601). Fresh post-commit Google Play readback verified Internal Testing **100970**, status **completed**. Closed Testing remains **100963**; every other track and its release metadata were preserved. The sanitized proof artifact is `results-android-internal-100970-proof`. No public Production promotion occurred.

iOS **101002** is available to the existing internal TestFlight group. App Store version attachment is a separate state; do not infer an App Review submission or public release from successful TestFlight delivery.

Before public release: complete exact-build physical-device acceptance, save Apple App Privacy → Email Address → Developer’s Advertising or Marketing, then follow the existing store-review/manual-release gates. Google Play’s email-use purposes were already updated through #1592. No new tester/group/country or Closed Testing qualification changes are required by this release.

The results/news backend delivery release changes no shipped mobile source or native build inputs. Retain these signed candidates unless a later reviewed app change invalidates that equivalence.
