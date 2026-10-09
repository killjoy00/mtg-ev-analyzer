// Fixed-8-CU one-shot compute configuration on a newly owned disposable branch.
// Never sends SQL, gameplay, or preview HTTP. PATCH is issued at most once.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {controlRequest} from './control-read.mjs';
const PROJECT='patient-shadow-91417882',PARENT='br-orange-feather-ayps8kep';
const API='https://console.neon.tech/api/v2/projects/'+PROJECT;
export async function verifyFixed8Compute({branch,created,token,fetcher=fetch,now=Date.now,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxWaitMs=90000}={}) {
  assert.equal(created,'true','Only a fresh disposable clone can be configured');
  assert.match(branch||'',/^br-[a-z0-9-]+$/,'invalid_disposable_branch');
  assert.notEqual(branch,PARENT,'production_branch_forbidden');
  assert.ok(token,'missing_neon_control_credential');
  assert.ok(Number.isInteger(maxWaitMs)&&maxWaitMs>=0&&maxWaitMs<=90000,'unbounded_endpoint_poll');
  const request=(route,options={})=>controlRequest(API+route,{
    provider:'Neon',token,fetcher,...options});
  const b=(await request('/branches/'+branch)).branch;
  const createdAt=Date.parse(b?.created_at),expires=Date.parse(b?.expires_at);
  if(b?.id!==branch||b?.parent_id!==PARENT||
     !Number.isFinite(createdAt)||!Number.isFinite(expires)||
     expires<=now()||expires-createdAt>75*60000+1000)
    throw Error('fixed_compute_disposable_scope_or_expiry_mismatch');
  const begin=now();let first;
  for(let attempt=0;attempt<47;attempt++) {
    const list=(await request('/branches/'+branch+'/endpoints')).endpoints;
    if(!Array.isArray(list)||list.length!==1||
       list[0]?.branch_id!==branch||list[0]?.type!=='read_write'||
       !/^ep-[a-z0-9-]+$/.test(list[0]?.id||''))
      throw Error('fixed_compute_endpoint_ownership_mismatch');
    first=list[0];
    if(['active','idle'].includes(first.current_state)&&!first.pending_state)break;
    if(now()-begin>=maxWaitMs)throw Error('fixed_compute_not_ready_for_config');
    await sleep(Math.min(2000,maxWaitMs-(now()-begin)));
  }
  if(!['active','idle'].includes(first?.current_state)||first.pending_state)
    throw Error('fixed_compute_not_ready_for_config');
  if(Number(first.suspend_timeout_seconds??first.suspend_timeout)!==300)
    throw Error('fixed_compute_suspension_mismatch');
  let patchIssued=false;
  if(Number(first.autoscaling_limit_min_cu)!==8||Number(first.autoscaling_limit_max_cu)!==8) {
    // The named, owned endpoint belongs only to this freshly created branch.
    // Never retry a PATCH after an uncertain outcome; fail closed and clean up.
    patchIssued=true;
    await request('/endpoints/'+first.id,{method:'PATCH',body:{
      endpoint:{autoscaling_limit_min_cu:8,autoscaling_limit_max_cu:8}}});
  }
  for(let attempt=0;attempt<47;attempt++) {
    const list=(await request('/branches/'+branch+'/endpoints')).endpoints;
    if(!Array.isArray(list)||list.length!==1||list[0]?.id!==first.id||
       list[0]?.branch_id!==branch||list[0]?.type!=='read_write')
      throw Error('fixed_compute_readback_ownership_mismatch');
    const endpoint=list[0];
    if(Number(endpoint.suspend_timeout_seconds??endpoint.suspend_timeout)!==300)
      throw Error('fixed_compute_suspension_mismatch');
    if(Number(endpoint.autoscaling_limit_min_cu)===8&&
       Number(endpoint.autoscaling_limit_max_cu)===8&&
       ['active','idle'].includes(endpoint.current_state)&&!endpoint.pending_state) {
      return {branch_id:branch,endpoint_id:first.id,current_state:endpoint.current_state,
        min_cu:8,max_cu:8,suspend_seconds:300,patch_issued:patchIssued,
        ready_checked_at:new Date(now()).toISOString(),
        tested_revision:process.env.GITHUB_SHA||null};
    }
    if(now()-begin>=maxWaitMs)break;
    await sleep(Math.min(2000,maxWaitMs-(now()-begin)));
  }
  throw Error('fixed_compute_not_8_cu_or_not_ready');
}
async function main(){
  const verified=await verifyFixed8Compute({branch:process.env.PREVIEW_BRANCH,
    created:process.env.PREVIEW_CREATED,token:process.env.NEON_API_KEY});
  fs.mkdirSync('artifacts/launch-load',{recursive:true});
  fs.writeFileSync('artifacts/launch-load/fixed-8cu-preflight.json',JSON.stringify(verified,null,2)+'\n');
  console.log(JSON.stringify({event:'fixed8_compute_verified_before_preview_traffic',...verified}));
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
  main().catch(e=>{console.error(JSON.stringify({event:'fixed_compute_preflight_failed',
    reason:/^[a-z0-9_]+$/.test(e.message)?e.message:'neon_configuration_or_control_error'}));
    process.exitCode=1;});
