# Original native UX request: implementation and evidence cross-reference

This is the requirement-by-requirement companion to [the repair ledger](mobile-native-ux-repair-575.md) and [release tracker #575](https://github.com/killjoy00/mtg-ev-analyzer/issues/575). Implementation is in merged #910 and #955, preserving #890. “Native” below means an emulator/simulator running the app, not physical acceptance. The ledger names exact sources, devices, OS versions, text settings, artifacts and measured results.

## Reference refresh and changes since the initial snapshot

On October 4, refreshed main is `b504d9bc4af373eff00b1fea8aa82119b93df4a1`. The signed candidate source is `f721389d392867cc43c342c07ecddfc20c9f28f8`. The only intervening merge, #954, changes admin report performance and associated gateway/admin tests; there is no mobile or build-workflow diff. Its work is preserved by the delivery PR.

Compared `388d9ab045240e0d96a4b1382f140e35fc91d0b4..b504d9bc4af373eff00b1fea8aa82119b93df4a1` across every supplied web reference: `index.html`, `bootstrap.mjs`, `site-nav.mjs`, `daily-home.mjs`, `daily-home.css`, `visual-c.css`, `fonts.css`, `how-it-works/`, `learn/`, `practice-page.mjs`, `my-pack-one.mjs`, and `profile-product.mjs`. There is **no diff in these reference files**. This does not claim that no other repository work landed. #902 Practice recency, the #889/v5 rollout, image-identity corrections and admin changes are retained without changing their behavior.

Recent design lineage was also checked so the October 3 snapshot is not treated as the beginning of product design:

| Web design change | Native disposition |
| --- | --- |
| `27e77c7d` reset countdown/streak, `433cf7c2` narrow-screen prominence, `5280cfc2` one status strip | Daily always shows its reset/streak strip, including zero, loading and unavailable states; foreground/rollover use Pacific semantics. Native explicitly shows zero where web can omit it. |
| `945cc5ce` button/link treatment | Shared palette and typography, prominent play actions, readable secondary actions and native touch targets. Actual store/native captures are reviewed rather than claiming pixel identity with HTML. |
| `668a06e4`, `7eac0309`, `9aae3014` first-use Career and player-facing copy | #890 welcome/play empty state retained; new-account native fixtures exercised. |
| `bce4a2ab`, `aff913ac` destination naming | My Pack One is the member dashboard tab; Account settings is its child. Internal route names are not UI labels. |
| #890 unknown-membership and profile-save refinements | Unknown access remains unknown; returned-profile adoption, field errors, placeholder saves and edits made during a save remain covered by the original behavioral suites. |

Live homepage HTML was retrieved during the original comparison. The final search-service refresh could not load `packone.pro`; the refreshed repository comparison above is source evidence, not a claim of a new live-browser visual inspection.

## Full requirement map

| Original requirement | Implementation / evidence | Remaining acceptance boundary |
| --- | --- | --- |
| Preserve #890; refresh main, #575 and parity inventory | #890 ancestry retained; current main and release/PR state refreshed; stale candidate and screenshot checkboxes in #575 reopened. | New store delivery is recorded separately from historical builds. |
| Fresh/returning guest, new/established member, Free/Elite | Controlled fixtures, mounted account/membership tests and native home/Career captures. | No production account or game records mutated. |
| Auth checking, failure, expiration and account switching | Navigation session request generation, retained identity during retry, authoritative 401 handling; mounted coverage. Android sign-out A/sign-in B journey proves no old private profile. | Native Daily checking/error captures are not a live auth outage test. Live providers remain open. |
| No/partial/all Dailies and unfinished run | Nine native Daily scenes, mounted status tests, eight-pick native journey with leave/resume of the same attempt. | Fixture API, not production play. |
| Real guest/member bottom navigation and permitted public access | Expo Router tab screens with three guest/five member destinations; hidden public routes remain reachable. | Physical accessibility audit open. |
| Selected state, labels, icons, semantics, safe areas | Native icons and selection inspected; normal and enlarged tab labels measured. Adaptive tiles retain scaling and full labels. `ScreenArea` avoids duplicate handled insets. | Short-window enlarged tab strip has mounted coverage; native narrow iPad window remains open. |
| Root/child Back, Android Back and iOS swipe | Headerless roots, human child labels, existing Stack gestures. Android tab/profile/settings/secondary-return hardware-Back journeys pass. | Actual iOS swipe/tap journey remains open. |
| Preserve filters, scroll, history; no duplicate stacks/runs | Existing tab key/history retained; #955 replaces child PUSH/REPLACE with `dismissTo`; installed-router and mounted regressions. Native secondary-return journeys pass. | One immediate archive-Back PNG caught the prior frame; the settled native hierarchy is the evidence, as documented. |
| Deep links and authentication returns | Original public paths retained; unique-route contract; shared/archive native custom-scheme journeys and mounted account return tests. | Signed production OS Universal/App Link handoff remains physical acceptance. |
| Full-screen play can hide tabs without losing a run | Existing run lifecycle retained; native leave after pick one → resume → finish, plus shared force-stop/relaunch preserving UUID and no replacement POST. | Upgrade from old distributed binaries must be physically checked. |
| Single member account entry | My Pack One dashboard → Account settings → profile/membership/security/deletion/Help. Homepage duplicate panels removed. | Provider-specific deletion acceptance remains open. |
| Remove dated heading and six utility cards; keep hero | Pack One branding and “Eight picks. Your call.” retained in focused Daily home. Native images inspected. | None for implementation. |
| Start here/free cues, date, completed score/View result, ordering | Daily UI and mounted tests; native fresh/completed/score-zero scenes. Order remains mixed, Powered Cube, latest. | None for implementation. |
| Ranking/name warnings and completion handoff | Named warning/recovery actions retained; completion goes to Practice or free-account creation. | Live moderated/account states are source/mounted-reviewed. |
| Unknown/error/retry, retain refresh state, clear other identity | Unknown is not zero; same-account refresh retains loaded progress; account/day change clears stale data. Mounted regressions and native checking/error states. | Real slow/offline provider behavior remains device acceptance. |
| Always-visible countdown/streak, zero/loading/foreground/rollover | Daily clock uses Pacific dates and 23/25-hour DST tests; status strip appears before three completions. | CDT is used only for progress reporting. |
| Affiliate eligibility/disclosure and main-action priority | Existing access/ads eligibility retained; secondary placement and disclosure remain. Failure/retry supported. | No change to approved commercial/store behavior. |
| Reproduce feedback overflow; fix without clipping/scaling suppression | Baseline native overflow measured at 11 dp. Measured-width row/column, shrinking copy, nested score suffix and wrapping comparison layouts. | Baseline and repaired sources are separately attributed. |
| Match/non-match, 0/100/intermediate, long/double-faced names | Native 320/600/840 dp and normal/enlarged Android; iPhone/iPad normal/maximum text. All repaired containment checks pass. | Physical-device typography remains open. |
| Analysis, pack review, final decision review, tablet | Native Android expanded analysis/pack interaction and eight-pick final review; iPad portrait feedback/layout captures. | iPad landscape and narrow multitasking remain open. |
| Shared recovery moved off Daily and conditionally labelled | Practice `SharedRunRecovery` validates local identity-bound checkpoint with server GET before Continue/View result; empty/corrupt/wrong-owner/error/completed mounted coverage. | It is explicitly device continuation, not cloud history. |
| Shared identity, invitation, ownership, no-reroll | Existing storage/API ownership and creator paths retained; native auth/accept/pick/kill/relaunch returns same UUID, no replacement POST. | Live provider authentication remains open. |
| Guest How to Play quick start and play near start/end | Direct guest tab, three quick-start steps, both play actions, existing detailed article retained. Native fresh-launch journey passes. | None for implementation. |
| Member Learn hierarchy and individually selected guides | Prominent How to Play; Scoring/Method/Sets; four titled/described guides; clear play action. Direct HTTPS article browser retains underlying app. | External browser return has source/mounted coverage, not physical provider acceptance. |
| Help/legal secondary; remove implementation copy | Discoverable Help/Account settings; public consumer copy cleaned in Learn/How to Play/Practice/auth. | Internal identifiers and technical documentation remain technical by design. |
| Licensed typography and consistent visual pass | Bundled native TTF Barlow Condensed/Source Sans 3 with OFL licenses, weight mapping/fallback; shared Text/BrandFonts/ScreenArea and theme. Native brand/tab/text images inspected. | No WOFF2 assumption. |
| Keyboard, long names/filters, chips, achievements/shares, zoom, touch/contrast/order | Existing account keyboard handling preserved; keyboard-aware native auth driver; long-user Leaders capture, responsive screen/card styles, 44-point actions and real image retry/zoom. Existing profile/activity/membership tests retained. | VoiceOver/TalkBack and full physical tablet/keyboard matrix remain open; not all surfaces have native tap automation. |
| Preserve profile save correctness | Unchanged #890 API adoption/errors/placeholder/newer-edit contracts; full profile tests pass after navigation return change. | No implementation regression identified. |
| Required checks and behavioral tests | Required test/browser, full mobile, both native production validations pass; focused nav/auth/Daily/shared/Back/continuity regressions added. | Host mocks are not counted as layout proof. |
| Correct large-text browser evidence | `tests/auth-context-e2e.mjs` enlarges computed typography and asserts measured growth before capture. Native tests separately measure 20→26 dp and 20→71.42 pt. | Root font-size alone is no longer called a large-text test. |
| All minimum journeys | Android real UI fixtures cover guest article/Daily/eight picks/result/Home; member Practice/review; Leaders/profile/Back; dashboard/settings/Back; shared auth/kill/resume; account switching. | Distributed-build upgrades and iOS gesture journeys remain physical checks. |
| Protected PRs/merges, test builds, closed-test continuity | #910/#955/#951 merged under protections. Signed runs use exact source; separate exact-version promotion preserves existing `production-access`. | Compile, store processing, tester availability and public release are separate states. |
| #575/docs/images/reviewer instructions and honest final state | Complaint ledger, this full map, inventory/runbook/submission packet, source-attributed evidence and guarded screenshot replacement. | Provider Notes confirmation and physical/owner App Review/public-launch gates remain open. |

No unchecked physical/provider acceptance item is converted into an implementation success merely because a workflow passes. The exact candidate numbers and store processing/distribution outcomes belong in the repair ledger and #575; old builds 100415/100444 are only upgrade starting points for this repair.
