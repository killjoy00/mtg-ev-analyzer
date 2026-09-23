import {pathToFileURL} from 'node:url';

export const NEON_PROJECT_ID='patient-shadow-91417882';
export const PRODUCTION_BRANCH='br-orange-feather-ayps8kep';
export const NEON_SCHEDULERS=Object.freeze([
  Object.freeze({
    name:'pack1-daily-primary',
    function_slug:'draftrunapi',
    function_path:'/internal/daily-generation',
    schedule:Object.freeze({cron:'7 7,8 * * *'}),
  }),
  Object.freeze({
    name:'pack1-daily-retry',
    function_slug:'draftrunapi',
    function_path:'/internal/daily-generation',
    schedule:Object.freeze({cron:'37 7,8 * * *'}),
  }),
  Object.freeze({
    name:'pack1-account-deletion-maintenance',
    function_slug:'pack1growth',
    function_path:'/internal/account-deletion-maintenance',
    schedule:Object.freeze({cron:'9,19,29,39,49,59 * * * *'}),
  }),
]);

const API='https://console.neon.tech/api/v2';

async function neon(path,{method='GET',body,apiKey=process.env.NEON_API_KEY,fetcher=fetch}={}) {
  if(!/^\S{20,}$/.test(String(apiKey||'')))throw Error('NEON_API_KEY is missing or malformed.');
  const response=await fetcher(API+path,{
    method,
    headers:{authorization:`Bearer ${apiKey}`,accept:'application/json',...(body?{'content-type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
    redirect:'error',
    signal:AbortSignal.timeout(30000),
  });
  const data=response.status===204?null:await response.json().catch(()=>null);
  if(!response.ok)throw Error(`Neon trigger control failed (${response.status}).`);
  return data;
}

export async function reconcileNeonSchedulers({enabled,apiKey,fetcher=fetch,projectId=NEON_PROJECT_ID,branchId=PRODUCTION_BRANCH}={}) {
  if(typeof enabled!=='boolean')throw Error('enabled must be boolean.');
  const base=`/projects/${projectId}/branches/${branchId}/triggers`;
  const listed=await neon(base,{apiKey,fetcher});
  const triggers=Array.isArray(listed?.triggers)?listed.triggers:[];
  const byName=new Map(triggers.map(trigger=>[trigger.name,trigger]));
  const results=[];
  for(const spec of NEON_SCHEDULERS) {
    const existing=byName.get(spec.name);
    const body={type:'schedule',function_slug:spec.function_slug,name:spec.name,function_path:spec.function_path,schedule:{cron:spec.schedule.cron},enabled};
    let updated;
    if(existing) {
      if(existing.type!=='schedule')throw Error(`Trigger ${spec.name} has unexpected type.`);
      if(existing.inherited)throw Error(`Trigger ${spec.name} is inherited; production must own scheduler definitions.`);
      updated=await neon(`${base}/${encodeURIComponent(existing.trigger_id)}`,{method:'PATCH',body,apiKey,fetcher});
    } else {
      updated=await neon(base,{method:'POST',body,apiKey,fetcher});
    }
    const trigger=updated?.trigger;
    if(!trigger||trigger.name!==spec.name||trigger.function_slug!==spec.function_slug||trigger.function_path!==spec.function_path||trigger.schedule?.cron!==spec.schedule.cron||trigger.enabled!==enabled) {
      throw Error(`Trigger ${spec.name} did not reconcile exactly.`);
    }
    results.push({name:trigger.name,trigger_id:trigger.trigger_id,enabled:trigger.enabled,next_run_at:trigger.next_run_at||null});
  }
  return {project_id:projectId,branch_id:branchId,enabled,results};
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  const action=process.argv[2];
  if(!['enable','disable'].includes(action||''))throw Error('Usage: reconcile-neon-schedulers.mjs enable|disable');
  console.log(JSON.stringify(await reconcileNeonSchedulers({enabled:action==='enable'}),null,2));
}
