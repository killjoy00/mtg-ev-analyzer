import test from 'node:test';
import assert from 'node:assert/strict';
import {weeklyPublisherRoute,sealSnapshot,openSnapshot} from '../worker/weekly-publisher.mjs';
import {gateway,adminGrowthPath} from '../edge/gateway.mjs';
import {readJson} from '../worker/request-json.mjs';
import {recapTitle,recapBody} from '../weekly-patreon-contract.mjs';
import {scheduledVotes} from '../scripts/pack-one-weekly-data.mjs';
import {createWeeklyApi,runPairedWeeklyTick} from '../scripts/pack-one-weekly-private-runner.mjs';

const end='2026-11-29',now=new Date('2026-11-30T18:01:00Z'),owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const env={PACK1_RATE_LIMIT_SECRET:'fixture-secret-for-unit-tests-0000000',PACKONE_WEEKLY_PATREON_READ_TOKEN:'fixture-patreon-read-only-token'};
const runtime={PACKONE_WEEKLY_PRIVATE_RUNTIME:'true',PACKONE_WEEKLY_PUBLICATION_ENABLED:'true',PACKONE_WEEKLY_NOTICE_VERIFIED:'true'};
const url='https://www.patreon.com/posts/999999999999',hash='a'.repeat(64);
const title=recapTitle(end),body=recapBody(end),article={start:'2026-11-23',end,weekly:[],seasonBoards:[],easiest:null};
const snapshot={article,placements:[{authId:id,name:'Fixture winner'}]};
const admin='/v1/admin/patreon-weekly',device='/v1/weekly-publisher';

function fixture(){
 let pairing=null,run=null,found=null,allowed=true,admit=true,clock=now;
 const calls=[];
 const query=async(sql,args=[])=>{
  calls.push(sql);
  const rows=(()=>{
   if(sql.startsWith('SELECT 1 FROM pack1_admins'))return allowed?[{one:'1'}]:[];
   if(sql.startsWith('SELECT paired_at'))return pairing?[{paired_at:now.toISOString()}]:[];
   if(sql.includes('ORDER BY week_end DESC LIMIT 1'))return run?[run]:[];
   if(sql.startsWith('INSERT INTO patreon_weekly_publisher_pairing')){pairing=args[1];return [];}
   if(sql.startsWith('DELETE FROM patreon_weekly_publisher_pairing')){pairing=null;return [];}
   if(sql.startsWith('SELECT 1 FROM patreon_weekly_publisher_pairing'))return pairing&&allowed&&args[0]===pairing?[{one:'1'}]:[];
   if(sql.includes('FROM results_launch'))return [{active:'t',launch_at:'2026-11-16T15:33:12Z',first_publication_at:'2026-11-30T15:33:12Z'}];
   if(sql.includes("WHERE state IN ('handoff'"))return run?.admitted_at&&run.state!=='verified'?[run]:[];
   if(sql.startsWith('SELECT week_end,state'))return [];
   if(sql.includes('FROM patreon_weekly_runs WHERE week_end='))return run?[run]:[];
   if(sql.startsWith('INSERT INTO patreon_weekly_runs')){
    if(run)return [];
    run={week_end:args[0],title:args[1],state:'claimed',image_sha256:args[2],image_width:args[3],image_height:args[4],snapshot_ticket_sha256:args[5],admitted_at:null};
    return [{week_end:end}];
   }
   if(sql.includes('SELECT pack1_patreon_weekly_admit')){
    assert.deepEqual(JSON.parse(args[1]),[{auth_id:id,name:'Fixture winner'}]);
    if(!admit||run.state!=='claimed')return [{ok:'f'}];
    run.state='handoff';run.admitted_at=clock.toISOString();return [{ok:'t'}];
   }
   if(sql.includes("SET state='queued'")){if(run.state==='handoff')run.state='queued';return [];}
   if(sql.includes("SET state='review'")){if(run.state!=='verified')run.state='review';return [];}
   if(sql.includes('SELECT pack1_patreon_weekly_finish')){assert.equal(args[1],url);run.state='verified';return [{ok:'t'}];}
   assert.fail('unexpected SQL');
  })();
  return {rows};
 };
 const deps={query,json:(v,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}}),readJson,authAdmin:async()=>({user_id:owner}),env,clock:()=>clock,collect:async()=>snapshot,find:async()=>found};
 const request=async(path,data,token,extra={})=>{
  const response=await weeklyPublisherRoute(new Request('https://api.packone.pro'+path,{method:data?'POST':'GET',headers:{...(token?{authorization:'Bearer '+token}:{}),...(data?{'content-type':'application/json'}:{}),...extra},body:data?JSON.stringify(data):undefined}),deps);
  return {status:response.status,data:await response.json(),cache:response.headers.get('cache-control')};
 };
 const pair=async()=>(await request(admin,{action:'pair',noticeConfirmed:true})).data.pairingCode;
 return {request,pair,calls,run:()=>run,pairing:()=>pairing,allow:v=>{allowed=v;},admit:v=>{admit=v;},time:v=>{clock=v;},show:()=>{found={title,url,publishedAt:now.toISOString()};}};
}
test('owner pairing is explicit, one-time, hashed, revocable, and not a player session',async()=>{
 const f=fixture();
 assert.equal((await f.request(admin,{action:'pair'})).status,400);
 f.allow(false);assert.equal((await f.request(admin,{action:'pair',noticeConfirmed:true})).status,403);
 f.allow(true);
 const token=await f.pair();assert.match(token,/^p1w_[A-Za-z0-9_-]{43}$/);assert.match(f.pairing(),/^[a-f0-9]{64}$/);assert.notEqual(f.pairing(),token);
 const info=await f.request(admin);assert.equal(info.cache,'no-store');assert.equal(info.data.paired,true);assert.ok(!JSON.stringify(info.data).includes(token));
 assert.equal((await f.request(device,{action:'check'},token)).data.status,'connections-verified');
 assert.equal((await f.request(device,{action:'check'},token,{cookie:'browser=session'})).status,401);
 assert.equal((await f.request(device,{action:'check'},token,{origin:'https://packone.pro'})).status,401);
 const next=await f.pair();assert.notEqual(next,token);
 assert.equal((await f.request(device,{action:'check'},token)).status,401);
 f.allow(false);assert.equal((await f.request(device,{action:'check'},next)).status,401);
 f.allow(true);
 await f.request(admin,{action:'revoke'});
 assert.equal((await f.request(device,{action:'check'},next)).status,401);
});
test('encrypted snapshot is bound to pairing, expiry, exact placements and claim',async()=>{
 const f=fixture(),token=await f.pair();
 const call=async(action,params={})=>(await f.request(device,{action,...params},token)).data;
 f.time(new Date('2026-11-30T17:59:59Z'));
 assert.equal((await call('prepare')).status,'outside-window');
 f.time(now);
 const prepared=await call('prepare'),other=await call('prepare');
 assert.equal(prepared.status,'prepared');assert.deepEqual(prepared.article,article);
 assert.ok(!JSON.stringify(prepared).includes(id));assert.ok(!JSON.stringify(prepared).includes('authId'));
 const altered=(prepared.ticket[0]==='A'?'B':'A')+prepared.ticket.slice(1);
 assert.equal((await f.request(device,{action:'claim',ticket:altered,image_sha256:hash,width:960,height:7000},token)).status,409);
 const params={ticket:prepared.ticket,image_sha256:hash};
 assert.equal((await call('claim',{...params,width:960,height:7000})).status,'claimed');
 assert.equal((await call('claim',{ticket:other.ticket,image_sha256:hash,width:960,height:7000})).status,'receipt-exists');
 assert.equal((await f.request(device,{action:'admit',ticket:other.ticket,image_sha256:hash},token)).status,409);
 f.admit(false);assert.equal((await call('admit',params)).status,'identity-changed');assert.equal(f.run().state,'claimed');
 f.admit(true);assert.equal((await call('admit',params)).status,'admitted');
 assert.equal((await f.request(device,{action:'admit',...params},token)).status,409);
 await call('queued',params);
 assert.equal((await call('prepare')).status,'receipt-exists');
 assert.equal((await call('status')).pending.length,1);
 assert.equal((await call('find',{week_end:end})).found,null);
 f.show();
 const {found}=await call('find',{week_end:end});
 assert.equal(found.url,url);
 assert.equal((await f.request(device,{action:'finish',week_end:end,url,publishedAt:found.publishedAt,visualVerified:false},token)).status,409);
 assert.equal((await f.request(device,{action:'finish',week_end:end,url:'https://www.patreon.com/posts/1',publishedAt:found.publishedAt,visualVerified:true},token)).status,409);
 assert.equal((await call('finish',{week_end:end,url,publishedAt:found.publishedAt,visualVerified:true})).status,'verified');
 assert.equal((await call('prepare')).status,'already-verified');
});
test('ticket cannot be read with another pairing or after expiration',()=>{
 const token=sealSnapshot({version:1,tokenHash:hash,end,expires:now.getTime()+1000,placements:[]},env);
 assert.equal(openSnapshot(token,env,{tokenHash:hash,now}).end,end);
 assert.throws(()=>openSnapshot(token,env,{tokenHash:'b'.repeat(64),now}),/invalid-snapshot/);
 assert.throws(()=>openSnapshot(token,env,{tokenHash:hash,now:new Date(now.getTime()+1001)}),/invalid-snapshot/);
});
test('raw JSON returned by the growth HTTP SQL adapter is decoded for recap votes',async()=>{
 const rows=await scheduledVotes(async()=>({rows:[{payload:'{"candidates":[]}',votes:'{"fixture":98}'}]}),{start:'2026-11-23',end});
 assert.equal(rows.length,7);assert.deepEqual(rows[0].payload,{candidates:[]});assert.deepEqual(rows[0].votes,{fixture:98});
});
test('desktop API uses only the fixed HTTPS endpoint and pairing token, never DB or Patreon credentials',async()=>{
 const token='p1w_'+'a'.repeat(43);
 const call=createWeeklyApi({env:{...runtime,PACKONE_WEEKLY_PAIRING_CODE:token},fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.packone.pro/growth/v1/weekly-publisher');
  assert.equal(options.headers.authorization,'Bearer '+token);assert.equal(options.redirect,'error');
  assert.deepEqual(JSON.parse(options.body),{action:'check'});return Response.json({status:'connections-verified'});
 }});
 assert.equal((await call('check')).status,'connections-verified');
 assert.throws(()=>createWeeklyApi({env:{...runtime,PACKONE_WEEKLY_DATABASE_URL:'unused'}}),/weekly-pairing-required/);
 assert.throws(()=>createWeeklyApi({env:{...runtime,CI:'true',PACKONE_WEEKLY_PAIRING_CODE:token}}),/private-runtime/);
});
test('paired desktop stages only after claim, queues only after admission, never retries uncertain queue',async()=>{
 const jpeg=Buffer.alloc(6000,1);jpeg[0]=255;jpeg[1]=216;jpeg[2]=255;
 for(const denied of [false,true]){
  const f=fixture(),token=await f.pair(),sequence=[];
  f.admit(!denied);
  const call=async(action,params={})=>{sequence.push(action);const r=await f.request(device,{action,...params},token);if(r.status!==200)throw Error('failed');return r.data;};
  const bridge=async(action)=>{sequence.push(action);if(action==='stage')return {id:'fixture-draft'};throw Error('uncertain queue');};
  const tick=()=>runPairedWeeklyTick({call,bridge,capture:async()=>({jpeg,width:960,height:7000}),verify:async()=>true});
  assert.equal((await tick()).status,'review-required');
  assert.ok(sequence.indexOf('claim')<sequence.indexOf('stage'));
  assert.ok(sequence.indexOf('stage')<sequence.indexOf('admit'));
  if(denied)assert.ok(!sequence.includes('queue'));else assert.ok(sequence.indexOf('admit')<sequence.indexOf('queue'));
  await tick();
  assert.equal(sequence.filter(x=>x==='stage').length,1);
  assert.equal(sequence.filter(x=>x==='queue').length,denied?0:1);
 }
});

test('gateway only forwards scoped pairing bearer on the exact production route',async()=>{
 const token='p1w_'+'A'.repeat(43);
 const env={MODE:'production',NEON_BRANCH_ID:'br-orange-feather-ayps8kep',QUOTA_KEY:'1'.repeat(64),NETWORK_QUOTA:{idFromName:n=>n,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
 const path='/growth/v1/weekly-publisher';
 const request=(p=path,extra={})=>new Request('https://api.packone.pro'+p,{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.1',authorization:'Bearer '+token,...extra},body:'{"action":"check"}'});
 let forwarded=0;
 const fetcher=async(url,options)=>{
  forwarded++;assert.ok(url.endsWith('/v1/weekly-publisher'));
  assert.equal(options.headers.get('authorization'),'Bearer '+token);
  assert.equal(options.headers.get('cookie'),null);
  return Response.json({status:'connections-verified'});
 };
 const r=await gateway(request(),env,fetcher);
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.equal((await gateway(request(path,{origin:'https://packone.pro'}),env,fetcher)).status,401);
 assert.equal((await gateway(request(path,{cookie:'test=1'}),env,fetcher)).status,401);
 assert.equal((await gateway(request(path,{authorization:'Bearer player-session'}),env,fetcher)).status,401);
 assert.equal((await gateway(request(path+'?extra=1'),env,fetcher)).status,404);
 assert.equal(forwarded,1);
 assert.equal(adminGrowthPath('/v1/admin/patreon-weekly','POST','production'),true);
 assert.equal(adminGrowthPath('/v1/admin/patreon-weekly','POST','preview'),false);
});
