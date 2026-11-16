# Offline mana-context model — research only

Tracking: #1567 (primary), #1562 (promotion gate), #1568 (deferred strength track).

**No production integration:** this research branch does not change the website,
Admin, database, selection, model, scoring, live corpus or historical results.

## Implemented

The offline Python model in scripts/offline_context_model.py starts from the
**frozen candidate probabilities** of the existing model, retaining its stage,
pair and color evidence. It learns two additional pre-pick features:

1. Prior-pool **explicit color demand overlap**: the share of previously
   selected ordinary spells that require the candidate's printed colors.
2. **Basic-typed land fixing**: colors explicitly guaranteed by Plains, Island,
   Swamp, Mountain or Forest subtypes, plus the color demand such a candidate
   can meet when prior typed lands do not already provide it.

It does not guess the mana production of fetchlands or conditional abilities.
Unknown or multi-face/hybrid/Phyrexian costs remain UNKNOWN, not colorless.
Canonical metadata must be checksum-pinned. Unverified display-only metadata
requires an explicit --display-preview flag and is **never promotable**.

### Structural pivot protection

The earlier generic new-color penalty improved overall prediction but badly
hurt historical legitimate pivots. This alternative preserves the **original
probability mass** of every commitment group: 0/1/2+ newly demanded colors,
land, and unknown. Only the relative probabilities *inside* each group can move.

This is an intentionally narrower model. It cannot directly repair
land-versus-spell selection or ranking between lane groups. That would require
new independent evidence rather than another arbitrary penalty.

Two coefficients are fitted by regularized conditional log-likelihood using
historical source-drafter picks, not Pack One votes or eventual wins. All picks
from one source draft stay in the same deterministic MD5 training, validation
or assessment partition. The script produces **aggregate-only** metrics
including draft-clustered approximate confidence intervals and new-color
diagnostics; there is no individual data export.

## Exploratory evidence, November 15

A read-only source-distinct Powered Cube v10 retrospective screen found
better pick prediction from group-mass-preserving correction than from the
frozen baseline, without the severe new-color-group regression of the
unconstrained penalty.

**Not a fresh held-out confirmation:** the same historical v10 corpus has been
examined during hypothesis development. The script refits its own two
coefficients and must be run separately; the earlier exploratory result is
not a claimed executed result of this exact implementation.

## Reproduce locally or in a GitHub research runner

From repository root (no network or database calls):

    python -m unittest discover -s tests -p 'test_offline_context_model.py' -v
    python scripts/offline_context_model.py \
      --input corpus/draft-run/powered-cube.json.gz \
      --display-preview \
      --output artifacts/offline-context/powered-cube-aggregate.json

For checksum-pinned canonical rules metadata keyed by card name:

    python scripts/offline_context_model.py \
      --input corpus/draft-run/powered-cube.json.gz \
      --input-sha256 CORPUS_SHA256 \
      --metadata path/to/cube-rules-metadata.json.gz \
      --metadata-sha256 VERIFIED_METADATA_SHA256 \
      --output artifacts/offline-context/cube-canonical.json

The first run is explicitly **preview-only**. Research results belong in this
ChatGPT conversation and aggregate conclusions in GitHub issues. Raw player
votes, identities and production snapshots do **not** belong in the repo.

## Promotion gates

- [x] Source-heldout learner and eval, frozen baseline, no-site code, unit tests
- [ ] Execute this exact script and review its aggregate regression report
- [ ] Build/checksum-pin complete whole-Cube Scryfall rules metadata, including
      alternative modes and more mana sources (the first model deliberately
      abstains on these)
- [ ] Confirm on truly fresh, source-separated 17Lands decisions and independent
      blind card-quality judgments; v10 and earlier context-validation screens
      are already development evidence
- [ ] If both gates pass, propose an independent versioned scorer and score
      parity/release tests; otherwise leave production untouched

Historical scores remain immutable. Predicting a trophy pick is not causal
winning value or proof that a partial-credit award is fair.
