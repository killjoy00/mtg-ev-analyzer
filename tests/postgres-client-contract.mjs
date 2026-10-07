import assert from 'node:assert/strict';
import {fixturePool,postgresTransport,SQL_CONNECTION,textTypes} from './support/postgres-fixture.mjs';
import {gateway} from '../edge/gateway.mjs';
import {DRAFT_RUN_SELECTION_VERSION} from '../draft-run-policy.mjs';
const pool=fixturePool(),sql=postgresTransport(pool);
const secret='a'.repeat(64),cookies=new Map(),memory=new Map();
process.env.DATABASE_URL=SQL_CONNECTION;
process.env.PACK1_REQUIRE_INGRESS='1';process.env.PACK1_INGRESS_SECRET=secret;
const {default:growth}=await import('../worker/growth-function.js');
const {default:draft}=await import('../worker/draft-run-function.mjs');
const env={MODE:'preview',NEON_BRANCH_ID:'br-ci-fixture',QUOTA_KEY:secret,PREVIEW_KEY:secret,ORIGIN_SECRET:secret,
  NETWORK_QUOTA:{idFromName:value=>value,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
globalThis.window={PACK1_API:{growthUrl:'https://api-preview.packone.pro/growth',draftRunUrl:'https://api-preview.packone.pro/draft',firstParty:true}};
globalThis.document={cookie:''};
globalThis.localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value),removeItem:key=>memory.delete(key)};
memory.set('pack1-player-name-v1','QA wire contract');
globalThis.fetch=async(url,options={})=>{
  if(String(url)==='https://api.us-east-2.aws.neon.tech/sql')return sql(url,options);
  const target=new URL(url);
  if(target.hostname!=='api-preview.packone.pro')throw Error('Unexpected external request: '+target.hostname);
  const headers=new Headers(options.headers);headers.set('origin','https://packone.pro');
  headers.set('cf-connecting-ip','192.0.2.1');headers.set('x-pack1-preview-key',secret);
  if(cookies.size)headers.set('cookie',[...cookies].map(([key,value])=>key+'='+value).join('; '));
  const response=await gateway(new Request(url,{...options,headers}),env,async(upstream,init)=>{
    const host=new URL(upstream).hostname;
    const service=host==='br-ci-fixture-pack1growth.compute.c-5.us-east-2.aws.neon.tech'?growth:
      host==='br-ci-fixture-draftrunapi.compute.c-5.us-east-2.aws.neon.tech'?draft:null;
    assert.ok(service,'Gateway must target only the fixture branch');
    return service.fetch(new Request(upstream,init));
  });
  for(const line of response.headers.getSetCookie()) {
    const [key,value]=line.split(';')[0].split('=');cookies.set(key,value);
  }
  return response;
};
async function request(path,body,status=200) {
  const response=await fetch('https://api-preview.packone.pro/draft'+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();
  if(Array.isArray(status)){assert.ok(status.includes(response.status),`${path}: ${response.status} ${JSON.stringify(result)}`);return {status:response.status,body:result};}
  assert.equal(response.status,status,`${path}: ${JSON.stringify(result)}`);return result;
}
try {
  const client=await import('../growth-api.mjs');
  const player=await client.ensurePackSession();assert.ok(player.playerId);
  assert.ok(cookies.get('__Host-pack1_player'),'Actual client must receive its first-party player cookie');
  const status=await client.loadDailyStatus();assert.ok(status);
  const bypass=await draft.fetch(new Request('https://fixture.invalid/v1/daily-status'));
  assert.equal(bypass.status,403,'Worker must reject bypassing the gateway');
  for(const environment of ['mixed','powered-cube','latest']) {
    let run=await request('/v1/runs',{daily:true,environment});
    assert.equal(run.selection_version,DRAFT_RUN_SELECTION_VERSION);assert.equal(run.run_length,8);
    assert.equal((await request('/v1/runs',{daily:true,environment})).id,run.id,'Daily retry must recover the same persisted run');
    assert.equal(run.current.historical_pick_id,undefined,'Unanswered API response must conceal the answer');
    for(let round=0;round<8;round++) {
      const body={revision:run.revision,round,puzzleId:run.current.puzzle_id,cardId:run.current.candidates[0].id};
      const other=run.current.candidates[1].id;
      // The API uses optimistic concurrency: an overlapping write may return
      // 409, while retrying an already persisted identical pick is idempotent.
      const outcomes=await Promise.all([request(`/v1/runs/${run.id}/pick`,body,[200,409]),request(`/v1/runs/${run.id}/pick`,body,[200,409])]);
      const accepted=outcomes.filter(result=>result.status===200);assert.ok(accepted.length>=1);
      assert.equal(accepted[0].body.revision,body.revision+1,'Exactly one revision must be persisted');
      for(const result of accepted)assert.equal(result.body.revision,accepted[0].body.revision);
      run=await request(`/v1/runs/${run.id}`);assert.equal(run.revision,accepted[0].body.revision);
      assert.equal((await request(`/v1/runs/${run.id}/pick`,body)).revision,run.revision,'An identical persisted pick must be retryable');
      await request(`/v1/runs/${run.id}/pick`,{...body,cardId:other},409);
    }
    assert.equal(run.complete,true);assert.equal(run.answers.length,8);assert.ok(Number.isFinite(run.score));
    await request(`/v1/runs/${run.id}`);
    const result=await pool.query({text:'SELECT count(*)::text n FROM game_results WHERE player_id=$1::uuid AND client_result_id=$2',values:[player.playerId,'draft-run:'+run.id],types:textTypes});
    assert.equal(result.rows[0].n,'1','Completion and retry must persist exactly one result');
    console.log('Real client/gateway/worker/PostgreSQL contract passed: '+environment);
  }
} finally {await pool.end();}
