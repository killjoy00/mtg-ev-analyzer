# Main-source candidate evidence — f721389d

Run [37240960440](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/37240960440) passed all jobs on exact main/source `f721389d392867cc43c342c07ecddfc20c9f28f8`. Controlled native fixtures, preview 1.0/build 1; these are not physical or live-provider acceptance.

- Android 15/API 35, Pixel 7 Pro emulator (`sdk_gphone64_x86_64`): 25 checks passed, zero failures. Covers 320/600/840 dp, 1.0/1.5 text and 2.0 navigation labels, feedback/review, full gameplay and shared/account/Back continuity. Actual text grew 20→26 dp.
- iPhone 17 Pro Max and iPad Pro 13-inch (M4, 8GB), iOS/iPadOS 26.5: each passed 14 scenes plus measured growth, normal `large` and maximum `accessibility-extra-extra-extra-large`. Actual line height grew 20→71.42000198 pt. These are native scene/layout captures, not iOS tap/swipe journeys.
- All 17 store images were visually inspected: five Android, five iPhone, five iPad and two membership review images. Branding, tabs, fonts and feedback are contained. **The membership images are rejected for final upload** because inspection found the incorrect Patreon attribution for manual Elite grants. #960 corrects those two sentences; final-source captures/builds follow its merge.

`store-review.json` contains per-image hashes/dimensions and clearly marked derived native summaries. It does not replace the complete original manifests in these immutable run artifacts:

| Artifact | ID | ZIP SHA-256 |
| --- | --- | --- |
| Android store | 11318251639 | `306924563f42beb2068ad934f5021db1b66aeff27b0b10d95154869fc64d8524` |
| Android native | 11317899906 | `f21aa763352be3d58b6dcc5c6f258593323e983118911b4c080434714a6f24b7` |
| iOS store | 11318165766 | `30dde526799742037f8b7951169efbd707c52f74fa88fd11c513720b52fd4f24` |
| iOS native | 11318011531 | `9f47877dfdf6e88da2446b6098d9a8727e5524b76d1ab6683a5de40e9f7e9895` |

These artifacts correspond to the core repair binaries iOS 100500 / Android 100488. They do not contain #960. See [the repair ledger](../../mobile-native-ux-repair-575.md) and #575 for final candidate numbers, actual tester availability and remaining physical/provider/owner gates.
