// Read-only release acceptance against actual current database selection.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {corpusDatabase} from './neon-corpus-db.mjs';
import {DRAFT_RUN_CORPUS_VERSION as version,gradeDraftRunPick} from '../draft-run.mjs';
import {impliedTrophyScore,SERVING_POLICY_VERSION,SERVING_QUALITY_SQL} from '../serving-quality.mjs';
import {corpusMembership} from '../worker/corpus-components.mjs';
import {selectDatabaseRun,loadLiveSetMetadata,loadCustomSetMetadata,loadPuzzleMetadata} from '../worker/draft-run-selection.mjs';
import {liveRegularSets} from '../daily-selection.mjs';
import {gameDateKey} from '../game-date.mjs';
const query=corpusDatabase(process.argv[2]),day=gameDateKey(),parse=x=>typeof x==='string'?JSON.parse(x):x;
const inventory=(await query(`SELECT p.set_id,p.corpus_version,count(*)::int interesting,
 count(*) FILTER(WHERE ${SERVING_QUALITY_SQL})::int eligible,
 count(*) FILTER(WHERE NOT (${SERVING_QUALITY_SQL}))::int below_floor
 FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r USING(puzzle_id)
 WHERE (${corpusMembership({serving:true})}) AND p.interesting AND p.pack_number=1 AND r.difficulty_version='support-ratio-v1'
 AND p.pick_number BETWEEN CASE WHEN p.set_id='powered-cube' THEN 2 ELSE 1 END AND CASE WHEN p.set_id='powered-cube' THEN 9 ELSE 8 END
 AND NOT EXISTS(SELECT 1 FROM corpus_source_exclusions x WHERE x.set_id=p.set_id AND x.corpus_version=p.corpus_version AND x.source_draft_hash=p.source_draft_hash)
 GROUP BY p.set_id,p.corpus_version ORDER BY p.set_id,p.corpus_version`,[version])).rows;
const recent=liveRegularSets(await loadLiveSetMetadata(query,version),day).slice(0,4).map(s=>s.set_id);
let decisions=0;const timings={mixed:[],['powered-cube']:[]};
for(const environment of ['mixed','powered-cube'])for(let i=0;i<20;i++){
 const start=performance.now(),run=await selectDatabaseRun(query,version,`floor-quality-${environment}-${i}`,environment,{daily:true,day});
 timings[environment].push(Math.round(performance.now()-start));
 assert.equal(run.length,8);assert.equal(new Set(run.map(p=>p.source_draft_hash)).size,8);assert.ok(run.every(p=>impliedTrophyScore(p)>=20));
 assert.deepEqual(run.map(p=>p.pick_number),Array.from({length:8},(_,j)=>j+(environment==='powered-cube'?2:1)));
 if(environment==='mixed'){assert.ok(run.filter(p=>p.set_id===recent[0]).length>=2);assert.ok(run.filter(p=>recent.slice(1).includes(p.set_id)).length>=4);}
 decisions+=run.length;
}
const custom=await loadCustomSetMetadata(query,version,day);
for(const s of custom){const run=await selectDatabaseRun(query,version,'single-set-floor-'+s.set_id,'mixed',{setIds:[s.set_id],day});assert.ok(run.every(p=>p.set_id===s.set_id&&impliedTrophyScore(p)>=20));}
// The new selection gate must never break reading/scoring a retained decision.
const old=(await query(`SELECT p.puzzle_id,p.payload FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r USING(puzzle_id) WHERE p.corpus_version=$1 AND p.interesting AND NOT (${SERVING_QUALITY_SQL}) LIMIT 1`,[version])).rows[0];
assert.ok(old);assert.ok((await loadPuzzleMetadata(query,version,[old.puzzle_id]))[0]);const puzzle=parse(old.payload);assert.equal(gradeDraftRunPick(puzzle,puzzle.historical_pick_id).score,100);
const result={passed:true,serving_policy_version:SERVING_POLICY_VERSION,minimum_implied_trophy_score:20,day,daily_runs_checked:40,decisions_checked:decisions,custom_sets_checked:custom.length,selection_ms:timings,historical_reads_and_trophy_score_preserved:true,inventory};
fs.mkdirSync('generated',{recursive:true});fs.writeFileSync('generated/serving-quality-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
