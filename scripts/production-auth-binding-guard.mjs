import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {PROD_AUTH_BASE} from '../worker/account-config.mjs';

export {PROD_AUTH_BASE};
export const PROJECT='patient-shadow-91417882';
export const PROD_BRANCH='br-orange-feather-ayps8kep';

function assert(value,message){if(!value)throw Error(message);}

export function endpointIdForAuthBase(value) {
  let url;
  try{url=new URL(String(value||''));}catch{return null;}
  const match=/^(ep-[a-z0-9-]+)\.neonauth\./.exec(url.hostname);
  return match?.[1]||null;
}

export function webhookProductionAuthBase(source) {
  const block=/production:\s*\{([\s\S]*?)\n\s*\},/.exec(String(source||''))?.[1]||'';
  return /\bauthBase:'([^']+)'/.exec(block)?.[1]||null;
}

async function control(route,{key=process.env.NEON_API_KEY,fetcher=fetch}={}) {
  assert(typeof key==='string'&&key.length>=20,'NEON_API_KEY is missing or too short.');
  const response=await fetcher('https://console.neon.tech/api/v2'+route,{
    method:'GET',
    headers:{authorization:'Bearer '+key,accept:'application/json'},
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  assert(response.ok,'Neon production Auth binding read failed with HTTP '+response.status+'.');
  return response.json();
}

function authBaseFromResponse(value) {
  const source=value?.auth||value?.integration||value;
  return String(source?.base_url||source?.integration?.base_url||'');
}

export async function verifyProductionAuthBinding({
  key=process.env.NEON_API_KEY,
  fetcher=fetch,
  webhookSource=fs.readFileSync(new URL('./auth-webhook-control.mjs',import.meta.url),'utf8'),
}={}) {
  const endpointId=endpointIdForAuthBase(PROD_AUTH_BASE);
  assert(endpointId,'PROD_AUTH_BASE does not contain a valid Neon endpoint id.');
  const [auth,endpointResponse]=await Promise.all([
    control('/projects/'+PROJECT+'/branches/'+PROD_BRANCH+'/auth',{key,fetcher}),
    control('/projects/'+PROJECT+'/endpoints/'+endpointId,{key,fetcher}),
  ]);
  const liveAuthBase=authBaseFromResponse(auth);
  assert(liveAuthBase===PROD_AUTH_BASE,'Production Neon Auth base_url does not match PROD_AUTH_BASE.');
  const endpoint=endpointResponse?.endpoint||endpointResponse;
  assert(endpoint?.id===endpointId&&endpoint?.branch_id===PROD_BRANCH,'PROD_AUTH_BASE endpoint is not attached to the production branch.');
  assert(webhookProductionAuthBase(webhookSource)===PROD_AUTH_BASE,'pack1-authhook production AUTH_BASE does not match PROD_AUTH_BASE.');
  return {project:PROJECT,branch:PROD_BRANCH,auth_base:PROD_AUTH_BASE,endpoint_id:endpointId};
}

async function main(){
  const result=await verifyProductionAuthBinding();
  console.log('PRODUCTION_AUTH_BINDING_GUARD '+JSON.stringify(result));
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  main().catch(error=>{
    console.error(String(error?.message||'Production Auth binding guard failed.'));
    process.exitCode=1;
  });
}
