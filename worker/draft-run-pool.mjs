// Bound each SQL response while retaining every eligible decision in the pool.
export async function loadVerifiedPool(query, version, pageSize = 5000) {
  const rows = [];
  let after = '';
  for (;;) {
    const result = await query(`SELECT puzzle_id,set_id,source_draft_hash,pick_number,candidate_count,consensus_top_gap,support_entropy FROM draft_run_verified_puzzles WHERE corpus_version=$1 AND interesting AND puzzle_id>$2 ORDER BY puzzle_id LIMIT $3`, [version, after, pageSize]);
    for (const p of result.rows) {
      if (p.puzzle_id <= after) throw Error('Verified pool pagination did not advance');
      rows.push({...p, pick_number:Number(p.pick_number), candidate_count:Number(p.candidate_count), consensus_top_gap:Number(p.consensus_top_gap), support_entropy:Number(p.support_entropy)});
      after = p.puzzle_id;
    }
    if (result.rows.length < pageSize) return rows;
  }
}
