// Bound each SQL response while retaining every eligible decision in the pool.
export async function loadVerifiedPool(query, version, pageSize = 5000) {
  const rows = [];
  let after = '';
  for (;;) {
    // Bound both sides of a merge join: otherwise every later page rescans
    // the ratings index from its beginning, making a full load quadratic.
    const result = await query(`SELECT p.puzzle_id,p.set_id,p.source_draft_hash,p.pick_number,p.candidate_count,p.consensus_top_gap,p.support_entropy,r.difficulty_version,r.rating,r.top_two_ratio,r.target_support_ratio FROM draft_run_verified_puzzles p LEFT JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1' AND r.puzzle_id>$2 WHERE p.corpus_version=$1 AND p.interesting AND p.puzzle_id>$2 ORDER BY p.puzzle_id LIMIT $3`, [version, after, pageSize]);
    for (const p of result.rows) {
      if (p.puzzle_id <= after) throw Error('Verified pool pagination did not advance');
      if(p.difficulty_version!=='support-ratio-v1' || p.top_two_ratio==null || !Number.isFinite(Number(p.top_two_ratio))) throw Error('Verified puzzle is missing its difficulty rating');
      rows.push({...p, rating:Number(p.rating),top_two_ratio:Number(p.top_two_ratio),target_support_ratio:Number(p.target_support_ratio),pick_number:Number(p.pick_number), candidate_count:Number(p.candidate_count), consensus_top_gap:Number(p.consensus_top_gap), support_entropy:Number(p.support_entropy)});
      after = p.puzzle_id;
    }
    if (result.rows.length < pageSize) return rows;
  }
}
