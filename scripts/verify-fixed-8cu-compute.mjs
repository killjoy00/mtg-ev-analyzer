// One-shot fixed-8-CU control-plane readiness check. No SQL or preview HTTP traffic.
// Run immediately after disposable branch creation and before schema/fixture traffic.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {controlRequest} from './control-read.mjs';

const PROJECT='patient-shadow-91417882',PARENT='br-orange-feather-ayps8kep';
const API='https://console.neon.tech/api/v2/projects/'+PROJECT;
export async function verifyFixed8Compute({branch,created,token,fetcher=fetch,now=Date.now,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxWaitMs=60000}={}) {
  assert.equal(created,'true','Only a new disposable clone may be checked');
  assert.match(branch||'',/^br-[a-z0-9-]+$/,'invalid_disposable_branch');
  assert.notEqual(branch,PARENT,'production_branch_forbidden');
  assert.ok(token,'missing_neon_control_credential');
  assert.ok(maxWaitMs>=0&&maxWaitMs<=60000,'unbounded_endpoint_poll');
  const get=route=>controlRequest(API+route,{provider:'Neon',token,fetcher,redirect:'error'});
  const b=(await get('/branches/'+branch)).branch;
  if(b?.id!==branch||b?.parent_id!==PARENT||
     !Number.isFinite(Date.parse(b.expires_at))||!Number.isFinite(Date.parse(b.created_at))||
     Date.parse(b.expires_at)-Date.parse(b.created_at)>75*60000+1000)
    throw Error('fixed_compute_disposable_scope_or_expiry_mismatch');
  const begun=now();let endpoint;
  for(let attempt=0;attempt<32;attempt++) {
    const list=(await get('/branches/'+branch+'/endpoints')).endpoints;
    if(!Array.isArray(list)||list.length!==1||list[0]?.branch_id!==branch||
       list[0]?.type!=='read_write')throw Error('fixed_compute_endpoint_ownership_mismatch');
    endpoint=list[0];
    if(Number(endpoint.autoscaling_limit_min_cu)!==8||
       Number(endpoint.autoscaling_limit_max_cu)!==8)
      throw Error('fixed_compute_8_cu_configuration_mismatch');
    if(Number(endpoint.suspend_timeout_seconds??endpoint.suspend_timeout)!==300)
      throw Error('fixed_compute_suspension_mismatch');
    if(['active','idle'].includes(endpoint.current_state)&&
       !endpoint.pending_state) {
      return {branch_id:branch,endpoint_id:endpoint.id,current_state:endpoint.current_state,
        min_cu:8,max_cu:8,suspend_seconds:300,
        ready_checked_at:new Date(now()).toISOString(),
        source_revision:process.env.GITHUB_SHA||null};
    }
    if(now()-begun>=maxWaitMs)break;
    await sleep(Math.min(2000,maxWaitMs-(now()-begun)));
  }
  throw Error('fixed_compute_not_ready_before_workload');
}
async function main() {
  const result=await verifyFixed8Compute({
    branch:process.env.PREVIEW_BRANCH,created:process.env.PREVIEW_CREATED,
    token:process.env.NEON_API_KEY});
  fs.mkdirSync('artifacts/launch-load',{recursive:true});
  fs.writeFileSync('artifacts/launch-load/fixed-8cu-preflight.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({event:'fixed_8cu_endpoint_verified',...result}));
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
  main().catch(error=>{console.error(JSON.stringify({event:'fixed_compute_preflight_rejected',
    reason:/^[a-z0-9_]+$/.test(error.message)?error.message:'invalid_endpoint_or_control'}));
    process.exitCode=1;});
