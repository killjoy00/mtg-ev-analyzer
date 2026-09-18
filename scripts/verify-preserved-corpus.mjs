import fs from 'node:fs';
import assert from 'node:assert/strict';
import {corpusDatabase} from './neon-corpus-db.mjs';
import {DRAFT_RUN_CORPUS_VERSION as parent} from '../draft-run.mjs';
const query=corpusDatabase(process.argv[2]),file=process.argv[3];
const parse=x=>typeof x==='string'?JSON.parse(x):x;
const parentState=(await query("SELECT count(*)::int puzzles,md5(string_agg(puzzle_id||md5(payload::text),',' ORDER BY puzzle_id)) payload_hash FROM draft_run_verified_puzzles WHERE corpus_version=$1 AND set_id='powered-cube'",[parent])).rows[0];
const schedules=(await query("SELECT day::text||'|'||environment id,corpus_version,puzzle_ids,scoring_version,selection_version FROM draft_run_schedules ORDER BY day,environment")).rows.map(r=>({...r,puzzle_ids:parse(r.puzzle_ids)}));
if(process.argv.includes('--capture'))fs.writeFileSync(file,JSON.stringify({parentState,schedules}));
else {const before=JSON.parse(fs.readFileSync(file));assert.deepEqual(parentState,before.parentState,'Existing Premier Cube payloads unchanged');const now=new Map(schedules.map(r=>[r.id,r]));for(const s of before.schedules)assert.deepEqual(now.get(s.id),s,'Existing universal Daily remains fixed: '+s.id);console.log(JSON.stringify({premier_cube_puzzles_preserved:Number(parentState.puzzles),existing_dailies_preserved:before.schedules.length,payload_hash:parentState.payload_hash}));}
