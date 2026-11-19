# Tishana / Pack One card-image audit closeout — 2026-09-28

## Scope

This closeout records the Tishana's Tidebinder art regression, the Pack One-wide audit of card-image selection and propagation, the two systemic fixes found during that audit, and the successful guarded release.

The user-visible symptom was Tishana's Tidebinder serving the wrong art in LCI. The intended ordinary/base printing under Pack One's regular-set policy is LCI #81, Scryfall card ID `907b3d1d-8c85-4707-80b5-c4d832df9846`.

## Root cause

The deterministic Scryfall selector itself was behaving as designed. The current LCI parent corpus already stored the intended LCI #81 image.

The stale state lived in the currently served Traditional-v4 supplemental component. Backend image maintenance had been restricted to the parent corpus version, so a normalized parent could coexist with stale display metadata in a Live component. Production inspection before repair found 148 Tishana occurrences in `traditional-premier-v4-phase2-v1` on the stale image while the current parent used LCI #81.

A second audit finding affected future ingestion: `scripts/import_all_trophies.py` could seed a name-keyed image from an arbitrary other environment, and an already-present HTTPS image could bypass the preferred-set resolver. A restored per-build image cache could also preserve pre-fix display metadata across importer changes.

## Reviewed fixes

- PR #731 expanded backend card-image propagation to the current parent corpus **or** a `Live` supplemental component whose `parent_version` is the current parent. Candidate/non-Live components and components attached to older parents remain excluded. It also added a Tishana regression proving ordinary LCI #81 wins over the LCI borderless alternate and Art Series treatment.
- PR #733 hardened future trophy/component image ingestion:
  - current-environment shard metadata is the seed of truth;
  - a retained image cache may fill gaps but cannot override current environment metadata;
  - true misses resolve through the shared exact-name selector with the regular environment as the preferred set;
  - Powered Cube retains its global/no-preferred-set policy;
  - retained image caches are versioned by art policy and preferred set so stale cross-set cache entries are ignored.
- PR #736 fixed the release blocker exposed by the first guarded run. Once #731 began returning Live-component rows, the row verifier still used the parent corpus as the default expected version. Valid Traditional-v4 rows therefore failed with HTTP 409. The refresh now selects each row's stored `corpus_version`, requires the payload version to match it, and validates both the before/after payload against that exact version.

All changes remain inside the existing display-only mutation boundary: `image_url`, `mana_cost`, `rarity`, and `type_line`. Puzzle identity, source identity, model probabilities, grading, selection policy, schedules, sessions, and historical scores are unchanged.

## First guarded release attempt

The first release was pinned to the #731 merge, `c8dc309676139f9507dc409a22a571076931934e`.

Development and production function deployments passed. Full replay hydration, deterministic normalization, tests, dataset audit, diagnostics upload, exact-release verification, and normalized R2 publication also passed.

Development backend propagation then stopped with HTTP 409 on the first valid Live supplemental-component row. The release therefore skipped development gameplay verification, production backend image propagation, production gameplay verification, and source publication. This was the correct fail-closed behavior: production backend image payloads were not partially mutated by the failed propagation phase.

The 409 led directly to PR #736.

## Successful guarded release

The corrected release was pinned to reviewed merge `8c3c4df35f53e99c63cbbe3fe2c675a8e2b21203`.

- Development deploy run **36476395130**: success.
- Production deploy run **36476641344**: success.
- Card-image release run **36476356816**: success.
- Full Pack One image refresh run **36476867847**: success.

The successful refresh passed every release stage:

1. hydrate replay shards from R2;
2. normalize all served cards to deterministic main/base art;
3. run the full test suite;
4. run the production-dataset audit;
5. retain refresh diagnostics;
6. verify marked backend revisions;
7. publish normalized replay shards to R2;
8. refresh development backend image metadata;
9. verify development gameplay;
10. refresh production backend image metadata;
11. verify production gameplay;
12. perform the checked-in source handoff.

The final source-publication step reported that Pack One display metadata was already normalized, so no automation source branch or follow-up source PR was required.

## Audit results

The Pack One-wide deterministic refresh reported:

- environments: **32**;
- unique card names: **9,054**;
- unresolved names: **0**;
- avoidable remaining special printings: **0**;
- card-ID/name collisions: **0**;
- unavoidable special printings: **7**;
- cross-set fallbacks: **825**.

The seven unavoidable special printings are allowed by policy only where no ordinary/base alternative exists. Cross-set fallbacks are also policy-visible diagnostics rather than automatic failures: regular environments prefer their intended set, then fall back only when the exact identity has no ordinary printing in that set.

## Production verification

After the corrected release, direct production inspection found:

- `elite-trophy-colour-stage-v8`: Tishana's Tidebinder uses Scryfall ID `907b3d1d-8c85-4707-80b5-c4d832df9846` (LCI #81);
- `traditional-premier-v4-phase2-v1`: all **148** Tishana occurrences use that same intended LCI #81 image;
- retained `traditional-premier-v3-phase2-v1` rows were also normalized to the intended image.

Older historical corpus versions are not the target of current-serving image maintenance and are not rewritten merely to make historical storage cosmetically identical to current serving.

## Operational lessons

1. Card-image correctness has two separate layers: deterministic printing selection and propagation into every currently served storage component. A correct parent corpus does not prove a Live supplemental component is correct.
2. Component-aware maintenance must validate each row against its own stored component version. The parent version is an eligibility anchor, not the validation version for the component payload.
3. Future ingestion must be set-scoped before consulting retained caches. A valid HTTPS URL is not evidence that the printing belongs to the intended environment.
4. The guarded release must remain development-first and fail closed. The first run's 409 prevented a partially verified production mutation and made the validator bug observable before production propagation.
5. Historical corpora and non-Live components should remain immutable unless a separately reviewed operation explicitly targets them.

## Final state

The original Tishana regression is closed in current serving. Pack One's current parent and Live supplemental components are normalized under the deterministic main/base-art policy, the full audit is green, future imports are hardened against cross-set/cache leakage, and the release path now validates Live component rows against their actual stored component version.
