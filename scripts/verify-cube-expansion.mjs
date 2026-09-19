import {impliedTrophyScore,meetsServingQuality,SERVING_POLICY_VERSION} from '../serving-quality.mjs';
// Read-only: exercise actual SQL selection and a large in-memory simulation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {corpusDatabase} from './neon-corpus-db.mjs';
import {DRAFT_RUN_CORPUS_VERSION as parent,selectDraftRun,gradeDraftRunPick,validateDraftRunPuzzle} from '../draft-run.mjs';
import {CUBE_TRADITIONAL_COMPONENT_VERSION as component} from '../corpus-components.mjs';
import {corpusMembership} from '../worker/corpus-components.mjs';
import {selectDatabaseRun,decodePuzzleMetadata} from '../worker/draft-run-selection.mjs';
const query=corpusDatabase(process.argv[2]),parse=x=>typeof x==='string'?JSON.parse(x):x;
const rows=(await query(`SELECT p.puzzle_id,p.set_id,p.corpus_version,p.source_draft_hash,p.pack_number,p.pick_number,p.candidate_count,p.consensus_top_gap,p.support_entropy,r.difficulty_version,r.rating,r.top_two_ratio,r.target_support_ratio,r.band
 FROM draft_run_verified_puzzles p JOIN draft_run_puzzle_ratings r USING(puzzle_id) WHERE (${corpusMembership({serving:true})}) AND p.set_id='powered-cube' AND p.interesting AND p.pack_number=1 AND p.pick_number BETWEEN 2 AND 9 AND r.difficulty_version='support-ratio-v1'`,[parent])).rows.map(decodePuzzleMetadata);
assert.equal(rows.filter(p=>p.corpus_version===component).length,1295);
assert.ok(rows.filter(p=>p.corpus_version===component).every(p=>p.pick_number<=7));
const eligible=rows.filter(meetsServingQuality);
const check=run=>{assert.ok(run.every(p=>impliedTrophyScore(p)>=20));assert.equal(run.length,8);assert.equal(new Set(run.map(p=>p.source_draft_hash)).size,8);assert.deepEqual(run.map(p=>p.pick_number),[2,3,4,5,6,7,8,9]);assert.ok(run.slice(6).every(p=>p.corpus_version===parent));};
let traditional=0,sqlTraditional=0;const byPick={};
for(let i=0;i<10000;i++){const run=selectDraftRun(rows,'cube-source-'+i,'powered-cube');check(run);for(const p of run)if(p.corpus_version===component){traditional++;byPick[p.pick_number]=(byPick[p.pick_number]||0)+1;}}
for(let i=0;i<20;i++){const seed='cube-source-'+i,run=await selectDatabaseRun(query,parent,seed,'powered-cube');check(run);assert.deepEqual(run.map(p=>p.puzzle_id),selectDraftRun(rows,seed,'powered-cube').map(p=>p.puzzle_id));sqlTraditional+=run.filter(p=>p.corpus_version===component).length;}
assert.ok(traditional>0&&sqlTraditional>0,'Expanded inventory participates in ordinary selection');
const puzzles=(await query('SELECT payload FROM draft_run_verified_puzzles WHERE corpus_version=$1',[component])).rows.map(r=>parse(r.payload));
for(const p of puzzles){assert.ok(validateDraftRunPuzzle(p,component));assert.equal(gradeDraftRunPick(p,p.historical_pick_id).score,100);for(const c of p.candidates)if(c.id!==p.historical_pick_id)assert.ok(gradeDraftRunPick(p,c.id).score<=95);}
const evidence={passed:true,serving_policy_version:SERVING_POLICY_VERSION,traditional_serving_decisions:eligible.filter(p=>p.corpus_version===component).length,runs:10000,sql_runs:20,traditional_decisions_selected:traditional,sql_traditional_decisions_selected:sqlTraditional,traditional_by_pick:byPick,model_changed:false};
fs.mkdirSync('generated',{recursive:true});fs.writeFileSync('generated/cube-expansion-verification.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
