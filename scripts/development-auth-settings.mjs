// Development keeps its own Neon Auth settings: localhost sign-in allowed, its
// own trusted domains, and the recovery webhook disabled so it can never send
// production password-reset email. A reset from production copies production's
// settings over all of these, so the reset workflow snapshots them first and
// restores them afterwards. See docs/DATABASE-RECOVERY.md.
//
// Usage: development-auth-settings.mjs snapshot|restore|verify <file>
// Output carries no settings values; NEON_API_KEY comes from the environment.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

export const PROJECT_ID='patient-shadow-91417882';
export const DEVELOPMENT_BRANCH='br-twilight-hill-ayffyd2b';
export const PRODUCTION_BRANCH='br-orange-feather-ayps8kep';
const API='https://console.neon.tech/api/v2';
const AUTH_PROVIDER='better_auth';

export function normalizeSettings({domains,allowLocalhost,webhook}) {
  const urls=(domains||[]).map(entry=>typeof entry==='string'?entry:entry?.domain);
  if(!urls.every(url=>typeof url==='string'&&url))throw Error('Neon returned an unexpected trusted-domain list.');
  if(typeof allowLocalhost!=='boolean')throw Error('Neon returned an unexpected allow_localhost value.');
  return {
    domains:[...new Set(urls)].sort(),
    allowLocalhost,
    webhook:{
      enabled:Boolean(webhook?.enabled),
      webhook_url:String(webhook?.webhook_url||''),
      enabled_events:[...(Array.isArray(webhook?.enabled_events)?webhook.enabled_events:[])].sort(),
      timeout_seconds:Number(webhook?.timeout_seconds||0),
    },
  };
}

// A snapshot that already looks like production must not be carried forward.
export function assertDevelopmentInvariants(settings) {
  if(settings.webhook.enabled)throw Error('Development Auth webhook is enabled; disable it before resetting so production recovery email cannot be sent from development.');
  if(!settings.allowLocalhost)throw Error('Development Auth has localhost disabled; restore its own settings before resetting.');
}

function assertDevelopment(branch) {
  if(branch!==DEVELOPMENT_BRANCH)throw Error('Only the development branch may be changed by this script.');
}

export function client({fetcher=fetch,apiKey=process.env.NEON_API_KEY,branch=DEVELOPMENT_BRANCH}={}) {
  assertDevelopment(branch);
  if(!apiKey)throw Error('NEON_API_KEY is required.');
  const base=`${API}/projects/${PROJECT_ID}/branches/${branch}/auth`;
  const call=async(path,method='GET',body)=>{
    const response=await fetcher(base+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{accept:'application/json',authorization:'Bearer '+apiKey,...(body?{'content-type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok)throw Error(`Neon Auth ${method} ${path} failed with HTTP ${response.status}.`);
    const text=await response.text();
    return text?JSON.parse(text):null;
  };
  return {
    async read() {
      const [domains,localhost,webhook]=await Promise.all([call('/domains'),call('/allow_localhost'),call('/webhooks')]);
      return normalizeSettings({domains:domains?.domains,allowLocalhost:localhost?.allow_localhost,webhook});
    },
    addDomain:domain=>call('/domains','POST',{domain,auth_provider:AUTH_PROVIDER}),
    deleteDomain:domain=>call('/domains','DELETE',{auth_provider:AUTH_PROVIDER,domains:[{domain}]}),
    setLocalhost:allow=>call('/allow_localhost','PATCH',{allow_localhost:allow}),
    setWebhook:webhook=>call('/webhooks','PUT',webhook),
  };
}

export function sameSettings(a,b){return JSON.stringify(a)===JSON.stringify(b);}

export async function restore(api,desired) {
  assertDevelopmentInvariants(desired);
  const current=await api.read();
  for(const domain of current.domains)if(!desired.domains.includes(domain))await api.deleteDomain(domain);
  for(const domain of desired.domains)if(!current.domains.includes(domain))await api.addDomain(domain);
  if(current.allowLocalhost!==desired.allowLocalhost)await api.setLocalhost(desired.allowLocalhost);
  if(!sameSettings(current.webhook,desired.webhook))await api.setWebhook(desired.webhook);
  const after=await api.read();
  if(!sameSettings(after,desired))throw Error('Development Auth settings did not return to their pre-reset values.');
  return after;
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  const [command,file]=process.argv.slice(2);
  try {
    if(!file||!['snapshot','restore','verify'].includes(command))throw Error('Usage: development-auth-settings.mjs snapshot|restore|verify <file>');
    const api=client();
    if(command==='snapshot') {
      const settings=await api.read();
      assertDevelopmentInvariants(settings);
      fs.writeFileSync(file,JSON.stringify(settings),{mode:0o600});
      console.log(`Development Auth settings captured (${settings.domains.length} trusted domains).`);
    } else {
      const desired=normalizeSettings(JSON.parse(fs.readFileSync(file,'utf8')));
      if(command==='restore')await restore(api,desired);
      else if(!sameSettings(await api.read(),desired))throw Error('Development Auth settings differ from the pre-reset snapshot.');
      console.log(`Development Auth settings ${command==='restore'?'restored':'verified'}.`);
    }
  } catch(error){console.error(error.message);process.exitCode=1;}
}
