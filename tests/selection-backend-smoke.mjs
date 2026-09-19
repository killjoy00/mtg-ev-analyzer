// Execute only through the isolated database gate, never against production.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {impliedTrophyScore,SERVING_QUALITY_SQL} from '../serving-quality.mjs';
import {selectDraftRun,selectDraftRunReroll} from '../draft-run.mjs';
import {loadLiveSetMetadata,decodePuzzleMetadata,selectDatabaseRun,selectDatabaseReroll} from '../worker/draft-run-selection.mjs';
if(!process.argv.includes('--dev-fixtures'))throw Error('An isolated development branch is required.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {query}=await import('../worker/growth-function.js');
const tag=crypto.randomUUID().replaceAll('-',''),pTable=`qa_selection_p_${tag}`,rTable=`qa_selection_r_${tag}`;
const {DRAFT_RUN_CORPUS_VERSION:version}=await import('../draft-run.mjs');
try {
  // Stratify a real-data fixture across every available set, pick and band.
  // SQL retains each stored real's text representation, matching the API loader.
  await query(`CREATE TABLE ${pTable} AS SELECT * FROM (
    SELECT p.puzzle_id,p.corpus_version,p.interesting,p.set_id,p.source_draft_hash,p.pack_number,p.pick_number,p.candidate_count,p.consensus_top_gap,p.support_entropy,
      row_number() OVER(PARTITION BY p.set_id,p.pick_number,r.band ORDER BY p.puzzle_id) fixture_row
    FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
    WHERE p.corpus_version=$1 AND p.interesting AND NOT EXISTS(SELECT 1 FROM corpus_source_exclusions x WHERE x.set_id=p.set_id AND x.corpus_version=p.corpus_version AND x.source_draft_hash=p.source_draft_hash)
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
    for(const type of environment==='powered-cube'?['pack']:['pack','set'])for(const round of (selectionVersion.startsWith('eight-pick')?[0,4,7]:[0,5,9])) {
      const options={type,round,seed,environment,daily,selectionVersion,excludedSources:expected.map(p=>p.source_draft_hash)};
      assert.equal((await selectDatabaseReroll(fixtureQuery,version,expected[round],options))?.puzzle_id,
        selectDraftRunReroll(pool,expected[round],options)?.puzzle_id,`reroll parity: ${environment}/${type}/${round}`);
    }
  }
  // One corrupt/unrated entry cannot take otherwise eligible rounds offline.
  await query(`DELETE FROM ${rTable} WHERE puzzle_id=(SELECT puzzle_id FROM ${rTable} LIMIT 1)`);
  assert.equal((await selectDatabaseRun(fixtureQuery,version,'missing-rating','mixed')).length,8);
  console.log('Database selection matches the exhaustive reference across mixed/Cube, practice/Daily and rerolls; missing ratings are isolated.');
} finally {
  await query(`DROP TABLE IF EXISTS ${rTable}`);
  await query(`DROP TABLE IF EXISTS ${pTable}`);
}
