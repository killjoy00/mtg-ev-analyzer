# Frozen puzzle-review inputs

The v9 snapshot preserves the complete selection inputs for rated puzzle reviews v1, v2 and v3. Each set contains the original compressed corpus, card-strength table and trophy-deck catalog. All 15 file hashes match the `inputs` recorded in the existing review keys. These are copies of previously checked-in public research inputs, captured from commit `5221048b6dcbc46ac3b7d189235db0d7bb50e937` before corpus v10 replaces the live inputs.

`scripts/build-puzzle-review-set.mjs` verifies these hashes before selection. Regeneration must reproduce the existing sets and keys byte for byte. Current-corpus rebuilds must neither refresh this snapshot nor rewrite a rated review. A review against new inputs needs a new explicit snapshot and review version.
