// Fixed preview control plane. No arbitrary shell command, hostname, account,
// production branch or API path can be supplied by the request file.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {deployPreviewFunction} from './edge-neon-deploy.mjs';
const HOST='api-preview.packone.pro',WORKER='pack1-gateway-preview';
export function parseRequest(value) {
  if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['operation','reason'].includes(k))||
    !['check-access','deploy-preview','disable-preview','probe-auth-webhook','stage-auth-webhook-probe','run-auth-webhook-probe','cleanup-auth-webhook-probe'].includes(value.operation)||typeof value.reason!=='string'||!value.reason.trim())throw Error('Invalid preview request.');
  return value.operation;
}
export function checkBranch(branch) {
  if(!/^br-[a-z0-9-]+$/.test(branch||'')||['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b'].includes(branch))throw Error('An isolated preview branch is required.');
}
export function inheritedFunctionSlugs(list,branch,created) {
  checkBranch(branch);
  if(created!=='true')throw Error('Require a newly created isolated branch for inherited function isolation.');
  const functions=Array.isArray(list)?list:list?.functions;
  if(!Array.isArray(functions)||functions.some(f=>!f||!/^[a-z][a-z0-9-]{0,62}$/.test(f.slug)))throw Error('Unexpected inherited function inventory.');
  const slugs=functions.map(f=>f.slug);
  if(new Set(slugs).size!==slugs.length)throw Error('Unexpected inherited function inventory.');
  return slugs;
}
function variable(name,value) {fs.appendFileSync(process.env.GITHUB_ENV,`${name}=${value}\n`);}
export function commandFailure(name,args,error) {
  const output=String(error.stderr||'')+'\n'+String(error.stdout||'');
  const status=output.match(/(?:status code|HTTP)\s+(\d{3})\b/i)?.[1];
  const category=/unknown arguments?/i.test(output)?'unsupported argument':/unauthorized|authentication|api.key/i.test(output)?'authentication':/permission|forbidden/i.test(output)?'permission':/not found/i.test(output)?'not found':'unclassified';
  const stage=name==='neon'?`functions ${['list','delete','deploy'].includes(args[1])?args[1]:'operation'}`:args[0]==='secret'?'secret installation':'Worker upload';
  return `${name} failed during ${stage}; exit ${Number.isInteger(error.status)?error.status:'unknown'}; category ${category}${status?`; HTTP ${status}`:''}.`;
}
async function cf(route,{method='GET',body,allow404=false}={}) {
  let r;
  try {r=await fetch('https://api.cloudflare.com/client/v4'+route,{method,redirect:'error',headers:{authorization:`Bearer ${process.env.CLOUDFLARE_EDGE_TOKEN}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});}catch{throw Error('Cloudflare control request failed.');}
  if(allow404&&r.status===404)return null;
  if(!r.ok)throw Error(`Cloudflare control HTTP ${r.status}; check the scoped deployment token.`);
  const result=await r.json();if(!result.success)throw Error('Cloudflare rejected the control request.');
  return result;
}
async function context() {
  const zones=(await cf('/zones?name=packone.pro&per_page=50')).result;
  if(zones.length!==1||zones[0].name!=='packone.pro'||zones[0].status!=='active')throw Error('Expected the active packone.pro zone.');
  const zone=zones[0];
  if(!/^[a-f0-9]{32}$/.test(zone.id)||!/^[a-f0-9]{32}$/.test(zone.account?.id))throw Error('Invalid Cloudflare identifiers.');
  const result=await cf(`/accounts/${zone.account.id}/workers/domains`);
  if(!Array.isArray(result.result)||(result.result_info?.total_pages||1)>1)throw Error('Cannot verify the full custom-domain inventory.');
  const matches=result.result.filter(d=>d.hostname===HOST);
  if(matches.length>1||matches.some(d=>d.service!==WORKER||d.zone_id!==zone.id))throw Error('Preview hostname belongs to another service; refusing to replace it.');
  return {zone,domain:matches[0]};
}
async function main(action) {
  if(action==='request') {
    const operation=parseRequest(JSON.parse(fs.readFileSync('.github/edge-preview-request.json','utf8')));
    fs.appendFileSync(process.env.GITHUB_OUTPUT,`operation=${operation}\n`);return;
  }
  if(action==='neon-preflight') {
    if(!process.env.NEON_API_KEY)throw Error('Neon control credential is missing.');
    let response;
    try {response=await fetch('https://console.neon.tech/api/v2/projects/patient-shadow-91417882/branches/br-twilight-hill-ayffyd2b/functions',{headers:{authorization:`Bearer ${process.env.NEON_API_KEY}`},redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw Error('Neon control request failed.');}
    if(!response.ok)throw Error(`Neon control function inventory HTTP ${response.status}; no preview branch was created.`);
    const body=await response.json();
    if(!Array.isArray(body.functions))throw Error('Neon control returned an unexpected function inventory.');
    console.log('Neon function inventory access verified before provisioning.');return;
  }
  if(!process.env.CLOUDFLARE_EDGE_TOKEN)throw Error('Add repository Actions secret CLOUDFLARE_EDGE_TOKEN; see docs/EDGE-OPERATIONS.md.');
  const {zone,domain}=await context();
  if(action==='preflight') {
    const dns=await cf(`/zones/${zone.id}/dns_records?name=${HOST}&per_page=100`);
    if((dns.result_info?.total_pages||1)>1||(!domain&&dns.result.length))throw Error('Preview DNS already exists without our Worker mapping; refusing to replace it.');
    const settings=await cf(`/accounts/${zone.account.id}/workers/scripts/${WORKER}/settings`,{allow404:true});
    if(settings&&!settings.result.bindings?.some(b=>b.name==='MODE'&&b.type==='plain_text'&&b.text==='preview'))throw Error('Existing Worker is not marked as our preview; refusing to overwrite it.');
    variable('CLOUDFLARE_ACCOUNT_ID',zone.account.id);
    console.log('Scoped Cloudflare access and preview hostname ownership verified.');return;
  }
  if(action==='disable') {
    if(domain) {
      if(!/^[a-f0-9]{32}$/.test(domain.id))throw Error('Unexpected custom-domain identifier.');
      await cf(`/accounts/${zone.account.id}/workers/domains/${domain.id}`,{method:'DELETE'});
    }
    console.log('Preview custom domain disabled. Backend guards remain enabled; the isolated branch expires automatically.');return;
  }
  if(action!=='deploy')throw Error('Unknown preview operation.');
  const branch=process.env.PREVIEW_BRANCH,commit=process.env.GITHUB_SHA;
  checkBranch(branch);
  if(process.env.PREVIEW_CREATED!=='true'||!/^[a-f0-9]{40}$/.test(commit||''))throw Error('Require a newly created isolated branch and exact release revision.');
  const origin=randomBytes(32).toString('hex'),preview=randomBytes(32).toString('hex'),quota=randomBytes(32).toString('hex');
  for(const value of [origin,preview,quota])console.log(`::add-mask::${value}`);
  const bin=name=>path.join(process.env.EDGE_TOOLS_DIR,'node_modules/.bin',name);
  const run=(name,args,input)=>{
    try {return execFileSync(bin(name),args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,CLOUDFLARE_API_TOKEN:process.env.CLOUDFLARE_EDGE_TOKEN}});}
    catch(error) {throw Error(commandFailure(name,args,error));}
  };
  // Inherited function entries cannot reliably be deleted (live API: 404).
  // Shadow utility functions with always-deny code on this fresh branch only.
  const inventory=()=>inheritedFunctionSlugs(JSON.parse(run('neon',['functions','list','--project-id','patient-shadow-91417882','--branch',branch,'--output','json'])),branch,process.env.PREVIEW_CREATED);
  const inherited=inventory();
  const sealed=inherited.filter(slug=>!['pack1api','pack1growth','draftrunapi'].includes(slug));
  const closedDir=path.join(process.env.RUNNER_TEMP,'closed-preview-origin');fs.mkdirSync(closedDir,{recursive:true});
  fs.copyFileSync('edge/closed-origin.mjs',path.join(closedDir,'closed-origin.mjs'));
  fs.writeFileSync(path.join(closedDir,'index.mjs'),`import {closedOrigin} from './closed-origin.mjs'; export default closedOrigin(${JSON.stringify(commit)});\n`);
  fs.writeFileSync(path.join(closedDir,'package.json'),'{"type":"module"}\n');
  for(const slug of sealed) {
    await deployPreviewFunction({branch,slug,directory:closedDir,apiKey:process.env.NEON_API_KEY});
    const response=await fetch(`https://${branch}-${slug}.compute.c-5.us-east-2.aws.neon.tech/health?quick=1`,{redirect:'error',signal:AbortSignal.timeout(30000)});
    if(response.status!==403||(await response.json()).release_commit!==commit)throw Error('Origin closure verification failed; preview has not been attached.');
    console.log(`${slug}: inherited preview endpoint closed and revision verified.`);
  }
  variable('PREVIEW_SEALED_FUNCTIONS',sealed.join(','));
  for(const slug of ['pack1api','pack1growth','draftrunapi']) {
    await deployPreviewFunction({branch,slug,directory:path.join(process.env.RUNNER_TEMP,'pack1-bundles',slug),environment:{PACK1_REQUIRE_INGRESS:'1',PACK1_INGRESS_SECRET:origin},apiKey:process.env.NEON_API_KEY});
    const base=`https://${branch}-${slug}.compute.c-5.us-east-2.aws.neon.tech`;
    const unauth=await fetch(base+'/health?quick=1',{redirect:'error',signal:AbortSignal.timeout(30000)});
    if(unauth.status!==403)throw Error('Origin did not reject direct access; preview has not been attached.');
    const verified=await fetch(base+'/health?quick=1',{headers:{'x-pack1-ingress-secret':origin},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(verified.status!==200||(await verified.json()).release_commit!==commit)throw Error('Origin revision verification failed.');
    console.log(`${slug}: protected preview origin and revision verified.`);
  }
  const expected=new Set([...sealed,'pack1api','pack1growth','draftrunapi']);
  const installed=inventory();
  if(installed.length!==expected.size||installed.some(slug=>!expected.has(slug)))throw Error('Unexpected inherited function inventory after deployment.');
  const config=JSON.parse(fs.readFileSync('edge/wrangler.json','utf8'));
  config.main=path.resolve('edge/gateway.mjs');config.account_id=zone.account.id;
  config.vars={...config.vars,NEON_BRANCH_ID:branch};
  const configPath=path.join(process.env.RUNNER_TEMP,'edge-wrangler.json');
  fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
  run('wrangler',['deploy','--config',configPath]);
  run('wrangler',['secret','bulk','--config',configPath],JSON.stringify({ORIGIN_SECRET:origin,PREVIEW_KEY:preview,QUOTA_KEY:quota}));
  await cf(`/accounts/${zone.account.id}/workers/domains`,{method:'PUT',body:{hostname:HOST,service:WORKER,zone_id:zone.id}});
  variable('PREVIEW_ACCESS_KEY',preview);variable('PREVIEW_ORIGIN_SECRET',origin);
  console.log('Private preview deployed. Live acceptance must still pass.');
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)main(process.argv[2]).catch(error=>{
  // Unexpected failures may carry request data. Only our fixed messages leave
  // this control process; never print a provider response or process arguments.
  const message=String(error.message||'');
  console.error(/^(Add repository|Invalid preview|An isolated|Cloudflare control|Cloudflare rejected|Neon control|Expected the|Invalid Cloudflare|Cannot verify|Preview hostname|Preview DNS|Existing Worker|Unexpected custom|Unknown preview|Require a newly|Unexpected inherited|Origin did|Origin revision|Origin closure|neon failed|wrangler failed)/.test(message)?message:'Preview operation failed; inspect the sanitized step status.');
  process.exitCode=1;
});
