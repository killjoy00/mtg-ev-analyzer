# Native repair evidence — #575 / #910

Unmodified native screenshots and manifests retained from [run 37232560582](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/37232560582). Source `11191ba2786d3918b17fff518c32eacb467ef8b4`; tested PR merge checkout `fbb5ed7bccc7ca17bb3596d84c5615d099c2a424`; protected merge `ae70e2af79b804c137b8c289c2a1b0535e5c76dd` has identical mobile/build inputs. All captures use isolated persistent preview fixtures, version 1.0/build 1. These are emulator/simulator results, not physical-device or live-provider acceptance and not distributed/store candidate screenshots.

| Evidence | Device / text | Result |
| --- | --- | --- |
| Android manifest | Pixel 7 Pro emulator, Android 15/API 35, 320/390/600/840 dp; normal, 1.5 feedback and 2.0 tab font settings | 24 checks passed, no failures; 1.5 setting produced measured 20 → 26 dp text growth |
| iPhone manifest | iPhone 17 Pro Max, iOS 26.5, normal `large` and maximum `accessibility-extra-extra-extra-large` | 14 scenes + growth check passed; measured 20 → 71.42 pt |
| iPad manifest | iPad Pro 13-inch (M4, 8GB), iPadOS 26.5, same text settings | 14 scenes + growth check passed; measured 20 → 71.42 pt |

The baseline image is from source `388d9ab045240e0d96a4b1382f140e35fc91d0b4` plus measurement callbacks, [run 37130838716](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/37130838716), Android API 35 at 320 dp / font scale 1.5. Its copy extends 11 dp below the feedback box. Other PNGs are the repaired source above. `sha256.json` records the exact copied bytes.

- [Baseline overflow](baseline-android-320dp-1.5x.png) → [repaired long feedback](android-long-feedback-320dp-1.5x.png)
- [Trophy match](android-trophy-feedback-320dp-1.5x.png), [landscape feedback](android-landscape-feedback-840dp-1.5x.png), [iPad zero feedback at maximum text](ipad-zero-feedback-maximum-text.png)
- [Daily](android-daily.png), [guest How to Play](android-how-to-play.png), [member Learn](android-member-learn.png)
- [iPhone member tabs at maximum text](iphone-member-tabs-maximum-text.png)

Full artifacts include all scores, expanded analysis/pack, completion/review, shared relaunch, identity-switch and image-retry captures. Android native artifact `11315351570`, ZIP SHA-256 `0d527ce2558e0915428f3b2a135b418829016232a0f4f30ab034f2bc32a6136e`; iOS native artifact `11314324442`, ZIP SHA-256 `2b8748b56761ba10eb87ec57a4e0ca5655a89f6b4148371bbab78d5ba9e2275c`.

See [the repair ledger](../../mobile-native-ux-repair-575.md) for behavioral versus source-reviewed states, intentional differences, and physical/provider gates.
