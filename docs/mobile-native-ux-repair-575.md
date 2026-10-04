# Native navigation and visual parity repair — #575 / #910

Status at October 4, 2026, 1:00 p.m. CDT: implementation and native verification in progress. No new distributed candidate is claimed by this document. Pacific time remains the game-day boundary.

PR #890 is retained. It fixed the account/profile batch, not the original native navigation, Daily, Learn, or feedback complaints. Builds iOS 100415 and Android 100444 predate #890 and this repair. Unsigned archives and bundle smoke jobs are not tester distribution.

## Owner complaints and implementation

| Original failed item | Repair in #910 | Acceptance evidence |
| --- | --- | --- |
| Dated “Draft Decision Lab” heading | Pack One brand and bundled Barlow Condensed / Source Sans 3 TTF faces, with OFL licenses and system fallback | Android rendering observed; final iOS/Android recapture pending |
| Main destinations buried in home scroll | Real Expo Router tabs: member Daily / Practice / Leaders / Learn / My Pack One; guest Daily / How to Play / Sign in | Mounted identity-transition tests; first Android tab/profile/settings/hardware-Back journey passed; label truncation found and corrected for recapture |
| Feedback escapes its box | Intrinsic column layout on narrow/enlarged-text screens; measured-width row on wider screens; shrinking copy, nested score suffix, wrapping names and stacked comparisons | Original native failure reproduced; repaired geometry recapture pending |
| Back says `index` | Headerless root tabs; root stack uses human Back labels; stable original public paths | Android tab root and child Back observed; iOS swipe and final deep-link journey pending |
| “Your last shared run” misrepresents history | Removed from Daily. Practice checks this identity's local checkpoint and server UUID before offering Continue/View result; failures preserve the checkpoint | Mounted empty, corrupt, wrong-owner, completed and failed-GET tests; native auth/relaunch journey added |
| New versus established account mismatch | Guest first-play cues; first-use Career from #890 retained; member dashboard remains primary account entry | Mounted first-use/profile-save coverage; native new/established fixtures added |
| Signed-out Learn should be How to Play | Guest education tab renders How to Play directly | Android article entry observed; direct play journey recapture pending |
| Member Learn is just links | Prominent How to Play, Scoring / Method / Sets, individually described drafting guides, play action | Mounted selected-article destinations pass; native member Learn observed |
| My Pack One competes with Account | Removed home account panels; member tab opens Career, with Account settings leading to profile, membership, security, deletion and Help | Android dashboard/settings/Back passed; #890 profile-save suite retained |

## Reference and state coverage

Reviewed web sources: `index.html`, `bootstrap.mjs`, `site-nav.mjs`, `daily-home.mjs`, `daily-home.css`, `visual-c.css`, `fonts.css`, `how-it-works/index.html`, Learn index and guides, `practice-page.mjs`, `my-pack-one.mjs`, and `profile-product.mjs`. Live `packone.pro` HTML was retrieved. Current web code, not historical checked boxes, determines the Daily order and education hierarchy.

| State | Exercised evidence | Limits |
| --- | --- | --- |
| Fresh/returning guest; new/established member; free/Elite | Controlled native fixtures and mounted tests; browser auth/profile/Practice suite | No owner's account or production game records were mutated |
| Checking/failure/expired session/account switching | Mounted request-order and authoritative-401 tests; native checking/error fixtures | Live provider expiration and switching on physical builds remain required |
| No/partial/all Dailies complete, score 0, unavailable progress | Mounted Daily tests and Android home captures | Final revised-home rendering still to recapture |
| Unfinished Daily/Practice/shared run | Existing lifecycle, idempotency, pick reconciliation and shared UUID recovery tests; native eight-pick/relaunch journeys added | Host mocks prove behavior, not layout; native journey results recorded separately |
| Midnight Pacific and DST | Focus/foreground tests and 23/25-hour reset tests | No CDT game-day calculations |

The Daily reset/streak strip now appears before completion, including a real zero streak and checking/unavailable states. Unknown progress is not called zero or unplayed. Same-identity refresh failures retain loaded progress; an identity change clears it. Shared invitation authentication carries an explicit return destination and dismisses back to the existing destination.

## Reproduced native defect

Baseline source: `388d9ab045240e0d96a4b1382f140e35fc91d0b4`, with measurement callbacks only. [Run 37130838716](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/37130838716), artifact `pack-one-native-baseline-388d9ab0`, Android API 35 Pixel 7 Pro emulator, preview fixture.

At 320 dp and Android font scale 1.5, the feedback box measured 272 × 234 dp. Copy began at y=99 and measured 146 dp high: its bottom was y=245, eleven dp beyond the box. The screenshot visibly shows “You chose Hero in Training.” crossing the bottom border. At 390 dp / 1.0 the same vertical containment failure was measured. This is actual native evidence, not an inference from `minWidth: 220` alone.

## First repair verification and defects caught

Source `096fa73fdeb7de8f9672fd8f38f9a88081f24fcb`: [native run 37132614433](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/37132614433). Native compilation succeeded for Android and iOS. Android home states and the tabs → profile → Back / settings → Back journey ran. The run **failed acceptance**: labels truncated; a reserved route parameter misdirected feedback fixtures; unsigned iOS preview persistence tried to use unavailable Keychain entitlements; one play-action lookup missed its label. Corrections are in the next revision. These captures are diagnostic evidence, not approved store screenshots.

Integration verification on `32232698f1613034e4b723c896a3384d1051d4bd` passed required root tests, browser tests and the full mobile suite. Integration review then found that rename detection had omitted deletion of five old root routes; `3cbae747d3d5193ad07151118d088b803b26c8ff` removes those duplicates and adds a unique-public-route contract. Its full mobile command passed locally. Native acceptance is being rerun on the final revision, including image failure/retry and explicit sign-out/account-switch journeys.

The full browser gate [37132614437](https://github.com/killjoy00/mtg-ev-analyzer/actions/runs/37132614437) passed, including real computed font-size growth before the 125% screenshot. The required root test gate found a missing acceptance-script stub in the screenshot-runner harness; that test was updated without removing readiness/install failure assertions. Full mobile tests passed on the first revision; subsequent changes are being rerun.

## Intentional native differences and release gates

- Native bottom tabs replace web navigation; gameplay uses the existing full-screen stack. Original URLs remain routable.
- Individual drafting guides open their selected HTTPS article and retain the native screen underneath. Help, About and policies are secondary destinations.
- Native explicitly shows a zero-day streak. Web currently omits the zero badge.
- Signed production builds retain SecureStore identity and checkpoint keys. Only synthetic preview fixture values use simulator preferences on unsigned iOS simulators.
- Apple/Google membership purchase differences, affiliate eligibility/disclosure, no-reroll rules, account ownership, scoring, corpus selection and leaderboard semantics remain unchanged by this repair.

Final evidence must name the exact source, OS/device, build number, text setting, result and artifact. Physical iPhone/Android upgrade from the distributed builds, iOS swipe-back, iPad landscape/narrow multitasking, VoiceOver/TalkBack, real provider/inbox and store billing acceptance remain separate from simulator evidence. App Review submission and public release still require the existing physical-acceptance and owner-approval gates. Google closed-test track and tester continuity must be preserved when distributing the replacement candidate.
