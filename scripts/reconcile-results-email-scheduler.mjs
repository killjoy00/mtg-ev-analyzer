import {pathToFileURL} from 'node:url';
import {NEON_PROJECT_ID,PRODUCTION_BRANCH,NEON_SCHEDULERS} from './reconcile-neon-schedulers.mjs';
export const RESULTS_EMAIL_SCHEDULE={type:'schedule',...NEON_SCHEDULERS.find(s=>s.name==='pack1-results-email')};
export async function reconcileResultsEmailScheduler({enabled,commit,apiKey=process.env.NEON_API_KEY,fetcher=fetch}={}){
 if(typeof enabled!=='boolean'||!/^\S{20,}$/.test(String(apiKey||'')))throw Error('Explicit results scheduler state and credentials required.');
 if(enabled){
  if(!/^[a-f0-9]{40}$/.test(commit||''))throw Error('An exact reviewed release revision is required.');
  const response=await fetcher(`https://${PRODUCTION_BRANCH}-pack1growth.compute.c-5.us-east-2.aws.neon.tech/health?quick=1`,{redirect:'error',signal:AbortSignal.timeout(30000)});
  const health=response.ok?await response.json():null;
  if(health?.release_commit!==commit||health.results_email_ready!==true||health.results_email_enabled!==true)throw Error('The configured results sender revision is not live.');
 }
 const base=`https://console.neon.tech/api/v2/projects/${NEON_PROJECT_ID}/branches/${PRODUCTION_BRANCH}/triggers`;
 const call=async(url,body)=>{
  const response=await fetcher(url,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+apiKey,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error('Results scheduler control failed (HTTP '+response.status+').');return response.json();
 };
 const inventory=await call(base);
 if(!Array.isArray(inventory.triggers))throw Error('Results scheduler inventory could not be verified.');
 const matches=inventory.triggers.filter(t=>t.name===RESULTS_EMAIL_SCHEDULE.name);
 if(matches.length>1||matches.some(t=>t.inherited||t.type!=='schedule'||t.function_slug!==RESULTS_EMAIL_SCHEDULE.function_slug||t.function_path!==RESULTS_EMAIL_SCHEDULE.function_path))throw Error('Results scheduler ownership is ambiguous.');
 const existing=matches[0];
 if(!existing&&!enabled)return {enabled:false};
 const spec={...RESULTS_EMAIL_SCHEDULE,enabled};
 let result;
 if(existing){
  const response=await fetcher(base+'/'+encodeURIComponent(existing.trigger_id),{method:'PATCH',redirect:'error',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+apiKey,'content-type':'application/json'},body:JSON.stringify(spec)});
  if(!response.ok)throw Error('Results scheduler update failed (HTTP '+response.status+').');result=await response.json();
 }else result=await call(base,spec);
 const trigger=result?.trigger;
 if(!trigger||Object.entries(spec).some(([k,v])=>JSON.stringify(trigger[k])!==JSON.stringify(v)))throw Error('Results scheduler did not reconcile exactly.');
 return {enabled:trigger.enabled,nextRunAt:trigger.next_run_at||null};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const enabled=process.argv[2]==='enable';if(!['enable','disable'].includes(process.argv[2]))throw Error('Choose enable or disable.');
 console.log(JSON.stringify(await reconcileResultsEmailScheduler({enabled,commit:process.env.GITHUB_SHA})));
}
