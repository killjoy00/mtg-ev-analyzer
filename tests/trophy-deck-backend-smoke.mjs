// Owned-run and locked-pick authorization against an isolated database.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {withPracticeAccess} from './practice-access-fixture.mjs';
import {encoded} from '../corpus/trophy-decks/fra.mjs';
import {corpusMembership} from '../worker/corpus-components.mjs';
import {DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_SCORING_VERSION} from '../draft-run.mjs';
if(!process.argv.includes('--dev-fixtures'))throw Error('Use an isolated database and --dev-fixtures.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();
const {default:growth,query}=await import('../worker/growth-function.js');
const {default:api}=await import('../worker/draft-run-function.mjs');
const catalog=JSON.parse(gunzipSync(Buffer.from(encoded,'base64')));
async function call(service,path,body,token,status=200) {
  const request=new Request('https://packone.pro'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await withPracticeAccess(request,query,r=>service.fetch(r));
  const value=await result.json();assert.equal(result.status,status,path+': '+JSON.stringify(value));return value;
}
const owner=await call(growth,'/v1/session',{displayName:'QA deck owner'});
const other=await call(growth,'/v1/session',{displayName:'QA deck other'});
const rows=(await query(`SELECT p.puzzle_id,p.source_draft_hash FROM draft_run_verified_puzzles p WHERE p.set_id='fra' AND p.source_draft_hash IN(SELECT jsonb_array_elements_text($1::jsonb)) AND ${corpusMembership({parameter:2})} LIMIT 8`,[JSON.stringify(Object.keys(catalog.sources)),DRAFT_RUN_CORPUS_VERSION])).rows;
assert.equal(rows.length,8,'Real FRA source fixtures are available');
// Seed only this isolated session. Deck authorization does not depend on the
// mutable selection cache left by other integration suites.
let run=(await query(`INSERT INTO draft_run_sessions(player_id,seed,corpus_version,scoring_version,puzzle_ids,seen_sources,measurement_qa)
 VALUES($1::uuid,'qa-trophy-decks',$2,$3,$4::jsonb,$5::jsonb,true) RETURNING id`,[owner.playerId,DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_SCORING_VERSION,JSON.stringify(rows.map(row=>row.puzzle_id)),JSON.stringify(rows.map(row=>row.source_draft_hash))])).rows[0];
run=await call(api,`/v1/runs/${run.id}`,undefined,owner.token);
assert.equal(run.answers.length,0);assert.equal(run.current.deckAvailable,undefined);
await call(api,`/v1/runs/${run.id}/deck?round=0`,undefined,owner.token,403);
await call(api,`/v1/runs/${run.id}/deck?round=0`,undefined,other.token,404);
run=await call(api,`/v1/runs/${run.id}/pick`,{revision:run.revision,round:0,puzzleId:run.current.puzzle_id,cardId:run.current.candidates[0].id},owner.token);
assert.equal(run.answers[0].deckAvailable,true);assert.equal(run.answers[0].deck,undefined);
const deck=await call(api,`/v1/runs/${run.id}/deck?round=0`,undefined,owner.token);
assert.equal(deck.deck.reduce((sum,card)=>sum+card.count,0),deck.size);
assert.ok(deck.size>=40);assert.ok(deck.sideboard.length>0);
await call(api,`/v1/runs/${run.id}/deck?round=1`,undefined,owner.token,403);
await call(api,`/v1/runs/${run.id}/deck?round=-1`,undefined,owner.token,400);
await call(api,`/v1/runs/${run.id}/deck?round=0`,undefined,other.token,404);
console.log('Trophy decks verified: owner-only access, locked-round gating, archived source lookup, exact card counts, and lazy payloads.');
