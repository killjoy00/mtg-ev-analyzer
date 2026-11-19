import test from 'node:test';
import assert from 'node:assert/strict';
import {resultsDeliveryConfiguration,resultsEmailContent,dispatchResultsEmail,resultsEmailRoute} from '../worker/results-email-delivery.mjs';

const env={PACK1_RESULTS_EMAIL_ENABLED:'1',PACK1_RESULTS_RESEND_API_KEY:'re_fixture',PACK1_RATE_LIMIT_SECRET:'fixture-signing-key-at-least-32-characters',
 PACK1_RESULTS_RESEND_WEBHOOK_SECRET:'whsec_fixture',PACK1_RESULTS_SENDER_NAME:'Fixture',PACK1_RESULTS_SENDER_EMAIL:'fixture@example.invalid',PACK1_RESULTS_POSTAL_ADDRESS:'Synthetic postal footer'};
test('delivery requires its own switch, sender, postal footer, provider and signing configuration',async()=>{
 assert.deepEqual(resultsDeliveryConfiguration(env),{ready:true,active:true});
 assert.equal(resultsDeliveryConfiguration({...env,PACK1_RESULTS_EMAIL_ENABLED:'0'}).active,false);
 for(const key of Object.keys(env).filter(k=>k!=='PACK1_RESULTS_EMAIL_ENABLED'))assert.equal(resultsDeliveryConfiguration({...env,[key]:''}).active,false,key);
 assert.deepEqual(await dispatchResultsEmail(()=>{throw Error('must not query');},{env:{}}),{active:false});
});
test('personal digests contain only the recipient numerical standings and preserve weekly/season scoring labels',()=>{
 const campaign={kind:'week',subject:'Your week',start_date:'2026-11-16',end_date:'2026-11-22'};
 const value=resultsEmailContent(campaign,[{environment:'mixed',rank:7,score:68.3,days:4,display_name:'Never include a name',profile_key:'private-profile'}]);
 assert.match(value.text,/#7 · 68.3 weekly score · 4 Dailies/);assert.match(value.text,/best three Dailies/);
 assert.doesNotMatch(value.html+value.text,/Never include a name|private-profile/);
 assert.match(value.text,/Daily reminder setting is separate/);
 assert.equal(resultsEmailContent(campaign,[]),null);
 assert.match(resultsEmailContent({...campaign,kind:'season'},[{environment:'latest',rank:1,score:80,days:20}]).text,/season rating/);
});
test('news is escaped plain text with no HTML or recipient interpolation',()=>{
 const value=resultsEmailContent({kind:'news',subject:'News <title>',body:'<script>bad()</script>\n\nA second paragraph.'});
 assert.doesNotMatch(value.html,/<script>|<title>/);assert.match(value.html,/&lt;script&gt;/);assert.match(value.html,/<p>A second paragraph\.<\/p>/);
});
test('weekly generation follows 10 a.m. Central through DST and never generates on another hour',async()=>{
 for(const [clock,start] of [['2026-11-23T16:00:00Z','2026-11-16'],['2026-06-15T15:00:00Z','2026-06-08']]){
  const seen=[];await dispatchResultsEmail(async(sql,p)=>{seen.push({sql,p});return {rows:sql==='SELECT 1 FROM results_launch WHERE singleton AND launch_at<=now()'?[{}]:sql.includes('RETURNING verified_at')?[{verified_at:'fixture'}]:[]};},{env,clock:Date.parse(clock)});
  assert.deepEqual(seen.find(x=>x.sql.includes("SELECT $1,'week'")).p,['week:'+start,start,new Date(Date.parse(start+'T12:00:00Z')+6*86400000).toISOString().slice(0,10)]);
  assert.match(seen.find(x=>x.sql.includes("SELECT $1,'week'")).sql,/r.started_at/);
 }
 const seen=[];await dispatchResultsEmail(async(sql)=>{seen.push(sql);return {rows:sql.startsWith('SELECT 1 FROM results_launch')?[{}]:[]};},{env,clock:Date.parse('2026-11-23T15:00:00Z')});
 assert.ok(!seen.some(sql=>sql.includes('INSERT INTO results_email_campaigns')));
});
test('the private scheduler refuses absent identity and does not dispatch stale invocations',async()=>{
 const deps={query:()=>{throw Error('must not query');},json:Response.json,readJson:r=>r.json(),trigger:()=>null};
 await assert.rejects(resultsEmailRoute(new Request('https://fixture.invalid/internal/results-email',{method:'POST',body:'{}'}),deps),/identity required/);
 const response=await resultsEmailRoute(new Request('https://fixture.invalid/internal/results-email',{method:'POST',body:'{}'}),{...deps,trigger:()=>({scheduledAt:'2026-01-01T00:00:00Z'})});
 assert.deepEqual(await response.json(),{ok:true,stale:true});
});
