import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {articleHash} from '../worker/lab-editorial.mjs';
import {admission,collectIdeas,selectIdeas,renderDigest} from '../research/pack-one-lab/digest-ideas.mjs';
import {sendDigest,runDigest} from '../scripts/pack-one-lab-digest.mjs';
const testConfig={enabled:false,test_token:'v1'},weekly={enabled:true,test_token:null};
const date='2026-12-02';
const mode={kind:'test',date,key:'ideas-digest-test-v1-v1'};
test('test is merge-only; Wednesday cron chooses exactly one Central offset and rejects reruns',()=>{
 const check=(cfg,event,iso,schedule='',attempt='1')=>admission(cfg,{event,schedule,now:new Date(iso),attempt});
 assert.equal(check(testConfig,'push','2026-11-26T23:20Z').kind,'test');
 assert.equal(check(testConfig,'pull_request','2026-11-26T23:20Z'),null);
 assert.equal(check(testConfig,'schedule','2026-12-02T14:17Z','17 14 * * 3'),null);
 assert.equal(check(weekly,'schedule','2026-12-02T14:25Z','17 14 * * 3').kind,'weekly');
 assert.equal(check(weekly,'schedule','2026-12-02T14:25Z','17 13 * * 3'),null);
 assert.equal(check(weekly,'schedule','2026-07-01T13:25Z','17 13 * * 3').kind,'weekly');
 assert.equal(check(weekly,'schedule','2026-07-01T14:25Z','17 14 * * 3'),null);
 assert.equal(check(weekly,'schedule','2026-12-02T14:25Z','17 14 * * 3','2'),null);
 assert.equal(check(weekly,'schedule','2026-12-03T14:25Z','17 14 * * 3'),null);
 assert.equal(check(weekly,'push','2026-12-02T14:25Z'),null);
 assert.throws(()=>check({enabled:true,test_token:'v1'},'push','2026-12-02T14:25Z'),/digest-config/);
});
const cell=(n,picked,drafts=n)=>({n,picked,drafts});
function sample(){
 const a={card:{name:'Test Common',rarity:'common',color:'B',creature:false,mana:3,type:'Artifact'},ambiguous:false,cells:{'deck-all':cell(60,46),'deck-low':cell(20,8),'deck-high':cell(40,38)}};
 const b={card:{name:'Test Legend',rarity:'common',color:'U',creature:true,mana:3,type:'Legendary Creature'},ambiguous:false,cells:{'fresh-one':cell(70,42,65),'prior-one':cell(20,8,18),'fresh-many':cell(60,42,58),'prior-many':cell(25,12,23)}};
 const c={card:{name:'Test Curve',rarity:'common',color:'G',creature:true,mana:2,type:'Creature'},ambiguous:false,cells:{'curve-short':cell(30,24),'curve-full':cell(30,15)}};
 const h='a'.repeat(64);
 return {schema_version:1,kind:'stored-corpus',sets:[{set_id:'test',set_name:'Test Set',complete_drafts:500,source_snapshot_id:h,draft_sha256:h,game_sha256:h,deck_sha256:h,deck_game_sha256:h,feature_research:{version:'feature-v2',complete:500,known_offers:4000,cards:[a,b,c]},card_research:{version:2,complete:500,known_stages:Array(8).fill(500),rare_packs:400,cards:[{name:'Test Common',ambiguous:false,rare:cell(160,48)}]}}]};
}
test('use actual opening rare-pack and separate deck cohorts, residual repeat association, and fixed-pick curve comparison',()=>{
 const ideas=collectIdeas(sample());
 assert.equal(ideas.length,3);
 const open=ideas.find(i=>i.family==='opening-flexibility');
 assert.match(open.evidence,/48\/160 \(30.0%\)/);
 assert.match(open.evidence,/8\/20 \(40.0%\).*38\/40 \(95.0%\)/);
 assert.match(open.evidence,/separate matched group/);
 assert.match(ideas.find(i=>i.family==='copy-choice').follow,/legendary restriction/);
 assert.match(ideas.find(i=>i.family==='curve').evidence,/same fifth pick/);
 const bad=sample();bad.sets[0].feature_research.cards[0].cells['deck-low'].drafts=17;
 assert.ok(!collectIdeas(bad).some(i=>i.family==='opening-flexibility'));
 const mismatch=sample();mismatch.sets[0].deck_game_sha256='b'.repeat(64);
 assert.ok(!collectIdeas(mismatch).some(i=>i.family==='opening-flexibility'));
 const unsupported=sample();unsupported.sets[0].feature_research.cards[1].cells['prior-many']=cell(25,17,23);
 assert.ok(!collectIdeas(unsupported).some(i=>i.family==='copy-choice'));
 assert.ok(!collectIdeas({...sample(),sets:[]}).length);
});
test('selection avoids sent topics, repeated cards and more than two of a family; no padding',()=>{
 const a=collectIdeas(sample());
 const x=a.find(i=>i.family==='copy-choice');
 const extras=[1,2,3].map(n=>({...x,id:'extra'+n,cards:['Extra '+n],score:x.score+n}));
 const selected=selectIdeas([...a,...extras],[a[0].id]);
 assert.equal(selected.filter(i=>i.family==='copy-choice').length,2);
 assert.ok(!selected.some(i=>i.id===a[0].id));
 assert.equal(selectIdeas(a,a.map(i=>i.id)).length,0);
 const zero=renderDigest([],mode);
 assert.match(zero.text,/No new leads/);
 assert.match(zero.subject,/TEST/);
});
function database(){
 const rows=new Map(),events=[];
 const query=async(sql,p=[])=>{
  events.push(sql.split(' ')[0]);
  if(sql.startsWith('SELECT source_key'))return {rows:rows.has(p[0])?[rows.get(p[0])]:[]};
  if(sql.startsWith('INSERT')){
   if(rows.has(p[0]))return {rows:[]};
   rows.set(p[0],{source_key:p[0],report:JSON.parse(p[1]),report_hash:p[2]});return {rows:[{source_key:p[0]}]};
  }
  if(sql.startsWith('UPDATE')){
   if(rows.get(p[0])?.report_hash!==p[3])return {rows:[]};
   rows.set(p[0],{source_key:p[0],report:JSON.parse(p[1]),report_hash:p[2]});return {rows:[{source_key:p[0]}]};
  }
  throw Error('Unexpected query');
 };
 return {rows,events,query};
}
test('claim before email; accept only a real provider id; duplicate cannot send',async()=>{
 const db=database(),ideas=collectIdeas(sample());
 let called=0;
 const fetcher=async(url,req)=>{
  called++;
  assert.equal(db.rows.get(mode.key).report.delivery,'claimed');
  assert.equal(url,'https://api.resend.com/emails');
  assert.equal(req.headers['idempotency-key'],mode.key);
  assert.equal(JSON.parse(req.body).to.length,1);
  assert.match(JSON.parse(req.body).text,/Test Common/);
  return {ok:true,json:async()=>({id:'fixture-provider-receipt'})};
 };
 assert.deepEqual(await sendDigest(db.query,{mode,ideas,apiKey:'re_fixture',fetcher}),{status:'provider-accepted',count:3});
 assert.equal(db.rows.get(mode.key).report.delivery,'sent');
 assert.equal(db.rows.get(mode.key).report_hash,articleHash(db.rows.get(mode.key).report));
 assert.deepEqual(await sendDigest(db.query,{mode,ideas,apiKey:'re_fixture',fetcher}),{status:'already-sent'});
 assert.equal(called,1);
});
test('missing secret stops before any query; ambiguous email blocks retries',async()=>{
 const db=database();
 await assert.rejects(sendDigest(db.query,{mode,ideas:[],apiKey:'',fetcher:()=>{throw Error('no email');}}),/email-unconfigured/);
 assert.equal(db.events.length,0);
 await assert.rejects(sendDigest(db.query,{mode,ideas:[],apiKey:'re_fixture',fetcher:async()=>({ok:false})}),/email-unverified/);
 assert.equal(db.rows.get(mode.key).report.delivery,'claimed');
 await assert.rejects(sendDigest(db.query,{mode,ideas:[],apiKey:'re_fixture',fetcher:()=>{throw Error('no retry');}}),/previous-claim/);
});
test('live path uses read-only repeatable research and only scoped research receipt writes',async()=>{
 const db=database(),queries=[];
 const client={query:async(sql,p=[])=>{
  queries.push(sql);
  if(sql.startsWith('SET ')||sql.startsWith('BEGIN ')||sql==='COMMIT')return {rows:[]};
  if(sql.startsWith('SELECT current_user'))return {rows:[{role:'pack1_lab_research_worker'}]};
  if(sql.startsWith('SELECT pg_try'))return {rows:[{locked:true}]};
  return db.query(sql,p);
 }};
 const result=await runDigest(client,{mode,apiKey:'re_fixture',build:async()=>sample(),fetcher:async()=>({ok:true,json:async()=>({id:'fixture'})})});
 assert.equal(result.status,'provider-accepted');
 assert.ok(queries.includes('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'));
 assert.ok(queries.indexOf('COMMIT')<queries.findIndex(s=>s.startsWith('INSERT')));
 assert.ok(queries.filter(s=>/^(INSERT|UPDATE)/.test(s)).every(s=>s.includes('public.pack1_lab_research')));
});
test('protected environment and separate weekly activation',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/pack-one-lab-digest.yml',import.meta.url),'utf8');
 assert.match(workflow,/environment: pack-one-mobile-release/);
 assert.match(workflow,/github\.event_name != 'pull_request'/);
 assert.equal((workflow.match(/secrets\.PACK1_LAB_RESEND_API_KEY \|\| secrets\.PACK1_ACCOUNT_DELETE_RESEND_API_KEY/g)||[]).length,2);
 assert.doesNotMatch(workflow,/secrets\.PACK1_AUTH_RESEND_API_KEY|secure-auth-release\.yml|deploy-functions\.yml/);
 assert.doesNotMatch(workflow,/PACK1_LAB_REVIEW_ENABLED=true|PACK1_LAB_SAMPLE_MODE=true|pack-one-lab-weekly\.mjs/);
 const cfg=JSON.parse(readFileSync(new URL('../.github/pack-one-lab-digest.json',import.meta.url),'utf8'));
 assert.equal(typeof cfg.enabled,'boolean');
});
