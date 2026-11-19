// Narrow, read-only probe of the single approved destination. No token
// inventory, permission changes, response bodies or credential values.
import {privateStore,publicFailureCode} from './private-compute-report.mjs';
import {PROJECT} from './neon-compute-history.mjs';
if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer')throw Error('Reviewed main required');
const token=process.env.CLOUDFLARE_PRIVATE_REPORT_TOKEN;
if(!token)console.log('private_storage: credential unavailable');
else try {await privateStore({token}).verify();console.log('private_storage: private configuration verified');}
catch(error){console.log('private_storage: '+publicFailureCode(error));}
// Establish history capability without publishing or retaining usage values
// when storage is unavailable. A successful HTTP response is not attribution.
const key=process.env.NEON_API_KEY;
if(!key)console.log('existing_neon_history: unavailable');
else try {
 const options={method:'GET',redirect:'error',headers:{authorization:`Bearer ${key}`},signal:AbortSignal.timeout(30000)};
 const response=await fetch(`https://console.neon.tech/api/v2/projects/${PROJECT}`,options);
 if(!response.ok)throw Error('Metadata unavailable');
 const metadata=await response.json();
 if(metadata?.project?.id!==PROJECT||!/^[a-z0-9-]{1,60}$/.test(metadata.project.org_id||''))throw Error('Metadata invalid');
 const end=Math.floor(Date.now()/3600000)*3600000-3600000;
 const params=new URLSearchParams({org_id:metadata.project.org_id,project_ids:PROJECT,from:new Date(end-3600000).toISOString(),to:new Date(end).toISOString(),granularity:'hourly',metrics:'compute_unit_seconds',limit:'1'});
 for(const kind of ['projects','branches']) {
   const r=await fetch('https://console.neon.tech/api/v2/consumption_history/v2/'+kind+'?'+params,{...options,signal:AbortSignal.timeout(30000)});
   console.log(`existing_neon_${kind}_history: HTTP ${r.status}`);
   await r.body?.cancel();
 }
}catch {console.log('existing_neon_history: capability check unavailable');}
