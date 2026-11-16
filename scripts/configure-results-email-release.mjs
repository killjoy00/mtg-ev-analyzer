import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const RESULTS_WEBHOOK='https://api.packone.pro/growth/v1/results/provider-event';
const EVENTS=['email.bounced','email.complained','email.delivered','email.sent'];
export function readResultsEmailRelease(value){
 if(!value||Array.isArray(value)||JSON.stringify(Object.keys(value))!==JSON.stringify(['enabled'])||typeof value.enabled!=='boolean')throw Error('Invalid results email release configuration.');
 return value.enabled;
}
export async function configureResultsEmailRelease({enabled,env=process.env,fetcher=fetch}={}){
 if(enabled===false)return {PACK1_RESULTS_EMAIL_ENABLED:'0'};
 if(enabled!==true)throw Error('Explicit delivery state required.');
 let postal=String(env.PACK1_RESULTS_POSTAL_ADDRESS||'').trim();
 if(!postal&&env.GITHUB_TOKEN){
  // A normal GitHub variable must never be interpolated into step/job env:
  // the runner prints that environment BEFORE add-mask can execute.
  if(env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer'||env.GITHUB_REF!=='refs/heads/main')throw Error('Private postal configuration may only be read by the protected main release.');
  let response;try{response=await fetcher('https://api.github.com/repos/killjoy00/mtg-ev-analyzer/environments/pack-one-mobile-release/variables/PACK1_RESULTS_POSTAL_ADDRESS',{
   headers:{authorization:'Bearer '+env.GITHUB_TOKEN,accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(15000),
  });}catch{throw Error('Private postal configuration could not be read securely.');}
  if(!response.ok)throw Error('Private postal variable could not be read (HTTP '+response.status+'). Set the same-named Environment secret to enable automatic log redaction.');
  const variable=await response.json().catch(()=>null);
  if(variable?.name!=='PACK1_RESULTS_POSTAL_ADDRESS'||typeof variable.value!=='string')throw Error('Private postal configuration was not verified.');
  postal=variable.value.trim();
 }
 const name=String(env.PACK1_RESULTS_SENDER_NAME||'Pack One').trim(),from=String(env.PACK1_RESULTS_SENDER_EMAIL||'news@packone.pro').trim();
 const apiKey=String(env.PACK1_RESULTS_RESEND_API_KEY||env.PACK1_REMINDER_RESEND_API_KEY||env.PACK1_ACCOUNT_DELETE_RESEND_API_KEY||'');
 if(!postal||postal.length>500)throw Error('PACK1_RESULTS_POSTAL_ADDRESS is required in the private release environment.');
 if(!name||name.length>200||/[\r\n<>]/.test(name)||!/^[-.\w+]+@[-.\w]+\.packone\.pro$|^[-.\w+]+@packone\.pro$/.test(from))throw Error('Use the approved Pack One sender configuration.');
 if(!apiKey.startsWith('re_'))throw Error('Results sending credentials are unavailable.');
 let secret=String(env.PACK1_RESULTS_RESEND_WEBHOOK_SECRET||'');
 if(!secret){
  const controlKey=String(env.PACK1_RESULTS_RESEND_ADMIN_KEY||apiKey);
  const api=async(path,{method='GET',body}={})=>{
   let response;try{response=await fetcher('https://api.resend.com'+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+controlKey,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
   catch{throw Error('Results webhook control transport could not be confirmed.');}
   if(!response.ok)throw Error('Results webhook control failed (HTTP '+response.status+'). A full-access configuration key or dedicated webhook secret is required.');
   const value=await response.json().catch(()=>null);if(!value)throw Error('Results webhook control returned no verified result.');return value;
  };
  const locate=async()=>{
   let after='',matches=[];
   for(let page=0;page<10;page++){
    const list=await api('/webhooks?limit=100'+(after?'&after='+encodeURIComponent(after):''));
    if(!Array.isArray(list.data))throw Error('Could not inspect results webhook inventory.');
    matches.push(...list.data.filter(row=>row.endpoint===RESULTS_WEBHOOK));
    if(!list.has_more){if(matches.length>1)throw Error('Duplicate results webhooks require reconciliation.');return matches[0]||null;}
    const next=list.data.at(-1)?.id;if(!next||next===after)throw Error('Results webhook inventory did not advance.');after=next;
   }
   throw Error('Results webhook inventory exceeded the bounded scan.');
  };
  let hook=await locate();
  if(!hook){
   try{hook=await api('/webhooks',{method:'POST',body:{endpoint:RESULTS_WEBHOOK,events:EVENTS}});}
   catch(error){hook=await locate();if(!hook)throw error;}
  }
  if(typeof hook.id!=='string'||!hook.id)throw Error('Results webhook identity was not confirmed.');
  const verified=await api('/webhooks/'+encodeURIComponent(hook.id));
  if(verified.endpoint!==RESULTS_WEBHOOK||verified.status!=='enabled'||JSON.stringify([...verified.events||[]].sort())!==JSON.stringify(EVENTS))throw Error('The dedicated results webhook does not match the reviewed configuration.');
  secret=verified.signing_secret;
 }
 if(!/^whsec_[A-Za-z0-9+/=_-]{12,}$/.test(secret||''))throw Error('Dedicated results webhook signing configuration is unavailable.');
 return {PACK1_RESULTS_EMAIL_ENABLED:'1',PACK1_RESULTS_SENDER_NAME:name,PACK1_RESULTS_SENDER_EMAIL:from,PACK1_RESULTS_POSTAL_ADDRESS:postal,PACK1_RESULTS_RESEND_API_KEY:apiKey,PACK1_RESULTS_RESEND_WEBHOOK_SECRET:secret};
}
export function writePrivateResultsEnvironment(values,file,{mask=value=>console.log('::add-mask::'+String(value).replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A'))}={}){
 if(!file)throw Error('A private runner environment file is required.');
 for(const [name,value] of Object.entries(values)){
  if(!/^PACK1_RESULTS_[A-Z_]+$/.test(name))throw Error('Unexpected results release variable.');
  if(/POSTAL|KEY|SECRET/.test(name))mask(value);
  const delimiter='PACKONE_'+randomUUID().replaceAll('-','');
  fs.appendFileSync(file,name+'<<'+delimiter+'\n'+value+'\n'+delimiter+'\n',{mode:0o600});
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const enabled=readResultsEmailRelease(JSON.parse(fs.readFileSync('.github/results-email-delivery.json','utf8')));
  writePrivateResultsEnvironment(await configureResultsEmailRelease({enabled}),process.env.GITHUB_ENV);
  console.log('Results sender configuration prepared privately; general delivery still requires verified provider delivery.');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
