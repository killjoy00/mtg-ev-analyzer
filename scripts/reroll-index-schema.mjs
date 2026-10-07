import assert from 'node:assert/strict';

export const REROLL_INDEX_SCHEMA_SQL=`SELECT EXISTS(
  SELECT 1 FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_index i ON i.indexrelid=c.oid
  JOIN pg_am am ON am.oid=c.relam
  WHERE n.nspname='public' AND c.relname='draft_run_reroll_covering_idx'
    AND am.amname='btree' AND i.indrelid='public.draft_run_verified_puzzles'::regclass
    AND i.indisvalid AND i.indisready AND NOT i.indisunique
    AND i.indnkeyatts=4 AND i.indnatts=10
    AND ARRAY(SELECT pg_get_indexdef(c.oid,k,true) FROM generate_series(1,i.indnatts) k)=
      ARRAY['set_id','pick_number','corpus_version','puzzle_id','source_draft_hash',
        'candidate_count','consensus_top_gap','support_entropy','pack_number','source_snapshot_id']
    AND NOT EXISTS(SELECT 1 FROM unnest(i.indoption) option WHERE option<>0)
    AND pg_get_expr(i.indpred,i.indrelid)='(interesting AND (pack_number = 1))'
) reroll_covering_index`;

export async function verifyRerollIndexSchema(query) {
  const row=(await query(REROLL_INDEX_SCHEMA_SQL)).rows?.[0];
  assert.ok(row?.reroll_covering_index===true||row?.reroll_covering_index==='t',
    'Missing release schema prerequisite: reroll_covering_index; apply migration 0056.');
}
