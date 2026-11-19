// Fixed metadata-only maintenance. Never analyze the large JSON puzzle payload,
// accept caller-supplied SQL, or refresh on the player request path.
export const SERVING_STATISTICS_COLUMNS=Object.freeze({
  draft_run_verified_puzzles:Object.freeze(['corpus_version','interesting','pack_number','set_id','pick_number','puzzle_id','source_draft_hash','candidate_count','consensus_top_gap','support_entropy']),
  draft_run_puzzle_ratings:Object.freeze(['difficulty_version','puzzle_id','band','rating','top_two_ratio','target_support_ratio']),
});
export const SERVING_ANALYZE_SQL=Object.freeze(Object.entries(SERVING_STATISTICS_COLUMNS)
  .map(([table,columns])=>`ANALYZE public.${table} (${columns.join(', ')})`));

// Small registries seldom reach the automatic ANALYZE threshold, but their
// cardinality estimates determine the plan for joins over millions of ratings.
export const SOURCE_ANALYZE_SQL=Object.freeze([
  'ANALYZE public.corpus_components (parent_version, component_version, set_id, status)',
  'ANALYZE public.corpus_source_exclusions (corpus_version, set_id, source_draft_hash)',
]);
export async function refreshSourceStatistics(query) {
  for(const sql of SOURCE_ANALYZE_SQL)await query(sql);
}

export const SERVING_STATISTICS_READY_SQL=`SELECT ${Object.entries(SERVING_STATISTICS_COLUMNS)
  .map(([table,columns])=>`(SELECT count(*)=${columns.length} FROM pg_stats WHERE schemaname='public' AND tablename='${table}' AND attname IN (${columns.map(column=>`'${column}'`).join(',')})) AS ${table}`)
  .join(',\n')}`;

export async function verifyServingStatistics(query) {
  const {rows}=await query(SERVING_STATISTICS_READY_SQL);
  for(const table of Object.keys(SERVING_STATISTICS_COLUMNS)) {
    if(![true,'t'].includes(rows[0]?.[table]))throw Error(`Missing serving statistics for ${table}; apply migration 0015 or finish the import/backfill statistics refresh.`);
  }
}

export async function refreshServingStatistics(query) {
  for(const sql of SERVING_ANALYZE_SQL)await query(sql);
  await refreshSourceStatistics(query);
  // ANALYZE can warn and skip a table when the role lacks permission. Do not
  // report successful readiness if the required statistics are still absent.
  await verifyServingStatistics(query);
  return {analyzed_tables:Object.keys(SERVING_STATISTICS_COLUMNS)};
}
