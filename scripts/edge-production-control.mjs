// Fixed production gateway control. This file cannot accept a hostname, Worker
// name, branch, function slug or arbitrary command from the release request.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const HOST='api.packone.pro';
const WORKER='pack1-gateway';
const BRANCH='br-orange-feather-ayps8kep';

export function parseProductionRequest(value) {
  if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['operation','reason'].includes(k))||
    value.operation!=='deploy-secure-auth'||typeof value.reason!=='string'||!value.reason.trim())
    throw Error('Invalid secure-auth production request.');
  return value.operation;
}

function variable(name,value){fs.appendFileSync(process.env.GITHUB_ENV,name+'='+value+'\n');}
function secret(value){return /^[a-f0-9]{64}$/.test(value||'');}

async function cf(route,{method='GET',body,allow404=false}={}) {
  let response;
  try {
    response=await fetch('https://api.cloudflare.com/client/v4'+route,{
      method,redirect:'error',
      headers:{authorization:'Bearer '+process.env.CLOUDFLARE_EDGE_TOKEN,'content-type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(30000),
    });
  } catch {throw Error('Cloudflare production control request failed.');}
  if(allow404&&response.status===404)return null;
  if(!response.ok)throw Error('Cloudflare production control HTTP '+response.status+'.');
  const data=await response.json();
  if(data.success!==true)throw Error('Cloudflare rejected the production control request.');
  return data;
}

async function context() {
  const zones=(await cf('/zones?name=packone.pro&per_page=50')).result;
  if(zones.length!==1||zones[0].name!=='packone.pro'||zones[0].status!=='active')
    throw Error('Expected the active packone.pro zone.');
  const zone=zones[0];
  if(!/^[a-f0-9]{32}$/.test(zone.id)||!/^[a-f0-9]{32}$/.test(zone.account?.id))
    throw Error('Invalid Cloudflare production identifiers.');
  const domains=await cf('/accounts/'+zone.account.id+'/workers/domains');
  if(!Array.isArray(domains.result)||(domains.result_info?.total_pages||1)>1)
    throw Error('Cannot verify the full production custom-domain inventory.');
  const matches=domains.result.filter(row=>row.hostname===HOST);
  if(matches.length>1||matches.some(row=>row.service!==WORKER||row.zone_id!==zone.id))
    throw Error('Production API hostname belongs to another service.');
  const dns=await cf('/zones/'+zone.id+'/dns_records?name='+encodeURIComponent(HOST)+'&per_page=100');
  if((dns.result_info?.total_pages||1)>1)throw Error('Cannot verify the full production API DNS inventory.');
  return {zone,domain:matches[0]||null,dns:dns.result};
}

function commandFailure(name,args,error) {
  const output=String(error.stderr||'')+'\n'+String(error.stdout||'');
  const status=output.match(/(?:status code|HTTP)\s+(\d{3})\b/i)?.[1];
  const category=/unknown arguments?/i.test(output)?'unsupported argument':/unauthorized|authentication|api.key/i.test(output)?'authentication':/permission|forbidden/i.test(output)?'permission':/not found/i.test(output)?'not found':'unclassified';
  const stage=args[0]==='secret'?'secret installation':'Worker upload';
  return name+' failed during '+stage+'; exit '+(Number.isInteger(error.status)?error.status:'unknown')+'; category '+category+(status?'; HTTP '+status:'')+'.';
}

async function main(action) {
  if(action==='request') {
    const operation=parseProductionRequest(JSON.parse(fs.readFileSync('.github/secure-auth-release-request.json','utf8')));
    fs.appendFileSync(process.env.GITHUB_OUTPUT,'operation='+operation+'\n');
    return;
  }
  if(!process.env.CLOUDFLARE_EDGE_TOKEN)throw Error('CLOUDFLARE_EDGE_TOKEN is required.');
  const {zone,domain,dns}=await context();
  if(action==='preflight') {
    if(!domain&&dns.length)throw Error('Production API DNS exists without the reviewed Worker domain.');
    const settings=await cf('/accounts/'+zone.account.id+'/workers/scripts/'+WORKER+'/settings',{allow404:true});
    if(settings&&!settings.result.bindings?.some(binding=>binding.name==='MODE'&&binding.type==='plain_text'&&binding.text==='production'))
      throw Error('Existing production Worker is not the reviewed gateway.');
    variable('CLOUDFLARE_ACCOUNT_ID',zone.account.id);
    console.log('Production API hostname is clear for the reviewed gateway.');
    return;
  }
  if(action!=='deploy')throw Error('Unknown production gateway operation.');
  const commit=process.env.GITHUB_SHA;
  if(!/^[a-f0-9]{40}$/.test(commit||''))throw Error('Require an exact production release revision.');
  const quota=randomBytes(32).toString('hex');console.log('::add-mask::'+quota);
  const bin=name=>path.join(process.env.EDGE_TOOLS_DIR,'node_modules/.bin',name);
  const run=(name,args,input)=>{
    try{return execFileSync(bin(name),args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,CLOUDFLARE_API_TOKEN:process.env.CLOUDFLARE_EDGE_TOKEN}});}
    catch(error){throw Error(commandFailure(name,args,error));}
  };
  const config=JSON.parse(fs.readFileSync('edge/wrangler.json','utf8'));
  config.name=WORKER;
  config.main=path.resolve('edge/gateway.mjs');
  config.account_id=zone.account.id;
  config.vars={MODE:'production',NEON_BRANCH_ID:BRANCH};
  const configPath=path.join(process.env.RUNNER_TEMP,'edge-production-wrangler.json');
  fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
  run('wrangler',['deploy','--config',configPath]);
  const credentialProof=String(process.env.PACK1_RATE_LIMIT_SECRET||'');
  if(credentialProof.length<32)throw Error('Require the credential rate-limit secret for the production gateway.');
  run('wrangler',['secret','bulk','--config',configPath],JSON.stringify({
    QUOTA_KEY:quota,
    CREDENTIAL_PROOF_KEY:credentialProof,
  }));
  await cf('/accounts/'+zone.account.id+'/workers/domains',{method:'PUT',body:{hostname:HOST,service:WORKER,zone_id:zone.id}});
  const after=await context();
  if(!after.domain||after.domain.service!==WORKER)throw Error('Production gateway domain verification failed.');
  console.log('Production gateway attached to api.packone.pro.');
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)main(process.argv[2]).catch(error=>{
  const message=String(error.message||'');
  console.error(/^(CLOUDFLARE|Cloudflare production|Cloudflare rejected|Invalid secure-auth|Expected the|Invalid Cloudflare|Cannot verify|Production API|Existing production|Unknown production|Require an exact|wrangler failed|Production gateway)/.test(message)?message:'Production gateway operation failed.');
  process.exitCode=1;
});
