# Drafting DNA — one primary identity and two secondary traits

**Decision:** Owner approved **one primary archetype + two secondary traits** on October 11, 2026.
**Status:** Qualification refinement #1180 merged and the guarded backend release #1181 succeeded. Signed-in acceptance in #1179 and the private audit of provisional gates remain outstanding.
**Implementation tracking:** [#1179](https://github.com/killjoy00/mtg-ev-analyzer/issues/1179) (consolidating #1167/#1170/#1171).
**Existing Insights:** [#1150](https://github.com/killjoy00/mtg-ev-analyzer/issues/1150) and [MY-PACK-ONE-INSIGHTS.md](MY-PACK-ONE-INSIGHTS.md).
**Approved surrounding experience:** [INSIGHTS-REDESIGN.md](INSIGHTS-REDESIGN.md) — Drafting DNA, real Best Calls & Biggest Misses, and Your Drafting Journey. Companion implementation issues [#1170](https://github.com/killjoy00/mtg-ev-analyzer/issues/1170) and [#1171](https://github.com/killjoy00/mtg-ev-analyzer/issues/1171).

## Product promise

Give players a recognizably personal account of *how their recorded draft picks tend to look*, backed by explainable evidence, without inventing strategic intent or ranking themselves against incompatible formats or historical models. The existing Insights charts remain available; Drafting DNA becomes the lead profile on the authenticated My Pack One → Insights page.

This does **not** create a top-level app destination, an extra local tab, a public-profile field, or an opt-in reminder. It also does not alter scores, eligibility, Daily/Practice or published trophy records.

## Approved presentation

On web and native:
1. **Primary archetype:** the prominent visual identity. Show icon, short label, one-sentence descriptive explanation, the qualified sample and an **"Why this fits"** disclosure with reproducible numeric evidence and limitations.
2. **Secondary trait #1:** compact badge/card with another qualified characteristic, sample count, and detail disclosure.
3. **Secondary trait #2:** a different qualified characteristic, with its own evidence. Never choose two merely synonymous or mathematically redundant traits to fill slots.

All three **positions** remain visible. If a player has not qualified for all three, label unfilled secondary positions **"Trait still developing"** and explain which evidence is missing. If no primary can be supported, replace the identity title with **"Your drafting DNA is taking shape"**, rather than assigning an undeserved role.

**Suggested content hierarchy** (not live data):

> YOUR DRAFTING DNA · All eligible history
> **The Independent Thinker** — Your recorded choices sometimes differ from the original trophy drafter, with strong awarded scores on a supported share of those alternatives.
> **Secondary:** Closer · Steady Hand
> [Why this fits] [How Drafting DNA works]

The sample/title pair above is **illustrative only**. Never use fabricated player facts in a live response or screenshot presented as the owner's real identity. Actual evidence may instead yield one identity and two still-developing placeholders.

Below the primary section, show the approved **Your Best Calls & Biggest Misses** real-card reviews and **Your Drafting Journey** timeline. Retain **Your patterns, Pick-by-pick strengths, Difficulty context and Format patterns** as supporting breakdowns and absorb the existing **Progress over time** card into Journey rather than displaying two redundant timelines. See [INSIGHTS-REDESIGN.md](INSIGHTS-REDESIGN.md). The primary identity is a summary/navigation affordance, not a substitute for transparent metrics.

### Scope and timing

Drafting DNA must be **stable under the Insights environment and period selector**: compute its identity from the same bounded owner-owned *all-environment/all-available* first-encounter history every time and mark that on the card. Other charts continue to honor the selector independently. Record the evidence window and method version. Avoid churning titles after one new pick; introduce a deterministic tie margin/stability policy documented with the implementation. Do not claim that a title measures innate personality.

## Archetype catalog — candidates, not automatic awards

All ten names below are available as **candidates**. An archetype must be explicitly enabled only after its metric, sample gate, comparator and copy are proven defensible. Absence of a qualified trait is preferable to pretending confidence. Do not expose a decorative "10/10 completed" counter.

| Identity | Proposed evidence family | Key qualification / caution |
| --- | --- | --- |
| **Trophy Twin** | Trophy-match rate and sample | Match rate needs a meaningful, comparable baseline to justify calling it unusually high. One trophy run does not validate every choice. |
| **Independent Thinker** | Share of first-time non-trophy picks receiving strong *original* awarded support | Requires enough non-match decisions, calibrated support threshold and no claim that an alternative is necessarily better or worse. |
| **Sharpshooter** | Score distribution / low-tail scarcity | Needs player score distribution vs a matched benchmark, not a single mean above an invented target. |
| **High-Roller** | Distribution spread and both tails | Needs enough decisions and comparable mix across source picks/formats; not equivalent to simply low overall score. |
| **Puzzle Solver** | Hard-puzzle performance *relative to an appropriate comparison* | **Deferred until a defensible difficulty-adjusted or matched-puzzle baseline exists.** Support-ratio difficulty changes possible awarded-score distributions; a high raw hard-band average does not establish skill. |
| **Architect** | Supported early-source-pick vs later-source-pick contrast | Use stored `puzzle.pick_number`, not eight-question game order. Require qualifying groups and controls for format, scoring version and pick mix; exclude mutually contradictory label with Closer. |
| **Closer** | Supported later-source-pick vs earlier-source-pick contrast | Same rules and caveats as Architect, with the direction reversed. |
| **Specialist** | Format-relative performance backed by calibrated cross-format context | **Deferred as a strength claim** until environment-specific baselines account for card-pool/model differences. High play share only proves preference, not skill. |
| **Steady Hand** | Scoring consistency across a sufficiently varied comparable decision sample | Requires distribution/dispersion measures and a matched benchmark; not synonymous with Sharpshooter. |
| **Rising Star** | Recent-vs-previous scored decision trend in compatible cohorts | Two complete 40-pick windows at minimum; require an adequate observed gap, version compatibility, and descriptive copy rather than claims of proven skill improvement. |

Avoid choosing quantitative thresholds from intuition: use a private/anonymous aggregate distribution review and synthetic fixture tests to set documented qualification gates and expected identity frequencies. The existing Insights chart rules (5 picks per grouped average, 40/40 written comparisons with a 10-point gap) are *not* automatically sufficient to award a persistent archetype.

### Conflict and ranking rules

1. Qualify or exclude each candidate independently; do not force a fixed distribution of identities.
2. Rank qualifying candidates using a **versioned, deterministic evidence-strength score** with a predeclared minimum and stable tie-breaking.
3. Select exactly **one primary** from the qualifying candidates, then up to **two secondaries** from *distinct evidence families*. Prefer an independently evidenced secondary over two near-duplicates, and never show both Architect and Closer simultaneously for the same comparison.
4. Show each candidate's own sample count, exact supporting metrics and inclusion/exclusion methodology via the detail disclosure. Do not present internal confidence/percentile numbers as objective skill ratings without a validated comparator.
5. Re-evaluate with new eligible decisions, but do not choose a substantially different title on a single borderline observation; publish and test the hysteresis or snapshot policy.
6. Return honest **emerging** states when there is ample *total* history but insufficient observations in a specific trait's groups.

## Source audit and backend contract

Current private Insights uses the bounded `worker/draft-run-insights.mjs` data model:
- Owner-only session/account resolution, first answer to each `puzzle_id`, non-QA eight-pick v3/v4 sessions, up to 1,000 recent sessions / 8,000 source decisions.
- Per-pick originally awarded `score`, verified `trophy_match`, `pick_number`, `answered_at`, and historical difficulty band.
- Cohort summaries for pick depth, difficulty, months, formats, plus the last 40 vs previous 40 and a minimum of five picks for chart averages.

The existing response does **not** yet provide: non-trophy high-support distributions, score variance/histograms, score distribution by source-pick phase, or reliable peer-normalized skill strength across difficulty/format. Archetype logic **must not** infer those from overall averages. Compute additional **bounded and safe summary statistics** on the server from the already loaded normalized decision rows where feasible, and validate peer comparisons separately before enabling any label that requires them.

Prefer a backward-compatible additive `drafting_dna` field on the **existing** private Insights response:
```json
{
  "drafting_dna": {
    "schema_version": "drafting-dna-v1",
    "status": "ready",
    "scope": "all-eligible-history",
    "eligible_decisions": 160,
    "primary": {
      "id": "independent-thinker",
      "evidence_family": "trophy-alternatives",
      "title": "The Independent Thinker",
      "summary": "Example text: evidence-based, not a real user's data.",
      "supporting_decisions": 60,
      "evidence": [
        {"label": "Qualified non-trophy alternatives", "count": 60}
      ]
    },
    "secondary": [
      {"status": "emerging", "label": "Trait still developing"},
      {"status": "emerging", "label": "Trait still developing"}
    ]
  }
}
```

This is a **shape illustration only**, not an endorsed score threshold or actual result. The client should render server-approved identity IDs/copy and aggregated evidence, not independently classify the player. Do not put player IDs, individual picks, private event history or unredacted telemetry in API responses, public profiles, shares, build logs or GitHub artifacts.

If old clients ignore the field, they must continue to function. Account logout/switch, account merge, blocked requests, stale response handling and expired sessions must preserve the existing privacy guarantees. In particular, a profile from account A can never appear while account B is active.

## Acceptance

- The card visibly has **1 primary position and 2 secondary positions** on web, iOS and Android (with honest developing placeholders where required).
- Each awarded trait has exact owner-only evidence and a reproducible versioned qualification rule. No arbitrary “everyone gets a type” fallback.
- The card identity is deliberately **independent of the chart filters** and its all-history scope is labeled.
- Archetypes are mutually consistent, distinct and stable under ties/near thresholds; emerging/empty/legacy accounts do not break the page.
- Tests cover replay/first-encounter, QA exclusion, source pick number, version mixing, missing difficulty, comparable cohort gates, personality tie ranking, account switch/logout and slow requests.
- Browser checks at 320/390/768/1440 px and native UI/accessibility parity pass. Show only verified numeric evidence and no fabricated skill claims.
- A reviewed PR and guarded backend acceptance precede any production rollout. No native app-store upload, new track, App Review submission, social post or release permission is implied by this design decision.

## Non-goals

No coaching LLM, no new draft score, no inferred aggro/control/rare preference, no social/public DNA sharing without separate privacy approval, no unverified peer percentiles, and no changes to unrelated [#1151](https://github.com/killjoy00/mtg-ev-analyzer/issues/1151).

## Drafting DNA v2 qualification contract (code-review follow-up #1179)

**Every numeric identity threshold below is PROVISIONAL pending an owner-run
private distribution audit.** The audit has not been run, and this change does
not approve publication of these gates as calibrated peer baselines. The
single source of truth is the exported, versioned
`DNA_QUALIFICATION` object in `worker/draft-run-insights-extras.mjs`
(`drafting-dna-v2`). No production data, distribution counts or private
query output belong in this repository.

Each enabled candidate requires **at least 80 eligible first-encounter decisions
per evaluation** (PROVISIONAL): it must qualify both on the complete bounded
owner history and on that history with the latest **8 eligible decisions**
removed (PROVISIONAL one-run stability gate). Thus **88 total eligible
decisions** is the effective stability sample floor and the earliest any trait
can qualify. At 80–87 decisions, no label can yet pass both checks; reaching
88 does not guarantee a label without the candidate's other evidence. This
stability requirement is not a stored identity snapshot; it delays transitions near a
threshold without adding personal storage. It cannot eliminate every
possible historical revision or threshold flip, so no claim of permanent
personality is made. Qualified candidates rank by excess above their
own gate, then supporting count, then lexical ID. A primary and at most two
secondary labels are selected with one label per evidence family. Sharpshooter
and Steady Hand share **score-distribution**, while Architect and Closer share
**pick-depth**; neither pair can be awarded together.

| Candidate | Decision | PROVISIONAL numeric qualification gate or reason for deferral |
| --- | --- | --- |
| **Trophy Twin** | **Deferred** | Historical `ranking[].support`/`selectedSupport` is card-choice model support, **not** an expected probability of the historical trophy drafter matching a player's selection. It is raw `model_probability` in v2 and a version-pinned, sharpened/calibrated model card-share in v3. No comparable per-puzzle trophy-match expectation exists, so a raw 65% match threshold is not defendable. Requires a validated per-puzzle matched trophy baseline before enabling. |
| **Independent Thinker** | Enabled (provisional) | At least **40** non-trophy picks, at least **50%** of all picks non-trophy, and at least **20** non-trophy picks with original score **80+**. Distinct supported alternatives only; no claim of being objectively better. |
| **Sharpshooter** | Enabled (provisional) | At least **65%** of decisions score **90+** and at most **10%** score **40 or below**. Provisional unbenchmarked distribution, not a peer percentile. |
| **High-Roller** | Enabled (provisional) | At least **20%** score **90+** and at least **20%** score **40 or below**. Mixed score distributions are descriptive only. |
| **Puzzle Solver** | **Deferred** | Needs difficulty/puzzle-adjusted expected performance, not raw hard-band averages. |
| **Architect** | Enabled (provisional) | Within the **same environment, scoring, selection and corpus version, and known difficulty band**, at least **40 early** and **40 late** source picks with early average at least **10 points** above late. Regular early P1P1–3, late P1P6–8; Powered Cube early P1P2–4, late P1P7–9. Strongest absolute-gap comparable cohort wins. |
| **Closer** | Enabled (provisional) | The same **40/40**, same-cohort and source-pick definitions as Architect, but the **10-point** gap favors late picks. |
| **Specialist** | **Deferred** | Environment participation is not comparative strength; requires calibrated cross-format baselines that account for card pool and scoring-model differences. |
| **Steady Hand** | Enabled (provisional) | At least **one cohort of 40** decisions using exactly Architect/Closer's **environment + scoring/selection/corpus version + known difficulty band** grouping. In **every** such sampled cohort, at least **85%** score **65+**, and at most **5%** score **40 or below**. Unknown bands and smaller cohorts cannot qualify it. |
| **Rising Star** | Enabled (provisional) | Two chronological **40-decision** spans inside one same-key comparable cohort; recent original average exceeds previous by **10+ points**. It says nothing about causal skill improvement. |

All percentages, sample floors, split points and effect gaps in this
section are **PROVISIONAL**. The qualified trait's evidence is traceable
to originally locked picks; sample and count gates are not verified
player percentiles. Score thresholds in the original 40/40 observation
charts are unchanged.

The additive DNA response includes `picks_needed` on the DNA object
and each emerging slot. While total eligible history is below the **effective
88-decision stability floor**, it reports the distance to 88 (so 80, 84 and 87
decisions report **8, 4 and 1** more, respectively). At 88 or more decisions
without another stable qualification, it returns `null` with a brief
`reason` rather than falsely promising a specific number of picks.
Existing status/primary/secondary fields remain for installed clients. For the otherwise-null primary slot, the additive `primary_emerging` object also provides `picks_needed` and an explanatory reason; older binaries continue using `primary:null`.

**Owner action still needed:** a private distribution audit should
evaluate candidate frequencies and comparator validity across
environment, scoring, selection, corpus and difficulty strata before
any gate is described as validated. That audit is intentionally out
of this public code-review PR.
