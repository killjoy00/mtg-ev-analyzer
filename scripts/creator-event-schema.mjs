import assert from 'node:assert/strict';

// Compare catalog structure, not names or substrings in arbitrary predicates.
export const CREATOR_EVENT_SCHEMA_SQL=`WITH expected_triggers(name,type,function_name,new_table) AS (
  VALUES
    ('creator_challenge_event_insert_guard',7,'pack1_creator_event_write_guard()',NULL::text),
    ('creator_challenge_event_update_guard',19,'pack1_creator_event_write_guard()',NULL::text),
    ('creator_challenge_event_update_dedupe',16,'pack1_creator_event_update_dedupe()','creator_event_updates')
), expected_indexes(name,keys,predicate) AS (
  VALUES
    ('analytics_creator_challenge_event_lookup_idx',
      ARRAY['player_id','event_name',\$key\$(event_props ->> 'creator_challenge_id'::text)\$key\$,'created_at','id'],
      \$predicate\$((player_id IS NOT NULL) AND (event_name = ANY (ARRAY['creator_challenge_open'::text, 'acquisition_touch'::text])) AND (event_props ? 'creator_challenge_id'::text))\$predicate\$),
    ('analytics_creator_challenge_funnel_idx',
      ARRAY[\$key\$(event_props ->> 'creator_challenge_id'::text)\$key\$,'event_name','player_id'],
      \$predicate\$((event_name = ANY (ARRAY['creator_challenge_open'::text, 'creator_challenge_started'::text])) AND (event_props ? 'creator_challenge_id'::text))\$predicate\$)
)
SELECT
  NOT EXISTS (
    SELECT 1 FROM expected_triggers e WHERE NOT EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgname=e.name AND t.tgrelid='public.analytics_events'::regclass
        AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
        AND t.tgtype=e.type AND t.tgattr::text='' AND t.tgqual IS NULL
        AND octet_length(t.tgargs)=0
        AND t.tgfoid=to_regprocedure('public.'||e.function_name)
        AND t.tgnewtable IS NOT DISTINCT FROM e.new_table
        AND t.tgoldtable IS NULL
    )
  ) creator_event_trigger_definitions,
  NOT EXISTS (
    SELECT 1 FROM expected_indexes e WHERE NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_index i ON i.indexrelid=c.oid
      JOIN pg_am am ON am.oid=c.relam
      WHERE n.nspname='public' AND c.relname=e.name AND am.amname='btree'
        AND i.indrelid='public.analytics_events'::regclass
        AND i.indisvalid AND i.indisready AND NOT i.indisunique
        AND i.indnkeyatts=cardinality(e.keys) AND i.indnatts=i.indnkeyatts
        AND ARRAY(SELECT pg_get_indexdef(c.oid,k,true) FROM generate_series(1,i.indnkeyatts) k)=e.keys
        AND NOT EXISTS(SELECT 1 FROM unnest(i.indoption) option WHERE option<>0)
        AND pg_get_expr(i.indpred,i.indrelid)=e.predicate
    )
  ) creator_event_index_definitions,
  to_regclass('public.analytics_creator_challenge_event_uq') IS NULL creator_event_no_unique_index,
  to_regprocedure('public.pack1_creator_event_assert_read_committed()') IS NOT NULL creator_event_isolation_guard,
  EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.pack1_creator_event_write_guard()')
    AND position('pack1_creator_event_assert_read_committed()' in p.prosrc)>0
    AND position('pg_try_advisory_xact_lock' in p.prosrc)>0) creator_event_safe_update_guard,
  EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('public.merge_pack1_player(uuid,uuid)')
    AND position('pack1_creator_event_player_lock' in p.prosrc)>0
    AND position('creator_funnel_ranked' in p.prosrc)>0) creator_event_merge_guard`;

export async function verifyCreatorEventSchema(query) {
  const result=await query(CREATOR_EVENT_SCHEMA_SQL);
  assert.ok(result.rows?.[0],'Missing creator-event schema verification result');
  for(const [name,value] of Object.entries(result.rows[0]))
    assert.ok(value===true||value==='t',`Missing release schema prerequisite: ${name}; apply migrations through 0055.`);
}
