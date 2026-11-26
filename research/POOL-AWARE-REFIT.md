# Pool-aware partial-credit refit: development entry point

Tracks #1863; prior negative research #1862. This is not a model release or a completed independent evaluation. The existing v6 serving formula, 100/95 limits, historical scores and leaderboards remain unchanged.

## First executable development stage

The new `scripts/pool_aware_archive.py` uses the same `assess_v6_colour_model.build_models` path as the frozen v6 evaluation, including stage-matched pair expectations, main+splash deck-color derivation and zero-rate handling. The v6 architecture is unchanged; fitting the baseline on a new chronological cohort intentionally produces different coefficients/support from the historical production corpus. It is not a reconstruction of exact historical production rows.

The manifest pins four sources by SHA-256 and identifies their origin. Use the public [17Lands archives](https://www.17lands.com/public_datasets) (CC BY 4.0), a pinned [Scryfall](https://scryfall.com/docs/api) rules snapshot and an explicit rules-reviewed interaction registry. Keep local paths, raw archives and decision records under ignored raw-data/ or artifacts/. Archive identity and timestamps must be verified against the official source before running; the manifest does not independently authenticate the declared set/mode or that the player skill buckets describe information available at draft time.

Manifest schema (illustrative fields, not a verified real-data manifest; replace all placeholders and choose dates appropriate to the actual archived environment):

    {
      "schema": 1,
      "set": "SET",
      "mode": "PremierDraft",
      "windows": {
        "baseline": ["START_UTC", "END_UTC"],
        "residual": ["START_UTC", "END_UTC"],
        "validation": ["START_UTC", "END_UTC"],
        "assessment": ["START_UTC", "END_UTC"]
      },
      "sources": {
        "draft": {"path": "draft.csv.gz", "origin": "OFFICIAL_SOURCE_URL", "sha256": "SHA256"},
        "games": {"path": "games.csv.gz", "origin": "OFFICIAL_SOURCE_URL", "sha256": "SHA256"},
        "metadata": {"path": "rules.json.gz", "origin": "PINNED_SCRYFALL_SOURCE", "sha256": "SHA256"},
        "interactions": {"path": "interactions.json", "origin": "REVIEW_RECORD", "sha256": "SHA256"}
      }
    }

Dates are UTC, half-open; leave at least seven days between windows. Draft IDs with inconsistent timestamps/qualification fields are removed; baseline IDs with late or invalid linked game timestamps are removed before any model count or color fit. Games without usable timestamps fail closed. Qualification uses the existing 100-game/15% bucket rules, with the cutoff estimated only from the chronological baseline window. All qualified baseline drafts are used; no cap. Validation's ordinary cohort uses that same fixed cutoff. The existing public archive skill-bucket fields may not identify individual players across drafts, so source-draft grouping is not player-level isolation.

The assessment window is specified but excluded from all label reads by this driver. Prior #1862 evidence and earlier v6 assessment partitions cannot be advertised as independent final validation. Fresh chronological confirmation and a separate frozen evaluation entry point are required.

Interaction registry schema:

    {"schema": 1, "edges": []}

For each genuinely rules-reviewed edge, supply payoff (pinned canonical card ID), enablers (distinct pinned IDs), minimum_distinct (at least 2), status ("verified"), rules_reference and review_reference. The extractor never treats generic word overlap as verified synergy. An empty registry is acceptable for a mana/opportunity development run; the report marks synergy inactive and skips its ablations. Do not fabricate independent review references.

## Run

From repository root, with actual archive files staged:

    python scripts/pool_aware_refit.py
    python scripts/pool_aware_features.py
    python scripts/test_pool_aware_archive.py
    python scripts/pool_aware_archive.py --manifest raw-data/pool-refit/manifest.json --output artifacts/pool-refit/development.json

The adapter compares baseline, mana, mana+opportunity and, if activated by verified registry features, synergy-only and combined residuals. Regularization grid (.02, .1, .5) is selected on development validation by raw log loss, with nonconverged fits excluded. The same-set/same-pick shuffled pool control preserves the actual v6 support and changes only the additional features. Results are aggregate-only; the output includes file hashes, model identity, coverage and explicit lock flags. This implementation is single environment per run, materializes qualifying pick records in memory and uses the initial pure-Python optimizer; multi-format pooled fitting, scale profiling and clustered interval estimates remain necessary.

## Independent decision-quality validation (not yet collected)

Before scoring a final independent benchmark, freeze category definitions, sampling, candidate rubric, review instructions and minimum sample size. Review 500 or more real choices, with 100 distinct source decisions in each of early speculation, established lane, legitimate splash/pivot/fixing, specific synergy and genuinely close alternatives. Separate representative and targeted strata, avoid repeated source drafts, stratify across ordinary, three-color and Cube formats/modes. Use at least two independent domain reviewers; do not show trophy choices, model scores, outcomes, or other reviewers' judgments. Use five ordinal alternative-quality labels, allow multiple good/excellent choices, explicit insufficient-context abstention and reasons for disagreement. Report agreement, adjudicated labels, paired source-cluster intervals, category counts, coverage and predeclared quality gates. Historical choice prediction is not equivalent to decision quality. No generated labels presented as independent human judgments.

## Status, November 26, 2026

Archive driver and three synthetic contract tests added. Local synthetic contracts passed, including rejected checksum changes, purging temporal crossings, excluding assessment, zero-residual normalization and matched shuffled pools. Earlier two synthetic self-test suites also passed. These are fixture tests, not an execution of the full production baseline builder on public archives. DNS/HTTPS access to GitHub, 17Lands and the public S3 archive host is unavailable in the local sandbox; no real-data refit was run. No fresh assessment data, rules-reviewed synergy registry or independent ratings obtained. Do not interpret the draft PR as a recommendation to ship.

Next: stage a checksum-verified official draft/game archive pair for a development environment, freeze the actual dates, run the adapter with empty synergy registry first, verify baseline and runtime, then collect verified interactions and independent labels. No workflow, CI gate, production, user-data or deployment changes in this PR.
