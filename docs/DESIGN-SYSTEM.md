# Pack One: light tournament direction

For canonical logo/mark files, repo-owned fonts, production colors, social/store assets, and generator guidance, use the [Pack One brand and marketing asset guide](../assets/brand/README.md). This document remains the concise product visual-direction rationale.

The visual identity follows a printed tournament scorecard: clear numbering,
compact display type, readable labels, fine rules, and three decisive play actions.
Homepage and editorial decoration use restrained Pack One / P¹ brand marks rather
than Magic card art or generic fantasy imagery. Gameplay card images remain product
content rather than decorative brand treatment.

| Element | Choice | Purpose |
| --- | --- | --- |
| Headings, wordmark, scores | Barlow Condensed, 600–700 | Distinctive competitive character and compact hierarchy |
| Reading text and controls | Source Sans 3, 400–700 | Legibility across rules, accounts, results, and small screens |
| Page / surface | `#f7f8fa` / white | Light background with clearly separated game rows |
| Ink / muted text | `#101820` / `#5f6770` | Strong reading contrast |
| Primary blue | `#1e4d7a` | Play actions, progress, and Draft Run identity |
| Cube accent | `#976822` | A restrained second environment cue |

The three Dailies occupy numbered scorecard rows, with a muted rust accent for
Latest Set. On a zero-completion home state, Daily Draft Run may receive a restrained
"Start here" treatment and a small P¹ card motif; the other Dailies remain immediately
visible and equivalent product choices. Completed rows become compact; general
practice appears after all three are complete as a single handoff to the dedicated
Practice hub. Practice and Elite options are not duplicated below unfinished Dailies.
Mobile play controls remain at least 44 pixels high,
keyboard focus is visible, and prior cards retain the established 85% size relationship
to pack cards until more picks would overflow one line; they then shrink to fit, never
below 62 pixels, and scroll sideways after that. On a pick, the header carries the set,
a "Pack 1 · Pick N" label and the round steps; the pack is labelled "Choose one". Wider
screens size the pack columns so the whole pack fits when it can (cards at least 150
pixels on desktop). The primary action stays in a bottom bar: Lock pick appears once a
card is chosen (immediately in Practice, where it holds rerolls), and Next pick floats in
the same place on the reveal. Views after the first open at the run header.

Guest primary navigation is Daily Run, Practice, How To Play, and Sign in.
Practice remains visible while account status is being checked or unavailable.
Signed-in desktop navigation is Daily Run, Practice, Leaders, Learn, and
My Pack One. On narrow signed-in screens Daily Run is omitted from the nav because
the Pack One brand returns to Daily home; Practice, Leaders, Learn, and My Pack One
remain visible. Practice is a dedicated hub with unlimited regular Draft Run practice plus Elite
Powered Cube and custom-set practice. Its three cards remain visible for guests,
free accounts, Elite accounts, and loading/error states. Guests must sign in for
any practice; free accounts can start only regular Draft Runs; Elite accounts can
start all three. Loading or failed access checks never expose a start action for
an unverified capability. How To Play is the beginner manual; Learn is
the broader hub for scoring, method, set coverage, and drafting guides.

Fonts are self-hosted WOFF2 files with their SIL Open Font Licenses. The same
typography is used in gameplay, editorial pages, profile settings, and admin.
Future work should preserve this structure and avoid introducing gradients,
glass panels, decorative AI imagery, unrelated fantasy/card illustration, or an
unrelated typeface system.

Daily home, Practice, and the custom-set picker share a 900px content column and
a 600-weight display heading (60px desktop, 48px on phones). Mode labels use
12px, 700-weight reading type. Entry actions are centered, fill their card, and
are at least 48px high. The set picker uses selectable rows with the shared blue,
surface, and border tokens. Gameplay retains its wider card layout.

Verification includes responsive layouts at 320, 390, 768, and 1440 pixels and
direct visual inspection of the published homepage and gameplay.

## Approved My Pack One extension (not yet shipped)

My Pack One will retain the current Pack One scorecard styling and expose **Stats | Insights | Account settings** as **three local tabs**, in that order. The independent Insights panel will show evidence-based pick-depth, time, format and difficulty analysis; existing Stats and Account settings remain intact. On native, this is inside My Pack One and **not a new primary bottom-navigation destination**. Charts need accessible count/uncertainty labels and the existing blue/white typography and tokens. See the [approved Insights specification](MY-PACK-ONE-INSIGHTS.md) and [implementation prompt](MY-PACK-ONE-INSIGHTS-IMPLEMENTATION-PROMPT.md). This design direction is **backlog scope, not a live feature**.
