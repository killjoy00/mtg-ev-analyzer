// Keep payload reads bounded: a full corpus contains millions of toasted JSON
// values, so one aggregate can exceed the database HTTP request deadline.
export async function corpusLoadCounts(query, corpusVersion, difficultyVersion, onSet = () => {}) {
  const sets = (await query('SELECT DISTINCT set_id FROM draft_run_verified_puzzles WHERE corpus_version=$1 ORDER BY set_id', [corpusVersion])).rows;
  const rows = [];
  for (const {set_id} of sets) {
    const total = {set_id, puzzles: 0, unrated: 0, wrong_version: 0};
    let after = '';
    for (;;) {
      const page = (await query(`WITH page AS MATERIALIZED (
        SELECT puzzle_id,corpus_version,payload FROM draft_run_verified_puzzles
        WHERE corpus_version=$1 AND set_id=$3 AND puzzle_id>$4
        ORDER BY puzzle_id LIMIT 1000
      ) SELECT count(*)::int puzzles,max(p.puzzle_id) cursor,
        count(*) FILTER(WHERE r.puzzle_id IS NULL)::int unrated,
        count(*) FILTER(WHERE p.payload->>'corpus_version' IS DISTINCT FROM p.corpus_version)::int wrong_version
        FROM page p LEFT JOIN draft_run_puzzle_ratings r
          ON r.puzzle_id=p.puzzle_id AND r.difficulty_version=$2`,
      [corpusVersion, difficultyVersion, set_id, after])).rows[0];
      if (!page || !Number.isInteger(Number(page.puzzles)) || Number(page.puzzles) < 0) throw Error(set_id + ': invalid verification page');
      if (!Number(page.puzzles)) break;
      if (typeof page.cursor !== 'string' || page.cursor <= after) throw Error(set_id + ': verification cursor did not advance');
      for (const key of ['puzzles', 'unrated', 'wrong_version']) total[key] += Number(page[key]);
      after = page.cursor;
    }
    rows.push(total);
    onSet(total);
  }
  return {rows};
}
