// Keep payload reads bounded and walk the primary-key index only once across
// the corpus. A separate scan for every set repeats millions of index reads.
export async function corpusLoadCounts(query, corpusVersion, difficultyVersion, onPage = () => {}) {
  const totals = new Map();
  let after = '', scanned = 0;
  for (;;) {
    const rows = (await query(`WITH page AS MATERIALIZED (
      SELECT set_id,puzzle_id,corpus_version,payload FROM draft_run_verified_puzzles
      WHERE corpus_version=$1 AND puzzle_id>$3
      ORDER BY puzzle_id LIMIT 1000
    ) SELECT p.set_id,count(*)::int puzzles,max(p.puzzle_id) cursor,
      count(*) FILTER(WHERE r.puzzle_id IS NULL)::int unrated,
      count(*) FILTER(WHERE p.payload->>'corpus_version' IS DISTINCT FROM p.corpus_version)::int wrong_version
      FROM page p LEFT JOIN draft_run_puzzle_ratings r
        ON r.puzzle_id=p.puzzle_id AND r.difficulty_version=$2
      GROUP BY p.set_id ORDER BY p.set_id`,
    [corpusVersion, difficultyVersion, after])).rows;
    if (!rows.length) break;
    let next = after;
    for (const page of rows) {
      if (!Number.isInteger(Number(page.puzzles)) || Number(page.puzzles) <= 0) throw Error(page.set_id + ': invalid verification page');
      if (typeof page.cursor !== 'string' || page.cursor <= after) throw Error(page.set_id + ': verification cursor did not advance');
      const total = totals.get(page.set_id) || {set_id: page.set_id, puzzles: 0, unrated: 0, wrong_version: 0};
      for (const key of ['puzzles', 'unrated', 'wrong_version']) total[key] += Number(page[key]);
      totals.set(page.set_id, total);
      scanned += Number(page.puzzles);
      if (page.cursor > next) next = page.cursor;
    }
    after = next;
    onPage({puzzles_scanned: scanned, sets_seen: totals.size});
  }
  return {rows: [...totals.values()]};
}
