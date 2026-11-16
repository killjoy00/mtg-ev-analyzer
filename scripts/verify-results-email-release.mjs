// Read-only release acceptance. Never changes activation, consent or deliveries.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {verifyResultsLaunch} from './verify-results-launch.mjs';

export async function verifyResultsEmailSchema(query){
 const result=await query(`SELECT
  to_regclass('results_email_runtime') IS NOT NULL runtime,
  to_regclass('results_email_campaigns') IS NOT NULL campaigns,
  to_regclass('results_email_deliveries') IS NOT NULL deliveries,
  to_regprocedure('pack1_results_claim_delivery(uuid,uuid)') IS NOT NULL claim,
  to_regprocedure('pack1_results_admit_delivery(uuid,uuid,text,text,text)') IS NOT NULL admission,
  to_regprocedure('pack1_results_delivery_event(uuid,text,text,text,text)') IS NOT NULL events,
  (SELECT count(*)=2 FROM pg_constraint WHERE contype='f' AND convalidated AND confdeltype='c'
   AND confrelid='results_preferences'::regclass AND conrelid IN
   ('results_email_campaigns'::regclass,'results_email_deliveries'::regclass)) deletion_cascades,
  NOT EXISTS(SELECT 1 FROM information_schema.table_privileges WHERE grantee='PUBLIC'
   AND table_schema='public' AND table_name IN
   ('results_email_runtime','results_email_campaigns','results_email_deliveries')) private_tables,
  NOT EXISTS(SELECT 1 FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
   WHERE p.oid IN ('pack1_results_claim_delivery(uuid,uuid)'::regprocedure,
    'pack1_results_admit_delivery(uuid,uuid,text,text,text)'::regprocedure,
    'pack1_results_delivery_event(uuid,text,text,text,text)'::regprocedure)
   AND a.grantee=0 AND a.privilege_type='EXECUTE') private_functions`);
 assert.ok(result.rows[0],'Results delivery schema metadata required');
 for(const [name,value] of Object.entries(result.rows[0]))assert.ok(value===true||value==='t','Missing results delivery schema prerequisite: '+name);
 return {schemaVerified:true};
}

export async function verifyResultsEmailLive({commit,before,expectedEnabled=true,fetcher=fetch}={}){
 assert.match(commit||'',/^[a-f0-9]{40}$/,'Exact reviewed release required');
 assert.equal(typeof expectedEnabled,'boolean','Explicit sender configuration state required');
 const after=await verifyResultsLaunch({expectedActive:true,fetcher});
 assert.deepEqual(after,before,'Original notice launch and publication cutoff must remain exactly unchanged');
 const get=async(path,status)=>{
  const response=await fetcher('https://api.packone.pro'+path,{headers:{origin:'https://packone.pro'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,status,'Results release route '+path);
  assert.equal(response.headers.get('cache-control'),'no-store','Uncached results release route required');
  return response;
 };
 const health=await (await get('/growth/health?quick=1',200)).json();
 assert.equal(health.release_commit,commit,'Exact results sender revision');
 if(expectedEnabled)assert.equal(health.results_email_ready,true,'Private sender configuration ready');
 assert.equal(health.results_email_enabled,expectedEnabled,'Reviewed sender configuration state');
 await get('/growth/v1/admin/results-campaigns',401);
 const webhook=await fetcher('https://api.packone.pro/growth/v1/results/provider-event',{method:'POST',headers:{'content-type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(30000)});
 assert.ok(webhook.status===401||(!expectedEnabled&&webhook.status===503),'Unsigned provider events must reach signature verification and be rejected');
 const internal=await fetcher('https://api.packone.pro/growth/internal/results-email',{method:'POST',headers:{authorization:'Bearer forged',origin:'https://packone.pro'},redirect:'error',signal:AbortSignal.timeout(30000)});
 assert.equal(internal.status,404,'Internal delivery must not be a public gateway route');
 return {controlsVerified:true,deliveryProofRequired:true,...after};
}

export async function verifyResultsEmailDevelopment({branch,commit,fetcher=fetch}={}){
 assert.equal(branch,'br-twilight-hill-ayffyd2b','Only the guarded development branch may be checked');
 assert.match(commit||'',/^[a-f0-9]{40}$/,'Exact reviewed development release required');
 const response=await fetcher(`https://${branch}-pack1growth.compute.c-5.us-east-2.aws.neon.tech/health?quick=1`,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,200,'Development health available');
 const health=await response.json();
 assert.equal(health.release_commit,commit,'Exact development sender revision');
 assert.equal(health.results_email_enabled,false,'Development delivery must be disabled');
 assert.equal(health.results_email_ready,false,'Development must not have credentials for the delivery-check path');
 return {developmentSendingDisabled:true};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [operation,file]=process.argv.slice(2);
 if(operation==='schema'){
  const {query}=await import('../worker/growth-function.js');
  console.log(JSON.stringify(await verifyResultsEmailSchema(query)));
 }else if(operation==='development'){
  console.log(JSON.stringify(await verifyResultsEmailDevelopment({branch:process.env.DEV_BRANCH,commit:process.env.GITHUB_SHA})));
 }else if(operation==='capture'){
  assert.ok(file,'Private runner checkpoint path required');
  fs.writeFileSync(file,JSON.stringify(await verifyResultsLaunch({expectedActive:true})),{mode:0o600});
  console.log('Existing notice timing captured without mutation.');
 }else if(operation==='verify'){
  assert.ok(file,'Original notice timing checkpoint required');
  console.log(JSON.stringify(await verifyResultsEmailLive({commit:process.env.GITHUB_SHA,expectedEnabled:process.env.PACK1_RESULTS_EMAIL_ENABLED==='1',before:JSON.parse(fs.readFileSync(file,'utf8'))})));
 }else throw Error('Choose schema, development, capture or verify.');
}
