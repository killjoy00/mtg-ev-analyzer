// node scripts/backfill_draft_run_ratings.mjs CONNECTION_FILE
// Resumable derived-data backfill. Never rewrites a puzzle or its score.
import fs from 'node:fs';
const connection=fs.readFileSync(process.argv[2],'utf8').trim();
const host=new URL(connection).hostname;
const endpoint=`https://api.${host.split('.').slice(1).join('.')}/sql`;
async function query(query,params=[]) {
  for(let attempt=0;attempt<3;attempt++) {
    const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','Neon-Connection-String':connection},body:JSON.stringify({query,params}),signal:AbortSignal.timeout(120000)});
    if(r.ok)return r.json();
    if(![429,502,503,504].includes(r.status)||attempt===2)throw Error(`Rating backfill HTTP ${r.status}`);
  }
}
const sets=(await query('SELECT set_id FROM draft_run_verified_sets ORDER BY set_id')).rows.map(r=>r.set_id);
let next=0;
await Promise.all(Array.from({length:2},async()=>{
while(next<sets.length){
const set=sets[next++];let after='',total=0;
for(;;) {
  const {rows:[r]}=await query(`WITH batch AS MATERIALIZED (
    SELECT p.puzzle_id,p.payload FROM draft_run_verified_puzzles p
    WHERE p.puzzle_id>$1 AND p.set_id=$2 AND NOT EXISTS (SELECT 1 FROM draft_run_puzzle_ratings r WHERE r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1')
    ORDER BY p.puzzle_id LIMIT 50000
  ), added AS (
    INSERT INTO draft_run_puzzle_ratings(puzzle_id,difficulty_version,rating,top_two_ratio,target_support_ratio)
    SELECT b.puzzle_id,'support-ratio-v1',r.* FROM batch b CROSS JOIN LATERAL draft_run_rate_v1(b.payload) r
    ON CONFLICT DO NOTHING RETURNING puzzle_id
  ) SELECT max(puzzle_id) AS cursor,count(*)::int AS scanned,(SELECT count(*)::int FROM added) AS added FROM batch`,[after,set]);
  if(!r.scanned)break;
  if(r.cursor<=after)throw Error('Rating cursor did not advance');
  after=r.cursor;total+=Number(r.added);
  console.log(JSON.stringify({set,added:total,cursor:after}));
}
}
}));
const {rows:[r]}=await query(`SELECT count(*)::int AS missing FROM draft_run_verified_puzzles p WHERE NOT EXISTS
  (SELECT 1 FROM draft_run_puzzle_ratings r WHERE r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1')`);
if(r.missing)throw Error(`${r.missing} puzzles still lack difficulty ratings`);
console.log('All puzzles have versioned difficulty ratings.');
