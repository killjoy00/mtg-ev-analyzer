# Pack One native design parity audit — November 19, 2026

**Scope:** shared React Native iOS + Android UI, compared with the website's November site-wide cleanup (#1423, #1428, #1430–#1433), its source-of-truth [design system](DESIGN-SYSTEM.md), and latest native sources on `main`. This audit compares **decisions and principles**, not pixel positions. The site, iOS and Android should look like one product, but use the interaction model best suited to each platform.

**Updated baseline:** includes the November 19 iOS email-reminder parity changes and Android advertising work already in main; this PR changes only their UI spacing, not reminder, permissions, billing, or ad behavior.

**Baseline finding:** the November 7 [mobile parity inventory](mobile-parity-inventory.md) correctly marked the web's new page frame, phone menu and compact Daily layout as *web-only*. Content and features were synchronized afterward (#1499, #1616, #1628), but not the native page geometry. Native pages still used 24px outer gutters, 24–32px panel padding, and stacked 24–32px spacing; the tab navigator also rendered a separate title row above each content title. On small screens, these independent choices compounded into excessive white space.

## Design rules applied

1. **One hierarchy per screen.** Main tabs own their page headings. Do not repeat a navigator title above a headline; keep the native back header on push/modal routes.
2. **Show the game choices early.** Compact, numbered Daily scorecard rows; short supporting copy; CTA alongside content where it fits and below it naturally when narrow or font-scaled. Do not hide the third Daily or use a carousel.
3. **Use consistent rhythm, not the same CSS.** Standard phone gutter 16dp; regular vertical groups 8–20dp; ordinary surface padding 16dp. Retain narrow readable max widths on tablets and generous bottom scroll padding.
4. **Card art remains the product.** Don't reduce card image aspect ratio, collapse the earlier-picks context, hide progress, or sacrifice the fixed Lock/Next pick dock to win pixels.
5. **Native navigation is intentional.** Bottom tabs, safe-area handling, large-text adaptive tabs, back affordances, and native purchase/consent controls are not copied from the browser.
6. **Readable before compressed.** 44dp minimum for new compact actions, no text truncation or suppressed dynamic type, wrapping rows and no global font/spacing overrides.
7. **Stay in the existing visual language.** Light tournament scorecard, P¹ mark, Source Sans 3/Barlow, blue-accent hierarchy, ruled panels; no new decorative imagery, gradients, or Magic-style motifs.

## Screen-by-screen source audit and action

| Surface | Earlier native gap vs website | Implementation / intentional difference |
| --- | --- | --- |
| Main tab shell | Duplicated top header/title on Practice, Leaders, Learn, My Pack One | Remove redundant tab headers; keep bottom tabs + safe top inset and nested-route back headers. Normal bottom bar trimmed 10dp; large-text adaptive bar retained. |
| Daily home (guest/member/complete) | 3 large vertical cards; full-width action under each card; date and reset stacked; large top branding | Numbered compact rows with action alongside flexible text; reduced brand/hero space; date/reset/streak in a wrapping ruled row. Completed rows use a tinted surface instead of lowering text contrast. Keep all three choices, member/guest prompts, promotion eligibility and diagnostics. |
| Draft Run decision | More page, progress, pool, card-row spacing than website's A2 layout | Tighten header/progress/pool/card-row gaps and fixed action dock, but preserve full card art, prior-pick scroll, pack labels and button height. No gameplay or scoring changes. |
| Reveal/score explanation | Large outer frame and separate feedback panels | Compact feedback score panel, comparison and optional analysis spacing. Preserve reveal role colors, deck/source links, zoom, report flow and next-pick dock. |
| Completed result | 48dp top gap, 32dp score card padding, 24dp page sections | 16dp top/gutter/score padding and smaller—but still emphatic—score number. Keep complete eight-pick thumbnail recap, sharing and recovery actions. |
| Practice | 24dp gutters, card padding and gaps; large intro | 16dp card/panel gutters, tighter intro and grouping. Preserve native full-card tappability, free/Elite capability gates, custom set selector and guest sign-in button. |
| Leaders | Separate tab header, generous filter and row insets | Remove duplicate header; tighten filter section and ranking gutters; retain readable chip targets, scoring explanation and rank columns. |
| Learn / How to Play / Scoring / Method | Extra nav title, large article gaps, padded link cards | One main heading, compact article rhythm and content cards; maintain readable prose and source links. Guest Learn intentionally remains the How to Play article. |
| Sets / set archive | Extra page and card whitespace | Compact page/section/CTA gutters while retaining card-image sizes, statistics, coverage and source references. |
| My Pack One / Stats / history | Tab header plus profile hierarchy and widely separated cards | Remove redundant shell title; tighten profile stat sections and history rows; keep achievements, sharing and activity. |
| Insights | Generous page and section gutters on analysis-heavy screen | Tighten frame and chart panel shells; preserve charts, caveats, dynamic detail view and context labels. |
| Account / profile / reminder / security / delete | Stacked 24dp panels and rows on phone | Use 16dp regular panels; shrink whitespace without reducing input height or consent/delete protections; reminder action touch targets remain at least 45dp. |
| Membership | Over-padded offer and entitlement sections | Tighten panels only; keep native StoreKit restore, external linkage, provider rules and Android no-purchase behavior. |
| Public player profile / shared & historical runs | Wide card gaps on secondary routes | Use the same 16dp panel/card rhythm; keep existing deep links and protected account flows. |
| Card zoom, consent sheets, troubleshooting / promotion | Platform-specific intentional controls | Retained. These are not web CSS parity targets. iOS AdMob and Android ad/affiliate behavior remain governed by separate product/privacy policy. |

## Acceptance gates

- **Automated (PR):** Native Jest-like Node suite, ESLint/TS check, current behavioral navigation/Daily/reveal/membership checks, and explicit design invariants in `mobile/tests/native-design-parity.test.cjs`.
- **Simulator / emulator:** iPhone 320/390 widths, tablet 600/840+, Android at 320/390/600/840dp, ordinary and accessibility font scale, Android landscape gameplay, guest and member Daily, Practice, Leaders, Learn, My Pack One, account, reveal and result. The iOS acceptance harness now waits for real screen readiness rather than the removed header instrumentation.
- **Visual review:** Confirm all 3 Daily controls are easy to find, no horizontal overflow or clipped text, result recap remains readable, first pack not overwhelmed by chrome, tap targets are accessible, and no browser-only CSS concepts appear in native.
- **Provider/device gate:** Real TestFlight and Play install/upgrade, OS large text/VoiceOver/TalkBack, signed deep links, IAP/consent and ad availability still require on-device verification before store release. **Passing source/CI is not physical-device or store approval.**

## Non-goals and delivery

No rules, model/scoring, cards, data, membership entitlement, attribution, privacy policy, advertising switch, database, deployment or CI gate changes. No Vercel usage. This change is a **source PR only**; it does not merge itself, upload a binary, publish to the App Store or touch Google Play. After tests, review the simulator screenshots against the website and release both platforms through their existing protected processes.