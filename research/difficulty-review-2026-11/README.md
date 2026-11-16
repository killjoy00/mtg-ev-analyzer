# Difficulty and Easy-puzzle review inputs (November 2026)

Evidence for [docs/DIFFICULTY-REVIEW-2026-11.md](../../docs/DIFFICULTY-REVIEW-2026-11.md).

- `exports.sql`: the read-only queries. Most return one row per puzzle with
  aggregate counts only. The practice-answer export returns one row per
  answer with an anonymous player index, numbered afresh by each run, so that
  intervals can resample whole players. No player, account, session or device
  identifier leaves the database, and nothing is written.
- `evaluate.mjs`: prints the aggregate tables from those exports. It scores
  every puzzle with the shipped feature code (`puzzle-selection.mjs`), so the
  tables describe the rule as released.

The exports are private. Keep them outside the repository, and do not commit
them or paste per-puzzle counts into issues or pull requests
([public information policy](../../docs/PUBLIC-INFORMATION-POLICY.md)).

```sh
# Save each query's rows as JSON into one private directory:
#   answers.json  meta.json  practice_easy.json  practice_answers.json  pool_<sets>.json
node research/difficulty-review-2026-11/evaluate.mjs /path/to/private/exports
```

The practice exports are the holdout: their puzzles were drawn at random from
the easy band of 27 sets. One rule was written down before they were read and
passed there. The shipped rule relaxes it and was settled afterwards, so its
numbers on this export are exploratory. The review says what was
pre-registered, what changed, and which forward check is still owed.
