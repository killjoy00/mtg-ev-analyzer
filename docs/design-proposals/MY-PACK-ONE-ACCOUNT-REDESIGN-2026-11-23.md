# My Pack One — cross-platform design proposal (review only)

**Status:** Proposed for owner design review, November 23, 2026. **Not implemented or approved.**
**Platforms:** Pack One web, iOS, Android.
**Preview:** [Open the design-only HTML prototype](./my-pack-one-review-preview.html) (save/open the HTML in a browser; GitHub's file viewer displays source). The prototype uses **fictional player data**, supports switching between desktop/iOS/Android and the three sections, and does not connect to accounts or APIs.

> This PR deliberately contains **documentation and a self-contained prototype only**. It must not merge, deploy, modify live styling, run migrations, publish app builds, or change user settings before a separate implementation is authorized. A green CI run on this PR is not implementation approval.

## The problem

My Pack One has grown by adding useful features without revisiting the presentation. Stats is in relatively good shape, but Insights reads as several analytical reports stacked together, and Settings puts identity, membership, security, emails, publication choices, and account deletion on one long page. In the native app, these paths are partly split already, but the hierarchy and copy are still inconsistent.

The right fix is **progressive disclosure and clear priorities**, not a new product skin. Show the most useful information first. Put explanation and infrequent controls behind readable, discoverable links. Use the existing Pack One tournament-scorecard identity.

## Requested decision

Approve or comment on this **direction only**, including:

1. Keep **My Pack One** as one signed-in destination, with three local sections. Suggested labels: **Stats | Insights | Settings** (use **Account settings** as the Settings page heading). Do not add a sixth app bottom tab.
2. Lead Insights with **Picks to review**, followed by **Patterns in your picks** and **Your scores over time**; put specialist breakdowns into **More breakdowns**.
3. Replace the long Settings form with an account overview and grouped paths: Profile, Membership, Appearance, Emails & reminders, Security, Privacy & results, About, and Delete account.
4. Make the Stats design smaller and more useful through spacing, summaries, and archived detail disclosures; keep the underlying career record.
5. Apply the same content/copy model on web, iOS, and Android using platform-appropriate navigation, controls, and back behavior.

## Navigation and initial screen

| Surface | First view | Secondary view | Do not change |
| --- | --- | --- | --- |
| Web Stats | Career metrics; season; recent scores; sets where you've scored best | Achievements, recent runs, Daily history, shared challenges, sets played | Existing scores, share/public profile, signed-in page shell |
| Web Insights | Saved picks worth reviewing; one compact pick-pattern summary; comparable score history | Extra picks, source-position/difficulty/format breakdowns, evidence and methodology | Read-only pack review, originally awarded scores, evidence thresholds |
| Web Settings | Account identity/status; short grouped rows; email preference summary | Individual edit panels or routes for security, membership, appearance, profile, privacy | Secure account actions, deletion warnings, subscription source rules |
| Native Stats | Existing career snapshot condensed with a clear Recent Games path | Full activities/history via existing routes | Existing bottom navigation, offline/loading/guest states |
| Native Insights | Same priority/order as web, one-column cards, native pick-review sheet | Native list details/disclosures instead of tiny charts | Owner-scoped fetching, screen reader labels, safe back behavior |
| Native Settings | Account identity/status and straightforward grouped destination rows | Existing dedicated profile/security/reminder/delete/membership routes, with new routes only if approved | Apple/Google/Patreon flows, consent boundaries, native purchase rules |

### Page geometry and visual treatment

- Use the existing **light tournament scorecard** language: \`#f7f8fa\` page, white surfaces, \`#101820\` ink, \`#1e4d7a\` blue accents, fine \`#d5dbe1\` rules and restrained gold/rust only when they indicate real environments. Barlow Condensed for headings/numbers; Source Sans 3 for body text.
- Reuse the canonical P¹ asset in implementation. Do not redraw it or substitute an arbitrary superscript. The prototype's embedded mark is an illustrative copy of the committed geometry.
- **No** gradients, glass panels, fake trophies, fantasy art, floating AI-chat-style cards, multicolor badges, giant empty hero sections, or decorative icon collections.
- Desktop: compact 2-column layouts only when two items truly belong together; narrow reading measure for explanations; left-aligned with the common site frame. Phone: 16dp/px gutters, one-column stacking, ~16dp card padding and purposeful 8–20dp section rhythm.
- One main heading per native screen. Avoid the redundant navigation title + eyebrow + page title combination. Keep push-screen Back affordances and the existing platform tab shell.
- In the three local tabs, shorten the third label to **Settings** to avoid text squeezing at 320px and large font scaling. Use clear selected states and a semantic tablist on web.

## Insights — proposed page order

### 1. Picks to review (the main event)

- A single featured saved decision, with **Your pick** and **Trophy pick** art/names, original awarded score, set and original draft pick number, plus a useful factual reason to revisit it.
- Toggle between **Picks to revisit** and **High-scoring picks**. Default to whichever has eligible saved decisions; show up to two extra compact rows, then **See more picks**.
- One prominent **Review pick** action opens the existing **read-only original saved pack** with prior trophy-drafter picks, saved comparisons and a clear Close affordance. It never replays or rescores a historic decision.
- A leading qualified comparison may appear in a sentence near this section, but never as another large hero card. One example is not statistical proof.
- Empty or sparse history should explain how many more counted picks are needed; do not fill the space with decorative or fabricated examples.

### 2. Patterns in your picks

- Prefer factual, user-readable findings over psychological titles: e.g., **Strong alternatives** followed by "Several of your picks that differed from the trophy drafter still scored well." Only show if the existing evidence rules qualify it.
- Keep existing qualified primary/secondary Drafting DNA data **accessible**, but condense the first view to one leading pattern and up to two compact supporting lines. Unqualified slots can say **Not enough picks yet**.
- Put underlying counts, card-type/rarity comparisons and precise eligibility explanation behind **Why this fits** / **See the picks**. The sample uses recent bounded eligible history across formats, and the header must not misleadingly promise complete lifetime coverage.
- Do not claim skill diagnoses, intrinsic player personality, improvement, or preference where the stored data only supports descriptive counts. Do not change DNA qualification logic in this proposal.

### 3. Your scores over time

- One compact sequence of existing **40-pick groups**, with counts, original-score averages, short dates, and clear version boundaries when scores are not comparable.
- A single plain-language caveat: **"A higher average doesn't necessarily mean you're drafting better. You're seeing different picks each time."**
- Behind **More score details**: monthly averages, milestones, complete chronology, and version/source cohort explanation.
- No duplicate recent-versus-previous comparison blocks. If a chart cannot be justified, use readable short score rows instead.

### 4. More breakdowns (collapsed by default)

- **Scores by original draft pick** — not "source pick position" and not Pack One question order.
- **How close the top choices were** — clarify that the saved model-support gap is not a human difficulty rating.
- **Scores by set or format** — show sample sizes and do not present different card pools as a cross-format skill ranking.
- **More comparisons**, **How we count picks**, and relevant cohort/sample limitations.
- Deep analysis must remain available without overwhelming the initial view. Filters for **Format** and **Time period** should sit beside the score/report section they affect; patterns from broader eligible history must be clearly distinguished from filtered report values.
- Show a human-readable eligible pick count, with empty, loading, unavailable, legacy and version-incompatible states preserved.

**Cross-platform drift to fix in implementation:** web currently assembles a patterns/decision/Journey view while the native component renders the decision highlights before the patterns. The new shared order above is intentional; implementation should ensure both platforms match it.

## Settings — proposed landing page

The Settings overview should answer three questions without scrolling through full forms: **Who am I signed in as? What access do I have? Where do I change a setting?**

1. **Account header**: display name, signed-in email (only to its owner), Free/Supporter/Elite or unavailable status, and a small **Sign out** action.
2. **Your profile**: display name, public visibility, favorite set/format, showcase achievement. Use an edit destination; preserve moderation and public identity rules.
3. **Membership**: one factual status row with **Manage membership** or **View Elite**, based on real Apple/Patreon/other access. Preserve the provider-specific cancellation and linking warnings.
4. **Appearance**: proposed (not built) choices for **Follow device / Light / Dark** and optional **Smaller / Default / Larger cards** if the broader card-size proposal is approved. Card-size should not silently change actual game scoring or the web/native zoom behavior.
5. **Emails & reminders**: three **independent, optional** controls with clear state and save/error feedback: **Daily reminder**, **Weekly results**, and **Pack One news**. Preserve per-topic consent, no automatic opt-in, verified-email requirements and unsubscribe behavior. The combined "Results and news" legacy action is not an acceptable shortcut for new UI. Do not infer subscription permissions from a single switch.
6. **Privacy & results**: explain and expose the **Exclude my name from published results** setting separately from **Public profile** visibility; they have different scopes and independent behavior.
7. **Security**: sign-in method and change password on a separate screen, with the existing sign-out-everywhere warning and auth-specific constraints.
8. **About Pack One**: direct route from Settings, with an additional reachable link from Learn so it is not buried in Account alone. Link Privacy/Terms near their actual choices.
9. **Delete account**: last, visually quieter but easy to locate. Confirmation, identity verification, billing cancellation warnings, permanent deletion consequences, and existing state handling remain mandatory. Never turn a destructive confirmation into a one-tap action.

On desktop, primary grouped rows can show their current state at the right. On native, each row navigates to an accessible full-screen destination with predictable Back and preserved unsaved edits. Do not put an actual data-mutating switch into the fake prototype.

## Stats — light improvement, not a rebuild

- Keep career metrics prominent and use **Your record** rather than "Career Snapshot".
- Lead with Games / Average / Best / Daily streak when present; show genuinely useful second-tier counts only when they justify space.
- Put latest season and recent scores near the top; keep **Sets where you've scored best**.
- Keep achievements, Daily history, shared challenges, sets played and sharing accessible without full archive lists consuming the initial viewport.
- Remove redundant section labels and generic intros. Don't create a new chart merely to fill space or invent additional metrics.
- Continue to support a useful first-run state without a fake record.

## Copy and "AI-coded wording" audit

The copy direction follows the owner's established approach: **point first, ordinary words, specific reason when needed, direct qualification, no invented claims, no inflated tone**. It is an editorial guideline; no private writing samples or personal messages belong in this public repository.

| Existing or overly technical copy | Proposed user-facing copy | Reason |
| --- | --- | --- |
| "Career Snapshot" | **Your record** | Familiar and shorter |
| "Recent Performance" | **Recent scores** | Says what is actually shown |
| "Your Drafting DNA" / psychometric-style archetype labels | **Patterns in your picks** | Describes evidence instead of asserting personality |
| "The Independent Thinker", "The Steady Hand" as hero identity | **Strong alternatives** / another qualified descriptive pattern | Avoids gamified diagnoses; actual examples must be supported |
| "Trait still developing" | **Not enough picks yet** | Avoids manufactured suspense |
| "Model-support closeness" | **How close the top choices were** | Avoids model terminology up front |
| "Scores by source pick position" | **Scores by original draft pick** | Avoids an internal term |
| "P1P positions are from the source draft..." | **These are pick numbers from the original drafts, not the order of questions in Pack One. We show averages once you've made at least five picks.** | Plain explanation of an important distinction |
| "These averages describe the picks you played; they do not prove a change in drafting skill" | **A higher average doesn't necessarily mean you're drafting better. You're seeing different picks each time.** | Accurate without disclaimer-speak |
| "Saved alternative scores" | **How the other cards scored** | Describes the action |
| "Review original pack" | **Review pick** (with context) | Shorter action; full read-only pack still appears |
| "One email a day while the Dailies are open..." | **Get one email reminder a day. If you've already finished all three Dailies, we won't send one.** | More conversational and specific |
| "Environment" (player-facing selector) | **Set or format** where appropriate | Avoids a development term |

Copy must not imply that a trophy drafter was objectively correct, that a model score is measured card strength, or that a 40-pick shift proves improved drafting. Keep meaningful eligibility thresholds and score-version limitations accessible, but stop repeating them under every heading.

## Platform behavior and edge cases

- **Web**: tablist keyboard navigation (arrow/Home/End), labelled tab panels, focus return from read-only saved-pack dialog, reliable direct-entry/back/refresh behavior, browser zoom, and no private data left visible after account changes.
- **iOS**: keep the existing native bottom tab destinations; support Dynamic Type and VoiceOver; use native list navigation and safe-area/back gestures; preserve Apple sign-in and App Store entitlement/restore behavior. Proposed appearance follows device by default.
- **Android**: same hierarchy and wording; back button behavior and TalkBack; retain actual Android-supported membership/payment options rather than copying iOS purchase wording.
- **All**: test guest/signed-out, brand-new, sparse, long-history, linked/unlinked, missing metadata, failure/retry, version-incompatible Journey, pending save, denied marketing consent, profile moderation, membership-source ambiguity, password-provider cases and account deletion steps. Ensure touch targets at least 44dp, responsive 320/390/768/1440px (and tablets/large text), no overflow or inaccessible disclosures.
- **Security/privacy**: original decisions remain owner scoped. Existing Insights scores, first-encounter rules, statistical gates, membership permissions, results-publication opt-outs, email preferences and billing/deletion behavior are **not changed** by this design.

## Acceptance criteria for a future implementation PR

- [ ] Same agreed information order and labels on web/iOS/Android; native uses native navigation.
- [ ] Overview fits a phone without starting with a wall of explanation or controls; key primary actions are identifiable.
- [ ] All currently supported settings and insights can be reached without loss of data or consent granularity.
- [ ] Actual Insights sections use real persisted data; no fictional averages, predictions or coaching claims.
- [ ] Copy follows the table above wherever accurate and retains the important scoring/consent nuances.
- [ ] Accessibility, keyboard/VoiceOver/TalkBack, responsive sizes, dark/light proposals (if approved), empty/error states and original-pack close/back work.
- [ ] Full existing account, privacy, membership, deletion, profile, Insights and backend regression tests pass for each affected platform.
- [ ] Store builds, backend releases, web publication and production data changes remain a **separate, authorized release**.

## Out of scope of this PR

No production HTML/CSS/React Native changes; no navigation implementation; no backend, database, analytics, score or model changes; no live settings writes; no release or TestFlight/Play submission; no CI/workflow changes; no Vercel usage. The prototype is a disconnected artifact, not a feature flag or runnable app.

## References for later implementation

- [Pack One design system](../DESIGN-SYSTEM.md), [canonical brand and assets](../../assets/brand/README.md), [native parity audit](../mobile-design-parity-audit-2026-11-19.md).
- Web: \`my-pack-one.mjs\`, \`my-pack-insights.mjs\`, \`profile-product.mjs\`, \`profile.css\`, \`results-settings.mjs\`, \`daily-reminder-settings.mjs\`.
- Native: \`mobile/src/screens/career.tsx\`, \`mobile/src/screens/insights.tsx\`, \`mobile/src/components/MyPackSectionTabs.tsx\`, \`mobile/app/account.tsx\`, \`mobile/app/account-profile.tsx\`, \`mobile/app/account-reminders.tsx\`, \`mobile/app/account-security.tsx\`, \`mobile/app/account-delete.tsx\`.
- Existing behavior contracts: [Focused Insights](../INSIGHTS-FOCUSED-REPORT.md), [Drafting DNA](../DRAFTING-DNA.md), [email opt-in](../NEW-SET-EMAIL-OPTIN.md), [results privacy](../RESULTS-PRIVACY.md).

**Review rule:** This is a request for visual/editorial feedback. Approval of this document should be followed by a distinct **implementation PR**, not by merging and treating this prototype as shipped functionality.
