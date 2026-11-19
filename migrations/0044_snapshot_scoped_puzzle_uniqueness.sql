-- A changed upstream archive stages a second immutable snapshot of the same set,
-- whose decisions reuse the first snapshot's source drafts and picks. The original
-- key (corpus_version,set_id,source_draft_hash,pick_number) therefore made every
-- snapshot after a set's first impossible to load. Uniqueness now holds within one
-- snapshot. Rows without a snapshot (historical and components) keep the original
-- rule, because NULLS NOT DISTINCT treats their missing snapshot as one value.
-- The leading columns match the old key, so its existing lookups keep their path.
-- Concurrent build keeps gameplay writers available. A failed invalid build must be
-- investigated before retry; the corpus-wide key is dropped only after a valid build.
SET lock_timeout='5s';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS draft_run_verified_puzzles_snapshot_source_pick_uq
ON draft_run_verified_puzzles(corpus_version,set_id,source_draft_hash,pick_number,source_snapshot_id)
NULLS NOT DISTINCT;

DO $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
    WHERE c.relname='draft_run_verified_puzzles_snapshot_source_pick_uq' AND i.indisvalid AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'Snapshot-scoped puzzle uniqueness is not a valid index; investigate before dropping the corpus-wide key.';
  END IF;
END
$$;

ALTER TABLE draft_run_verified_puzzles
  DROP CONSTRAINT IF EXISTS draft_run_verified_puzzles_corpus_version_set_id_source_dra_key;
