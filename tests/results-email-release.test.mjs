import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configureResultsEmailRelease,readResultsEmailRelease,RESULTS_WEBHOOK,writePrivateResultsEnvironment} from '../scripts/configure-results-email-release.mjs';
import {reconcileResultsEmailScheduler,RESULTS_EMAIL_SCHEDULE} from '../scripts/reconcile-results-email-scheduler.mjs';
const env={PACK1_RESULTS_POSTAL_ADDRESS:'Private synthetic postal footer',PACK1_RESULTS_RESEND_API_KEY:'re_synthetic'};
const secret='whsec_'+Buffer.from('synthetic-secret-at-least-twelve').toString('base64');
const events=['email.bounced','email.complained','email.delivered','email.sent'];
test('release configuration defaults off and missing postal information fails before provider control',async()=>{
 assert.equal(readResultsEmailRelease({enabled:false}),false);assert.throws(()=>readResultsEmailRelease({enabled:1}));assert.throws(()=>readResultsEmailRelease({enabled:true,override:true}));
 assert.deepEqual(await configureResultsEmailRelease({enabled:false,fetcher:()=>{throw Error();}}),{PACK1_RESULTS_EMAIL_ENABLED:'0'});
 await assert.rejects(configureResultsEmailRelease({enabled:true,env:{},fetcher:()=>{throw Error();}}),/POSTAL_ADDRESS/);
});
test('the dedicated webhook is reused without rotating its secret or touching another endpoint',async()=>{
 const calls=[];const fetcher=async(url,o)=>{calls.push({url,method:o.method});return Response.json(url.includes('?')?{data:[{id:'other',endpoint:'https://other.invalid/hook'},{id:'results',endpoint:RESULTS_WEBHOOK}],has_more:false}:{id:'results',endpoint:RESULTS_WEBHOOK,status:'enabled',events,signing_secret:secret});};
 const values=await configureResultsEmailRelease({enabled:true,env,fetcher});assert.equal(values.PACK1_RESULTS_RESEND_WEBHOOK_SECRET,secret);assert.equal(values.PACK1_RESULTS_POSTAL_ADDRESS,env.PACK1_RESULTS_POSTAL_ADDRESS);
 assert.equal(values.PACK1_RESULTS_SENDER_EMAIL,'news@packone.pro');assert.ok(calls.every(c=>c.method==='GET'));assert.ok(!calls.some(c=>c.url.endsWith('/other')));
});
test('an ambiguous webhook creation reconciles by read without a duplicate POST',async()=>{
 let created=false,posts=0;const fetcher=async(url,o)=>{
  if(o.method==='POST'){posts++;created=true;throw Error('synthetic lost response');}
  return Response.json(url.includes('?')?{data:created?[{id:'results',endpoint:RESULTS_WEBHOOK}]:[],has_more:false}:{id:'results',endpoint:RESULTS_WEBHOOK,status:'enabled',events,signing_secret:secret});
 };
 await configureResultsEmailRelease({enabled:true,env,fetcher});assert.equal(posts,1);
});
test('duplicate webhook ownership and provider denial fail with sanitized errors',async()=>{
 await assert.rejects(configureResultsEmailRelease({enabled:true,env,fetcher:async()=>Response.json({data:[{id:'a',endpoint:RESULTS_WEBHOOK},{id:'b',endpoint:RESULTS_WEBHOOK}]})}),/Duplicate/);
 await assert.rejects(configureResultsEmailRelease({enabled:true,env,fetcher:async()=>new Response('PRIVATE_PROVIDER_BODY',{status:403})}),e=>/HTTP 403/.test(e.message)&&!e.message.includes('PRIVATE_PROVIDER_BODY'));
});
test('runner configuration masks private values and stores multiline values outside public artifacts',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'results-env-')),file=path.join(dir,'runner.env'),masked=[];
 try{writePrivateResultsEnvironment({PACK1_RESULTS_POSTAL_ADDRESS:'Synthetic\nFooter',PACK1_RESULTS_RESEND_WEBHOOK_SECRET:secret},file,{mask:v=>masked.push(v)});assert.deepEqual(masked,['Synthetic\nFooter',secret]);assert.match(fs.readFileSync(file,'utf8'),/Synthetic\nFooter/);assert.equal(fs.statSync(file).mode&0o777,0o600);}finally{fs.rmSync(dir,{recursive:true});}
});
test('scoped activation verifies the exact configured backend and mutates only the new results trigger',async()=>{
 const commit='a'.repeat(40),mutations=[];
 const fetcher=async(url,o={})=>{
  if(url.includes('/health'))return Response.json({release_commit:commit,results_email_ready:true,results_email_enabled:true});
  if(o.method==='GET')return Response.json({triggers:[{name:'pack1-daily-reminders',enabled:true}]});
  const body=JSON.parse(o.body);mutations.push(body);return Response.json({trigger:{...body,trigger_id:'results',next_run_at:'2026-11-16T19:00:00Z'}});
 };
 const result=await reconcileResultsEmailScheduler({enabled:true,commit,apiKey:'synthetic-key-at-least-twenty',fetcher});assert.equal(result.enabled,true);assert.deepEqual(mutations,[{...RESULTS_EMAIL_SCHEDULE,enabled:true}]);
 await assert.rejects(reconcileResultsEmailScheduler({enabled:true,commit:'b'.repeat(40),apiKey:'synthetic-key-at-least-twenty',fetcher}),/not live/);assert.equal(mutations.length,1);
});
test('the secure release keeps development sends off and reconciles the scoped scheduler after production verification',()=>{
 const s=fs.readFileSync('.github/workflows/secure-auth-release.yml','utf8');
 assert.match(s,/environment: pack-one-mobile-release/);assert.match(s,/PACK1_RESULTS_POSTAL_ADDRESS: \$\{\{ secrets\.PACK1_RESULTS_POSTAL_ADDRESS \}\}/);
 assert.ok(!s.includes('vars.PACK1_RESULTS_POSTAL_ADDRESS'),'A normal private variable must not be printed by the runner before masking.');
 assert.match(s,/PACK1_RESULTS_EMAIL_ENABLED=0/);assert.match(s,/configure-results-email-release\.mjs/);
 assert.ok(s.indexOf('Reconcile only the reviewed results email scheduler')>s.indexOf('Verify retained gateway timings for this production release'));
});
test('a normal private postal variable is read only at runtime on protected main, never echoed in step configuration',async()=>{
 const calls=[];const fetcher=async(url)=>{calls.push(url);return Response.json({name:'PACK1_RESULTS_POSTAL_ADDRESS',value:'Synthetic private footer'});};
 const values=await configureResultsEmailRelease({enabled:true,env:{...env,PACK1_RESULTS_POSTAL_ADDRESS:'',GITHUB_TOKEN:'synthetic-token',GITHUB_REPOSITORY:'killjoy00/mtg-ev-analyzer',GITHUB_REF:'refs/heads/main',PACK1_RESULTS_RESEND_WEBHOOK_SECRET:secret},fetcher});
 assert.equal(values.PACK1_RESULTS_POSTAL_ADDRESS,'Synthetic private footer');assert.equal(calls.length,1);assert.ok(calls[0].endsWith('/variables/PACK1_RESULTS_POSTAL_ADDRESS'));
 await assert.rejects(configureResultsEmailRelease({enabled:true,env:{...env,PACK1_RESULTS_POSTAL_ADDRESS:'',GITHUB_TOKEN:'synthetic-token',GITHUB_REPOSITORY:'killjoy00/mtg-ev-analyzer',GITHUB_REF:'refs/heads/unsafe'},fetcher}),/protected main/);
 assert.equal(calls.length,1);
});
test('a private-variable permission failure exposes neither the value nor provider response',async()=>{
 await assert.rejects(configureResultsEmailRelease({enabled:true,env:{...env,PACK1_RESULTS_POSTAL_ADDRESS:'',GITHUB_TOKEN:'synthetic-token',GITHUB_REPOSITORY:'killjoy00/mtg-ev-analyzer',GITHUB_REF:'refs/heads/main'},fetcher:async()=>new Response('PRIVATE_CONFIGURATION_BODY',{status:403})}),error=>/HTTP 403/.test(error.message)&&!error.message.includes('PRIVATE_CONFIGURATION_BODY'));
});
