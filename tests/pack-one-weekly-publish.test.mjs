import test from 'node:test';
import assert from 'node:assert/strict';
import {runPrivateWeeklyRecap,reconcileWeeklyRecaps,assertPrivateRuntime,recapBody,recapTitle,uniquePlacements,validPublication} from '../scripts/pack-one-weekly-publish.mjs';
import {readWeeklyPost} from '../scripts/pack-one-weekly-private-runner.mjs';
import {jpegDimensions} from '../scripts/pack-one-weekly-render.mjs';
const now=new Date('2026-11-30T18:00:00Z'),end='2026-11-29';
const env={PACKONE_WEEKLY_PRIVATE_RUNTIME:'true',PACKONE_WEEKLY_PUBLICATION_ENABLED:'true',PACKONE_WEEKLY_NOTICE_VERIFIED:'true'};
const authId='11111111-1111-4111-8111-111111111111';
const name='Synthetic Fixture';
const jpeg=Buffer.alloc(6000,1);jpeg[0]=255;jpeg[1]=216;jpeg[2]=255;
const media={jpeg,width:1580,height:7000};
const url='https://www.patreon.com/posts/999999999999';
function fixture({admit=true,failQueue=false,failStage=false,findExisting=false,verified=true}={}){
 let run=null,publicPost=findExisting?{title:recapTitle(end),url,publishedAt:now.toISOString()}:null;
 const calls=[];
 const q=async(sql,args=[])=>{
  if(sql.includes("WHERE state IN ('handoff'"))return {rows:run?.admitted_at&&run.state!=='verified'?[{...run}]:[]};
  if(sql.startsWith('SELECT week_end::text'))return {rows:run?[{...run}]:[]};
  if(sql.includes('FROM results_launch'))return {rows:[{active:true,launch_at:'2026-11-16T15:33:00Z',first_publication_at:'2026-11-30T15:33:00Z'}]};
  if(sql.startsWith('INSERT INTO patreon_weekly_runs')){
   calls.push('claim');
   if(run)return {rows:[]};
   run={week_end:args[0],title:args[1],state:'claimed',image_sha256:args[2],image_width:args[3],image_height:args[4],admitted_at:null};
   return {rows:[{week_end:end}]};
  }
  if(sql.includes('pack1_patreon_weekly_admit')){
   calls.push('admit');assert.deepEqual(JSON.parse(args[1]),[{auth_id:authId,name}]);
   if(admit){run.state='handoff';run.admitted_at=now.toISOString();}
   return {rows:[{ok:admit}]};
  }
  if(sql.includes('pack1_patreon_weekly_finish')){
   calls.push('finish');assert.equal(args[1],url);run.state='verified';return {rows:[{ok:true}]};
  }
  if(sql.includes("SET state='review'")){calls.push('review');run.state='review';return {rows:[]};}
  if(sql.includes("SET state='queued'")){calls.push('queued');run.state='queued';return {rows:[]};}
  assert.fail('Unexpected fixture query');
 };
 const publisher={
  find:async()=>publicPost,
  stage:async post=>{calls.push('stage');assert.equal(run.state,'claimed');assert.equal(post.title,recapTitle(end));assert.ok(post.image.equals(jpeg));if(failStage)throw Error('synthetic failure');return {id:'fixture-draft'};},
  queue:async()=>{calls.push('queue');assert.equal(run.state,'handoff');if(failQueue)throw Error('synthetic timeout');},
  verify:async post=>{calls.push('verify');assert.equal(post.width,1580);assert.equal(post.height,7000);assert.equal(post.body,recapBody(end));return verified;}
 };
 const tick=(at=now)=>runPrivateWeeklyRecap({query:q,publisher,now:at,clock:()=>at,env,collect:async()=>({article:{},placements:[{authId,name},{authId,name}]}),capture:async()=>media});
 return {q,publisher,tick,calls,run:()=>run,show:()=>{publicPost={title:recapTitle(end),url,publishedAt:now.toISOString()};}};
}
test('live publishing is disabled by default and never allowed in CI',()=>{
 assert.throws(()=>assertPrivateRuntime({}),/private-runtime-required/);
 assert.throws(()=>assertPrivateRuntime({...env,CI:'true'}),/private-runtime-required/);
 assert.throws(()=>assertPrivateRuntime({...env,PACKONE_WEEKLY_NOTICE_VERIFIED:'false'}),/publisher-disabled/);
 assert.doesNotThrow(()=>assertPrivateRuntime(env));
 assert.match(recapBody(end),/apps\.apple\.com\/app\/id6814318676/);
 assert.match(recapBody(end),/play\.google\.com\/store\/apps\/details\?id=pro\.packone\.app/);
 assert.deepEqual(uniquePlacements([{authId,name},{authId,name}]),[{auth_id:authId,name}]);
 assert.throws(()=>uniquePlacements([{authId,name},{authId,name:'Different fixture'}]),/placements-invalid/);
});
test('one Monday claim, draft, final admission and queue; later readback is idempotent',async()=>{
 const f=fixture();
 assert.equal((await f.tick(new Date('2026-11-30T17:59:00Z'))).status,'outside-window');
 assert.equal((await f.tick()).status,'queued-awaiting-verification');
 assert.deepEqual(f.calls,['claim','stage','admit','queue','queued']);
 assert.equal((await f.tick()).status,'receipt-exists');
 assert.equal(f.calls.filter(x=>x==='queue').length,1);
 f.show();
 assert.equal((await f.tick(new Date('2026-12-01T18:00:00Z'))).status,'outside-window');
 assert.equal(f.run().state,'verified');
 assert.deepEqual(f.calls.slice(-2),['verify','finish']);
 assert.equal((await reconcileWeeklyRecaps(f.q,f.publisher,{now})).length,0);
});
test('changed name or failed draft cannot queue and cannot create a second draft',async()=>{
 for(const options of [{admit:false},{failStage:true}]){
  const f=fixture(options);
  assert.equal((await f.tick()).status,'review-required');
  assert.equal(f.run().state,'review');assert.ok(!f.calls.includes('queue'));
  assert.equal((await f.tick()).status,'receipt-exists');assert.equal(f.calls.filter(c=>c==='stage').length,1);
 }
});
test('ambiguous queue never retries; public readback may reconcile it',async()=>{
 const f=fixture({failQueue:true});
 assert.equal((await f.tick()).status,'review-required');
 assert.equal((await f.tick()).status,'receipt-exists');
 assert.equal(f.calls.filter(x=>x==='queue').length,1);
 f.show();await f.tick(new Date('2026-12-01T18:00:00Z'));
 assert.equal(f.run().state,'verified');
});
test('no new post when an exact-title post exists or independent readback fails',async()=>{
 const manual=fixture({findExisting:true});
 assert.equal((await manual.tick()).status,'unexpected-public-post');assert.deepEqual(manual.calls,[]);
 const bad=fixture({verified:false});
 await bad.tick();bad.show();await bad.tick(new Date('2026-12-01T18:00:00Z'));
 assert.equal(bad.run().state,'review');assert.ok(!bad.calls.includes('finish'));
});
test('API timestamp comes from supported exact-title campaign read; wrong title/time rejected',async()=>{
 const title=recapTitle(end);
 const found=await readWeeklyPost(title,{token:'fixture',find:async args=>{
  assert.equal(args.includePublishedAt,true);return {id:'999999999999',url,title,publishedAt:now.toISOString()};
 }});
 const receipt={title,admitted_at:now.toISOString()};
 assert.equal(validPublication(found,receipt,now).url,url);
 assert.throws(()=>validPublication({...found,publishedAt:'2026-11-29T18:00:00Z'},receipt,now),/readback-invalid/);
 assert.throws(()=>validPublication({...found,title:'Different'},receipt,now),/readback-invalid/);
});
test('actual JPEG frame dimensions are parsed and corrupt data fails closed',()=>{
 // Minimal SOF0 marker fixture: 1200 x 700, not an actual publication image.
 const marker=Buffer.from([255,216,255,192,0,17,8,2,188,4,176,3,1,17,0,2,17,1,3,17,1,255,217]);
 assert.deepEqual(jpegDimensions(marker),{width:1200,height:700});
 assert.throws(()=>jpegDimensions(Buffer.from('not an image')),/invalid-jpeg/);
});
