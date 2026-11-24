# Pack One Lab
Tracking: [#1791](https://github.com/killjoy00/mtg-ev-analyzer/issues/1791).

## Charter
**Exploring how we draft Magic.** The reader need not know Pack One. Lab is a public Limited research feature, not product reporting. Model/score/difficulty/puzzle selection findings belong in Inside Pack One. The three editorial series are Draft Theory, Format Deep Dive, and The Drafting Divide.

Lead with a recognizable drafting dilemma, a meaningful observed finding, a chart, what the observation does and does not imply, and a genuine discussion question. Aim for 300–500 words. Prefer specific cards and packs only when validated, otherwise use an explicitly hypothetical situation. Avoid generic advice, excessive promotion, and claims of a correct pick or causal advantage from observational data. Include source/license, actual observation unit, cohort, date window/archival provenance, sample size, missingness and relevant caveats.

## Phase 1: offline proof of concept
- `registry.json`: 24 proposed research questions, including source, unit, method and requirements. Two questions have real archived-aggregate prototypes; five additional questions have offline adapter code (one requires rarity metadata). Planned or unexecuted is not a measured finding.
- `pilot.mjs`: two deterministic historical analyses using the existing pinned public FRA aggregate (not fresh database data). Validates source hashes, counts, sample floor and consistency; constructs evidence packets, fixed-template draft copy, and SVG chart from the same computed numbers. The source is read-only. No AI or external service is used in this prototype.
- Splashing: 13,513 / 28,424 **games** with recorded splash colors (47.5%). Do not reinterpret as the percentage of unique decks, drafters, winning drafts, or optimal picks.
- Duplicate copies: 3,984 / 21,545 **draft/card-name groups** with repeated picks and at least one observed deck copy had fewer observed deck copies than drafted (18.5%). Maximum counts across recorded games are used; coverage may be incomplete. Do not claim the extra picks were mistakes. The wider repeated-card population is 26,258 groups and must not be mixed into that conditional denominator.
- Both are descriptive observations from one archived set, without independent-draft confidence intervals. They are eligible for editorial review, not release. The numbers of repeated games/card groups do not establish independent sample sizes.
- Pilot source: [FRA audit](../CONTEXT-MODEL-AUDIT.md), [aggregate JSON](../data/fra-context-audit.json), [17Lands public datasets](https://www.17lands.com/public_datasets), CC BY 4.0. The CLI and tests pin the original Git blob; future sources require explicit reviewed version updates.

For a trusted private machine with a checkout, create a new empty private directory outside the repo, then run:
```sh
node --test tests/pack-one-lab-pilot.test.mjs
node scripts/pack-one-lab-pilot.mjs --out-dir /path/to/private/empty/directory
```
The CLI refuses GitHub Actions, repository-local destinations, existing output files and nonprivate POSIX directories. On Windows use a private user-controlled folder (POSIX permissions are not an ACL check). It emits only a fixed status to the console and writes separate evidence JSON, Markdown draft and chart SVG locally. No drafts, raw observations, named results or credentials in the public repo or Actions artifacts. Do not commit generated drafts. A partial local write after an error is not publication; use a fresh private directory for the next run. Chart SVGs need rasterization and layout QA for the final Patreon integration.

## Phase 1b: actual trophy-pick archive adapter and editorial triage

The offline Python adapter `scripts/pack_one_lab_picks.py` reuses the existing qualified-trophy cohort parser, complete first-eight trajectory validation, first-game deck join and explicit mana-cost classifier. It accepts only the three pinned FRA archive/metadata SHA-256 inputs from the existing context audit. It produces aggregate per-pick evidence, not raw draft IDs, player records, article drafts or source packs. Requires an existing private output directory outside the repo and refuses Actions. Run on a trusted private worker, not as a manual owner requirement.

Five analysis implementations are present:
- fixing lands (known multicolor-producing land, not every form of fixing);
- off-color mono-color choices after at least two prior ordinary colored spells in one color (not proof of pivoting);
- generic-mana spells versus colored alternatives (not complete flexibility);
- common vs rare/mythic spells (blocked for the current pinned rules snapshot because it lacks rarity);
- first-pick card-name inclusion in the first recorded match/game deck (not copy-level or final-deck inclusion).

Per-pick sample gates are 100 distinct qualifying source drafts and 80% metadata/observation coverage. No counts below the gate enter the findings. These are initial descriptive editorial thresholds, not significance tests. Cross-pick cohorts may overlap and the offered alternatives differ. No causal comparisons. Synthetic test cases establish intended mechanics, not Magic findings. No real archive run has been verified yet.

For a private worker with the exact pinned inputs:
```sh
python scripts/pack_one_lab_picks.py --draft /private/draft.csv.gz --game /private/games.csv.gz --metadata /private/fra-metadata.json.gz --out /private/lab/evidence.json
node scripts/pack-one-lab-triage.mjs --input /private/lab/evidence.json --out-dir /private/lab --exclude early-fixing
```
Omit the optional exclusion list if no questions have already been covered. The triage stage validates provenance fields, denominators, labels, coverage, stages and sums. It chooses predefined P1P1/P1P5 or P1P3/P1P6 comparisons, not whichever post-hoc comparison looks most exciting. Initial heuristic: require a five-percentage-point descriptive signal, prefer magnitude, sample size and coverage; suppress repeated topics, keep one candidate per theme and at most three briefs. A skip-week result is valid. Each brief has an explicitly hypothetical opening, exact observations, chart-ready data, discussion prompt, source and required limitations. A brief is not a finished article and has no publishing permissions. The triage does not independently re-read the archives; an independent review and source execution are still necessary.

Tests (synthetic fixtures only for the new adapter and triage):
```sh
python -m unittest discover -s tests -p test_pack_one_lab_picks.py
node --test tests/pack-one-lab-editorial.test.mjs
```

## Remaining phases (not implemented)
1. Execute the pinned FRA archive adapter privately; extend it to more sets, add reviewed rarity metadata, and build remaining read-only adapters for qualified puzzle metadata and aggregate first-encounter non-QA vote counts. Honor exclusions and distinguish real picks from simulated puzzle choices; avoid any individual player export. Add copy-aware joins, explicit mana/role taxonomy and source verification. Use set/pick/availability/selector version as relevant. For comparisons preregister minimum support and effect definitions, resample independent drafts or appropriate player/puzzle clusters, disclose multiple comparisons and missingness, and do not present exploratory findings as confirmatory. Current pilot minimum of 100 rows is not a general statistical credibility gate.
2. Implement the other registry questions in batches with tests and source coverage. Rank qualified findings only, using novelty, relevance, effect size/uncertainty and diversity. Use 8–12 historical windows without future leakage; maintain article history so repeated findings are suppressed. Generate ten distinct real-data articles, not ten variations of the two pilot facts.
3. Evidence-to-draft writer can use a structured constrained AI stage; calculations and visuals remain deterministic. An independent verifier checks every number, card and claim against evidence. Qualitative strategic claims require reviewed sources and owner approval; rejection/skip is normal. Set up a quality rubric, retain source fingerprints, validate chart layout and obtain owner feedback before enabling cadence.
4. Add private authenticated content queue, email deep link, owner revision/skip/alternatives, exact immutable approved version with content hash and audit trail. No external posting from draft states; changes invalidate approval.
5. Extend existing PostyBirb bridge only after content/approval prove reliable; private approved transport, stable idempotency key, safe ambiguous-submit reconciliation and verified public readback of exact content. Keep cloud publisher paused; no security bypass. Never use current public daily feed for unapproved content or named results. Respect [privacy controls](../../docs/RESULTS-PRIVACY.md). Keep weekly recap #1790 and current daily jobs independent.
6. After owner explicitly approves pilot, publishing release and exact first article, target a Friday cadence with no post if insufficient evidence. No schedule, credential, production deployment, model change or publishing activation in the pilot PR.
