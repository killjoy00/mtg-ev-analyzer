// Execute only through the isolated database gate, never against production.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {verifyRerollIndexSchema,REROLL_INDEX_SCHEMA_SQL} from '../scripts/reroll-index-schema.mjs';
import {impliedTrophyScore,SERVING_QUALITY_SQL} from '../serving-quality.mjs';
import {selectDraftRun,selectDraftRunReroll} from '../draft-run.mjs';
import {loadLiveSetMetadata,decodePuzzleMetadata,selectDatabaseRun,selectDatabaseReroll} from '../worker/draft-run-selection.mjs';
import {corpusMembership} from '../worker/corpus-components.mjs';
if(!process.argv.includes('--dev-fixtures'))throw Error('An isolated development branch is required.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query}=await import('../worker/growth-function.js');
await verifyRerollIndexSchema(query);
const connection=process.env.DATABASE_URL;
function pg(sql) {
  const result=spawnSync('psql',[connection,'-X','-qAt','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  return result.stdout.trim();
}
const literal=value=>value==null?'NULL':typeof value==='number'?String(value):typeof value==='boolean'?String(value):"'"+String(value).replaceAll("'","''")+"'";
const containsCoveringScan=plan=>plan['Node Type']==='Index Only Scan'&&plan['Index Name']==='draft_run_reroll_covering_idx'||(plan.Plans||[]).some(containsCoveringScan);
// Planner settings are local to these diagnostic transactions. They prove
// index-only eligibility and exact rows/order versus heap access, not a latency
// guarantee or a forced planner setting in production.
async function checkRerollPlan(source,options) {
  let statement;
  await selectDatabaseReroll(async(sql,params)=>{statement=sql.replace(/\$(\d+)\b/g,(_,n)=>literal(params[Number(n)-1]));return {rows:[]};},version,source,options);
  assert.ok(statement);
  const baseline=JSON.parse(pg(`BEGIN; SET LOCAL enable_indexonlyscan=off;
    SELECT coalesce(jsonb_agg(candidate),'[]'::jsonb) FROM (${statement}) candidate; ROLLBACK;`));
  const output=pg(`BEGIN; SET LOCAL enable_indexonlyscan=on; SET LOCAL enable_bitmapscan=off; SET LOCAL enable_seqscan=off;
    SELECT coalesce(jsonb_agg(candidate),'[]'::jsonb) FROM (${statement}) candidate;
    EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${statement}; ROLLBACK;`);
  const boundary=output.indexOf('\n'),covered=JSON.parse(output.slice(0,boundary)),plan=JSON.parse(output.slice(boundary+1));
  assert.ok(baseline.length,'real serving pool supplies reroll candidates');
  assert.deepEqual(covered,baseline,'covering access preserves all 20 candidate rows and their exact order');
  assert.ok(containsCoveringScan(plan[0].Plan),'unchanged production SQL admits snapshot-aware index-only access');
  console.log(JSON.stringify({check:'reroll-covering-index',environment:options.environment,set:source.set_id,rows:covered.length,execution_ms:plan[0]['Execution Time']}));
}
const tag=crypto.randomUUID().replaceAll('-',''),pTable=`qa_selection_p_${tag}`,rTable=`qa_selection_r_${tag}`;
const {DRAFT_RUN_CORPUS_VERSION:version}=await import('../draft-run.mjs');
try {
  // Stratify the actual serving pool across every available set, pick and band.
  // Staged and retained snapshots can share a version with the active snapshot;
  // their puzzles must not enter the exhaustive reference or displace its rows.
  // SQL retains each stored real's text representation, matching the API loader.
  await query(`CREATE TABLE ${pTable} AS SELECT * FROM (
    SELECT p.puzzle_id,p.corpus_version,p.source_snapshot_id,p.interesting,p.set_id,p.source_draft_hash,p.pack_number,p.pick_number,p.candidate_count,p.consensus_top_gap,p.support_entropy,
      row_number() OVER(PARTITION BY p.set_id,p.pick_number,r.band ORDER BY p.puzzle_id) fixture_row
    FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
    WHERE (${corpusMembership({serving:true})}) AND p.interesting AND NOT EXISTS(SELECT 1 FROM corpus_source_exclusions x WHERE x.set_id=p.set_id AND x.corpus_version=p.corpus_version AND x.source_draft_hash=p.source_draft_hash)
  ) p WHERE fixture_row<=8`,[version]);
  await query(`CREATE TABLE ${rTable} AS SELECT r.* FROM draft_run_puzzle_ratings r JOIN ${pTable} p USING(puzzle_id)`);
  const fixtureQuery=(sql,params)=>query(sql.replaceAll('draft_run_verified_puzzles',pTable).replaceAll('draft_run_puzzle_ratings',rTable),params);
  const pool=(await query(`SELECT p.*,r.difficulty_version,r.rating,r.top_two_ratio,r.target_support_ratio FROM ${pTable} p JOIN ${rTable} r USING(puzzle_id)`)).rows.map(decodePuzzleMetadata);
  const metadata=await loadLiveSetMetadata(query,version);
  for(const selectionVersion of ['eight-pick-v4','eight-pick-v3','first-pack-v2'])for(const environment of ['mixed','powered-cube'])for(const daily of [false,true])for(const seed of ['selection-check-a','selection-check-b']) {
    const expected=selectDraftRun(pool,seed,environment,{daily,selectionVersion,metadata:selectionVersion==='eight-pick-v4'?metadata:null});
    const actual=await selectDatabaseRun(fixtureQuery,version,seed,environment,{daily,selectionVersion,metadata:selectionVersion==='eight-pick-v4'?metadata:null});
    assert.ok(actual.every(p=>impliedTrophyScore(p)>=20),'New selections respect the implied trophy score floor');
    assert.deepEqual(actual.map(p=>p.puzzle_id),expected.map(p=>p.puzzle_id),`${selectionVersion}/${environment}/${daily}/${seed}: exact selector parity`);
    if(selectionVersion==='eight-pick-v4'&&!daily&&seed==='selection-check-a')
      await checkRerollPlan(expected[0],{type:'pack',round:0,seed,environment,selectionVersion,excludedSources:expected.map(p=>p.source_draft_hash)});
    for(const type of environment==='powered-cube'?['pack']:['pack','set'])for(const round of (selectionVersion.startsWith('eight-pick')?[0,4,7]:[0,5,9])) {
      const options={type,round,seed,environment,daily,selectionVersion,excludedSources:expected.map(p=>p.source_draft_hash)};
      assert.equal((await selectDatabaseReroll(fixtureQuery,version,expected[round],options))?.puzzle_id,
        selectDraftRunReroll(pool,expected[round],options)?.puzzle_id,`reroll parity: ${environment}/${type}/${round}`);
    }
  }
  // One corrupt/unrated entry cannot take otherwise eligible rounds offline.
  await query(`DELETE FROM ${rTable} WHERE puzzle_id=(SELECT puzzle_id FROM ${rTable} LIMIT 1)`);
  assert.equal((await selectDatabaseRun(fixtureQuery,version,'missing-rating','mixed')).length,8);
  // A valid index with the right name and columns can still be useless when
  // its predicate excludes all rows. Release verification must reject it.
  const weakened=pg(`BEGIN; ALTER INDEX draft_run_reroll_covering_idx RENAME TO qa_original_reroll_${tag};
    CREATE INDEX draft_run_reroll_covering_idx ON draft_run_verified_puzzles(set_id,pick_number,corpus_version,puzzle_id)
    INCLUDE(source_draft_hash,candidate_count,consensus_top_gap,support_entropy,pack_number,source_snapshot_id) WHERE false;
    ${REROLL_INDEX_SCHEMA_SQL}; ROLLBACK;`);
  assert.equal(weakened,'f','incorrect partial predicate fails release verification');
  await verifyRerollIndexSchema(query);
  console.log('Database selection matches the exhaustive reference across mixed/Cube, practice/Daily and rerolls; missing ratings are isolated.');
} finally {
  await query(`DROP TABLE IF EXISTS ${rTable}`);
  await query(`DROP TABLE IF EXISTS ${pTable}`);
}
