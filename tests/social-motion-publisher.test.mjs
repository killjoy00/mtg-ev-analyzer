import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {editorialPlan} from '../scripts/social-editorial.mjs';
import {motionEnabled} from '../scripts/social-motion-selection.mjs';
import {verifyFrozen,receiptRecord,parseMotionReceipt,motionLedger,motionRkey,anchorDay,motionRevealDays,
 verifyMotionMedia,postMotionQuestion,revealMotionQuestion,readFrozen,prepareMotion,publishMotion} from '../scripts/social-motion-publisher.mjs';
import {debateQuestionRkey,debateRevealRkey} from '../scripts/featured-debate.mjs';
const {examples}=JSON.parse(readFileSync(new URL('./fixtures/social-debate-seven-real.json',import.meta.url)));
const day='2026-11-25',feature={...examples[0],publication_day:day},data={feature,plan:editorialPlan(feature),publication_day:day,oracle:{}};
test('cutover is explicit and all publication slots and keys are distinct',()=>{
 assert.equal(motionEnabled({SOCIAL_MOTION_ACTIVE:'true'},'2026-11-25'),false);
 assert.equal(motionEnabled({SOCIAL_MOTION_ACTIVE:'true'},'2026-11-26'),true);
 assert.equal(motionEnabled({},'2026-11-26'),false);
 assert.equal(anchorDay('2027-01-01'),'2026-12-31');
 assert.equal(new Set([motionRkey(day),motionRkey(day,true),debateQuestionRkey(anchorDay(day)),debateRevealRkey(anchorDay(day))]).size,4);
 assert.deepEqual(motionRevealDays(new Date('2026-11-25T20:00:00Z')),['2026-11-25','2026-11-24','2026-11-23']);
});
test('frozen data is recomputed from its exact evidence and rejects stale or tampered plans',async()=>{
 assert.deepEqual(verifyFrozen(data,day),data);
 assert.throws(()=>verifyFrozen({...data,publication_day:'2026-11-26'},day),/Invalid frozen/);
 const changed=structuredClone(data);changed.plan.morning='Made-up claim';
 assert.throws(()=>verifyFrozen(changed,day),/does not match evidence/);
 const bad=structuredClone(data);bad.feature.day=day;
 assert.throws(()=>verifyFrozen(bad,day),/Invalid frozen/);
 assert.equal(await readFrozen(day,{read:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});}}),null);
 await assert.rejects(readFrozen(day,{read:async()=>'{broken'}));
});
test('trusted bot reservation is durable and contains no results',async()=>{
 const rows=[];
 const fetcher=async(url,init)=>{
  if(init.method==='GET')return {ok:true,json:async()=>rows};
  const body=JSON.parse(init.body).body;
  rows.push({id:1,user:{login:'github-actions[bot]'},body});
  return {ok:true,json:async()=>({id:1})};
 };
 const ledger=motionLedger({token:'test-token',fetcher});
 const first=await ledger.reserve(data),second=await ledger.reserve(data);
 assert.deepEqual(first,receiptRecord(data));assert.deepEqual(first,second);assert.equal(rows.length,1);
 assert.doesNotMatch(rows[0].body,/%|trophy drafter took|test-token/i);
 assert.equal(parseMotionReceipt({...rows[0],user:{login:'impostor'}}),null);
 assert.deepEqual(parseMotionReceipt(rows[0]),first);
 await assert.rejects(ledger.reserve({...data,plan:{...data.plan,morning:'different'}}),/different decision/);
 await assert.rejects(ledger.reserve({...data,publication_day:'2026-11-26'}),/already been reserved/);
});
function mockBluesky(){
 const posts=new Map();let uploads=0,creates=0;
 const fetcher=async(url,init)=>{
  const u=new URL(url),method=u.pathname.split('/').at(-1);
  if(method==='com.atproto.repo.getRecord'){
   const item=posts.get(u.searchParams.get('rkey'));
   return item?{ok:true,status:200,json:async()=>item}:{ok:false,status:404};
  }
  if(method==='com.atproto.repo.uploadBlob'){uploads++;return {ok:true,json:async()=>({blob:{ref:{$link:'blob'}}})};}
  if(method==='com.atproto.repo.createRecord'){
   creates++;const {rkey,record}=JSON.parse(init.body),ref={uri:'at://did:plc:test/app.bsky.feed.post/'+rkey,cid:'cid-'+rkey,value:record};
   posts.set(rkey,ref);return {ok:true,json:async()=>ref};
  }
  throw Error('Unexpected '+method);
 };
 return {posts,fetcher,session:{did:'did:plc:test',jwt:'test'},stats:()=>({uploads,creates})};
}
test('native question and delayed reply are exactly once, threaded, and never answer mismatched copy',async()=>{
 const b=mockBluesky(),image=new Uint8Array([1,2,3]);
 assert.equal((await postMotionQuestion(b.fetcher,b.session,data,image)).status,'posted');
 assert.equal((await postMotionQuestion(b.fetcher,b.session,data,image)).status,'already-posted');
 assert.deepEqual(b.stats(),{uploads:1,creates:1});
 const q=b.posts.get(motionRkey(day));q.value.createdAt='2026-11-25T15:10:00Z';
 assert.equal((await revealMotionQuestion(b.fetcher,b.session,data,{now:new Date('2026-11-25T18:59:00Z')})).status,'skipped');
 assert.equal((await revealMotionQuestion(b.fetcher,b.session,data,{now:new Date('2026-11-25T19:10:00Z')})).status,'posted');
 assert.equal((await revealMotionQuestion(b.fetcher,b.session,data,{now:new Date('2026-11-25T20:00:00Z')})).status,'already-posted');
 const reply=b.posts.get(motionRkey(day,true)).value;
 assert.equal(reply.text,data.plan.reply);assert.equal(reply.reply.root.uri,q.uri);
 q.value.text='unrelated';
 await assert.rejects(revealMotionQuestion(b.fetcher,b.session,data,{now:new Date('2026-11-25T20:00:00Z')}),/does not match/);
});
test('old question occupying the slot prevents a duplicate new-format post',async()=>{
 const b=mockBluesky();b.posts.set(debateQuestionRkey(anchorDay(day)),{uri:'old',cid:'old',value:{text:'old'}});
 assert.equal((await postMotionQuestion(b.fetcher,b.session,data,new Uint8Array([1]))).status,'skipped');
 assert.deepEqual(b.stats(),{uploads:0,creates:0});
});
test('render contract must match exact decision, size, timing and original music',()=>{
 const manifest={day:feature.day,puzzle_id:feature.puzzle_id,template:data.plan.version,seconds:feature.tier===3?34:30,
 width:1080,height:1920,frames_per_second:30,choices:feature.tier,real_card_art:true,question_image:{width:1200,height:1500,bytes:1000,shows_results:false},
 audio:{narration:false,original:true}};
 assert.equal(verifyMotionMedia(data,manifest,{day}),true);
 assert.throws(()=>verifyMotionMedia(data,{...manifest,puzzle_id:'wrong'},{day}),/provenance/);
 assert.throws(()=>verifyMotionMedia(data,{...manifest,question_image:{...manifest.question_image,shows_results:true}},{day}),/provenance/);
});
test('no publication or preparation from a pull request',async()=>{
 const now=new Date('2026-11-26T16:00:00Z'),env={SOCIAL_MOTION_ACTIVE:'true',GITHUB_EVENT_NAME:'pull_request',GITHUB_REF:'refs/pull/1806/merge'};
 await assert.rejects(prepareMotion({env,now}),/live-scheduler/);
 await assert.rejects(publishMotion({env,now}),/current main/);
});
