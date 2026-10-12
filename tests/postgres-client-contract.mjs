import assert from 'node:assert/strict';
import {fixturePool,postgresTransport,SQL_CONNECTION,textTypes} from './support/postgres-fixture.mjs';
import {gateway} from '../edge/gateway.mjs';
import {DRAFT_RUN_SELECTION_VERSION} from '../draft-run-policy.mjs';
import {loadDraftRunInsights} from '../worker/draft-run-insights.mjs';
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
// Non-QA synthetic player is necessary to exercise the real Insights eligibility path.
// This client/gateway/PostgreSQL fixture is disposable and cannot hit production.
memory.set('pack1-player-name-v1','Insight Tester');
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
  // The fixture has no source ledger. Seed every source draft with a known,
  // varied record so each served pick can be checked against it.
  const fixtureQuery=async(text,values=[])=>pool.query({text,values,types:textTypes});
  const seededLosses='get_byte(decode(md5(p.source_draft_hash),\'hex\'),0)%3';
  await fixtureQuery(`INSERT INTO corpus_trophy_trajectories(set_id,corpus_version,source_draft_hash,event_type,wins,losses,qualified,included)
    SELECT DISTINCT p.set_id,p.corpus_version,p.source_draft_hash,'PremierDraft',7,(${seededLosses})::smallint,true,true
    FROM draft_run_verified_puzzles p ON CONFLICT DO NOTHING`);
  const expectedRecord=async puzzleId=>'7\u2013'+(await fixtureQuery(`SELECT ${seededLosses} losses FROM draft_run_verified_puzzles p WHERE p.puzzle_id=$1`,[puzzleId])).rows[0].losses;
  for(const environment of ['mixed','powered-cube','latest']) {
    let run=await request('/v1/runs',{daily:true,environment});
    assert.equal(run.selection_version,DRAFT_RUN_SELECTION_VERSION);assert.equal(run.run_length,8);
    assert.equal((await request('/v1/runs',{daily:true,environment})).id,run.id,'Daily retry must recover the same persisted run');
    assert.equal(run.current.historical_pick_id,undefined,'Unanswered API response must conceal the answer');
    await request(`/v1/runs/${run.id}/stats?round=0`,undefined,403);
    // Contract crosses browser first-party gateway -> real Draft worker -> local PostgreSQL.
    // This would catch a gateway 404 and SQL errors which regex-only tests miss.
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
      if(round===0){
        const peer=await request(`/v1/runs/${run.id}/stats?round=0`);
        assert.equal(typeof peer.available,'boolean','post-lock stats must reach SQL through the gateway');
        await request(`/v1/runs/${run.id}/stats?round=1`,undefined,403);
      }
      assert.equal((await request(`/v1/runs/${run.id}/pick`,body)).revision,run.revision,'An identical persisted pick must be retryable');
      await request(`/v1/runs/${run.id}/pick`,{...body,cardId:other},409);
    }
    assert.equal(run.complete,true);assert.equal(run.answers.length,8);assert.ok(Number.isFinite(run.score));
    for(const answer of run.answers) {
      assert.equal(Object.hasOwn(answer,'trophyRecord'),false,'Responses never send the legacy headline string');
      assert.equal(answer.trophyDrafter?.record,await expectedRecord(answer.puzzle.puzzle_id),'Each pick carries its source draft\u2019s ledger record');
      assert.equal(answer.puzzle.event_match_losses,undefined,'The public puzzle still conceals source results');
    }
    await request(`/v1/runs/${run.id}`);
    const result=await pool.query({text:'SELECT count(*)::text n FROM game_results WHERE player_id=$1::uuid AND client_result_id=$2',values:[player.playerId,'draft-run:'+run.id],types:textTypes});
    assert.equal(result.rows[0].n,'1','Completion and retry must persist exactly one result');
    console.log('Real client/gateway/worker/PostgreSQL contract passed: '+environment);
  }
  // In the isolated fixture this player was non-QA at session creation,
  // so the immutable per-run measurement_qa flag correctly remains false.
  const {trophySourceLosses}=await import('../worker/trophy-source-record.mjs');
  const probe=(await fixtureQuery(`SELECT p.puzzle_id,p.set_id,p.source_draft_hash,${seededLosses} losses,
      (SELECT s.source_snapshot_id FROM corpus_source_snapshots s WHERE s.set_id=p.set_id LIMIT 1) snapshot
    FROM draft_run_verified_puzzles p ORDER BY p.puzzle_id LIMIT 1`)).rows[0];
  assert.equal(await trophySourceLosses(fixtureQuery,probe.puzzle_id),Number(probe.losses),'Real PostgreSQL resolves the frozen ledger record');
  const snapshotRow=losses=>fixtureQuery(`INSERT INTO corpus_source_snapshot_trajectories(source_snapshot_id,source_draft_hash,event_type,wins,losses,qualified,included)
    VALUES($1,$2,'PremierDraft',7,$3::smallint,true,true) ON CONFLICT(source_snapshot_id,source_draft_hash) DO UPDATE SET losses=EXCLUDED.losses`,[probe.snapshot,probe.source_draft_hash,losses]);
  await snapshotRow(Number(probe.losses));
  assert.equal(await trophySourceLosses(fixtureQuery,probe.puzzle_id),Number(probe.losses),'Agreeing snapshot and frozen ledgers keep the record');
  await snapshotRow((Number(probe.losses)+1)%3);
  assert.equal(await trophySourceLosses(fixtureQuery,probe.puzzle_id),null,'Disagreeing ledgers omit the record');
  await snapshotRow(3);
  assert.equal(await trophySourceLosses(fixtureQuery,probe.puzzle_id),null,'An invalid 7\u20133 entry is never shown as a trophy record');
  await fixtureQuery('DELETE FROM corpus_source_snapshot_trajectories WHERE source_snapshot_id=$1 AND source_draft_hash=$2',[probe.snapshot,probe.source_draft_hash]);
  assert.equal(await trophySourceLosses(fixtureQuery,'missing-puzzle'),null,'An unknown puzzle has no record');
  console.log('Real PostgreSQL trophy source record contract passed.');
  const insightQuery=fixtureQuery;
  const insightResult=await loadDraftRunInsights(insightQuery,player.playerId,{environment:'mixed',period:'all'});
  assert.equal(insightResult.unlocked,true,'Eight completed picks unlock Insights in real PostgreSQL');
  assert.ok(insightResult.eligible_decisions>=8);
  assert.equal(insightResult.formats.length,3);
  assert.ok(insightResult.pick_depth.length>0,'Real source pick numbers survive joins');
  assert.ok(insightResult.difficulty.some(d=>d.count>0),'Real rated puzzle difficulty joins');
  assert.ok(insightResult.months.every(row=>row.count>=10),'Only months with ten picks appear in progress');
  const inaccessible=await fetch('https://api-preview.packone.pro/growth/v1/profile/insights?environment=mixed');
  assert.equal(inaccessible.status,401,'Guest player cookie cannot authorize private Insights');
  const noMobileAuth=await fetch('https://api-preview.packone.pro/growth/v1/mobile/profile/insights?environment=mixed');
  assert.notEqual(noMobileAuth.status,200,'Missing native account token denies private Insights');
  console.log('Real PostgreSQL Insights SQL, filtering and private-API denial contract passed.');
} finally {await pool.end();}
