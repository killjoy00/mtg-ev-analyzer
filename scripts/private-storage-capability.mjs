// Narrow, read-only probe of the single approved destination. No token
// inventory, permission changes, response bodies or credential values.
import {ACCOUNT,BUCKET,privateStore,publicFailureCode} from './private-compute-report.mjs';
import {execFileSync} from 'node:child_process';
import {PROJECT} from './neon-compute-history.mjs';
if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer')throw Error('Reviewed main required');
for(const [label,token] of [['existing_edge',process.env.CLOUDFLARE_EDGE_TOKEN],['existing_audit',process.env.CLOUDFLARE_AUDIT_TOKEN]]) {
 if(!token){console.log(label+': unavailable');continue;}
 try {await privateStore({token}).verify();console.log(label+': private configuration verified');}
 catch(error){console.log(label+': '+publicFailureCode(error));}
}
const endpoint=`https://${ACCOUNT}.r2.cloudflarestorage.com`;
if(!process.env.AWS_ACCESS_KEY_ID||!process.env.AWS_SECRET_ACCESS_KEY)console.log('existing_storage: unavailable');
else try {
 execFileSync('aws',['s3api','head-bucket','--bucket',BUCKET,'--endpoint-url',endpoint,'--cli-connect-timeout','10','--cli-read-timeout','30'],
   {stdio:'pipe',env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_DEFAULT_REGION:'auto'},timeout:45000});
 console.log('existing_storage: bucket read available');
}catch {console.log('existing_storage: bucket read unavailable');}
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
