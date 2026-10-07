// Fixed preview control plane. No arbitrary shell command, hostname, account,
// production branch or API path can be supplied by the request file.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {request as httpsRequest} from 'node:https';
import {pathToFileURL} from 'node:url';
import {deployPreviewFunction} from './edge-neon-deploy.mjs';
import {controlRequest,transientControlStatus} from './control-read.mjs';
import {assertPreviewOwner,resourceReceipt,writeResourceReceipt,cleanupOwnedDns} from './preview-resource-ownership.mjs';
const HOST='api-preview.packone.pro',WORKER='pack1-gateway-preview';
const READINESS_CONSECUTIVE=20,READINESS_INTERVAL_MS=2000,READINESS_DEADLINE_MS=180000;
export function parseRequest(value) {
  if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['operation','reason'].includes(k))||
    !['idle','check-access','deploy-preview','disable-preview','probe-auth-webhook','stage-auth-webhook-probe','run-auth-webhook-probe','cleanup-auth-webhook-probe','probe-email-verification'].includes(value.operation)||typeof value.reason!=='string'||!value.reason.trim())throw Error('Invalid preview request.');
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
export function freshPreviewHealth({preview,request=httpsRequest,timeout_ms=10000}={}) {
  return new Promise(resolve=>{
    let settled=false;const done=value=>{if(settled)return;settled=true;resolve(value);};
    let req;
    try {
      req=request({protocol:'https:',hostname:HOST,port:443,path:'/draft/health?quick=1',method:'GET',agent:false,
        headers:{'x-pack1-preview-key':preview}},response=>{
        let body='';response.setEncoding('utf8');
        response.on('data',chunk=>{body=(body+chunk).slice(0,8192);});
        response.on('end',()=>{
          let release=null;try {const parsed=JSON.parse(body);if(/^[a-f0-9]{40}$/.test(parsed?.release_commit||''))release=parsed.release_commit;} catch {}
          done({status:response.statusCode||0,release});
        });
        response.on('error',()=>done({status:response.statusCode||0,release:null}));
      });
    } catch {done({status:0,release:null});return;}
    req.setTimeout(timeout_ms,()=>req.destroy(Error('timeout')));
    req.on('error',()=>done({status:0,release:null}));
    req.end();
  });
}
export async function waitForPreviewReadiness({probe,commit,clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),
  required=READINESS_CONSECUTIVE,interval_ms=READINESS_INTERVAL_MS,deadline_ms=READINESS_DEADLINE_MS}={}) {
  if(typeof probe!=='function'||!/^[a-f0-9]{40}$/.test(commit||'')||!Number.isInteger(required)||required<2||
    !Number.isFinite(interval_ms)||interval_ms<0||!Number.isFinite(deadline_ms)||deadline_ms<=0)throw Error('Invalid preview readiness probe configuration.');
  const deadline=clock()+deadline_ms;let consecutive=0,attempts=0,last={status:0,release:null};
  while(clock()<deadline) {
    try {last=await probe();} catch {last={status:0,release:null};}
    attempts++;
    const matches=last?.status===200&&last?.release===commit;
    consecutive=matches?consecutive+1:0;
    if(!matches)console.log(JSON.stringify({event:'preview_readiness_mismatch',attempt:attempts,
      status:Number.isInteger(last?.status)?last.status:null,release_commit:/^[a-f0-9]{40}$/.test(last?.release||'')?last.release:null}));
    if(consecutive>=required)return {ready:true,attempts,consecutive,last};
    if(clock()>=deadline)break;
    await sleep(interval_ms);
  }
  return {ready:false,attempts,consecutive,last};
}
async function cf(route,options={}) {
  const result=await controlRequest('https://api.cloudflare.com/client/v4'+route,
    {provider:'Cloudflare',token:process.env.CLOUDFLARE_EDGE_TOKEN,...options});
  if(result===null&&(options.allow404||options.method==='DELETE'))return result;
  if(!result?.success)throw Error('Cloudflare rejected the control request.');
  return result;
}
function ownedDomain(domain,zone) {
  if(domain?.hostname!==HOST||domain.service!==WORKER||domain.zone_id!==zone.id||
    !/^[A-Za-z0-9_-]{1,128}$/.test(domain.id||''))throw Error('Preview hostname belongs to another service; refusing to replace it.');
  return domain;
}
export async function recoverablePreviewDomain({request,zone}={}) {
  // The current Wrangler control plane can retain a domain record that is not
  // in the older active-domain inventory. A changeset is a read-only dry run.
  // DNS alone (including a placeholder AAAA record) is never ownership proof.
  const worker=`/accounts/${zone.account.id}/workers/scripts/${WORKER}`;
  const result=await request(worker+'/domains/changeset?replace_state=false',{method:'POST',
    body:[{hostname:HOST,zone_id:zone.id}]});
  const changes=result?.result;
  if(!changes||!['added','removed','updated','conflicting'].every(k=>Array.isArray(changes[k])))
    throw Error('Cannot verify the preview domain changeset.');
  const matches=[...changes.added,...changes.updated,...changes.conflicting].filter(d=>d.hostname===HOST&&d.service===WORKER&&d.id);
  if(matches.length!==1)return null;
  const domain=ownedDomain(matches[0],zone);
  const verified=await request(`/accounts/${zone.account.id}/workers/domains/records/${encodeURIComponent(domain.id)}`,
    {allow404:true});
  return verified?ownedDomain(verified.result,zone):null;
}
export function recoveryRecordMatches(records,receipt,now=Date.now()) {
  if(!receipt||receipt.hostname!==HOST||receipt.worker!==WORKER||receipt.type!=='AAAA'||receipt.content!=='100::'||
    receipt.proxied!==true||!/^[a-f0-9]{32}$/.test(receipt.record_id||'')||
    !/^[a-f0-9]{40}$/.test(receipt.source_revision||'')||!/^br-[a-z0-9-]+$/.test(receipt.source_branch||'')||
    ['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b'].includes(receipt.source_branch)||
    !Number.isFinite(Date.parse(receipt.not_after))||now>Date.parse(receipt.not_after)||
    !Number.isFinite(Date.parse(receipt.created_on))||Date.parse(receipt.not_after)<=Date.parse(receipt.created_on)||
    Date.parse(receipt.not_after)-Date.parse(receipt.created_on)>86400000||
    !Array.isArray(records)||records.length!==1)return false;
  const r=records[0];
  return r.id===receipt.record_id&&r.name===HOST&&r.type===receipt.type&&r.content===receipt.content&&
    r.proxied===true&&r.created_on===receipt.created_on&&r.modified_on===receipt.modified_on;
}
export async function reviewedPreviewRecovery({request,zone,records,settings,receipt,now=Date.now()}={}) {
  if(!recoveryRecordMatches(records,receipt,now))return null;
  const bindings=settings?.result?.bindings;
  const binding=name=>bindings?.find(b=>b.name===name&&b.type==='plain_text')?.text;
  const original=binding('RELEASE_COMMIT')===receipt.source_revision&&binding('NEON_BRANCH_ID')===receipt.source_branch;
  const resumed=binding('PREVIEW_DNS_RECOVERY_ID')===receipt.record_id&&
    binding('PREVIEW_DNS_RECOVERY_SOURCE_REVISION')===receipt.source_revision&&
    /^[a-f0-9]{40}$/.test(binding('RELEASE_COMMIT')||'')&&/^br-[a-z0-9-]+$/.test(binding('NEON_BRANCH_ID')||'')&&
    !['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b'].includes(binding('NEON_BRANCH_ID'));
  if(binding('MODE')!=='preview'||(!original&&!resumed))return null;
  await verifyRecoveryConflict({request,zone,receipt});
  return receipt;
}
export async function verifyRecoveryConflict({request,zone,receipt}) {
  const changes=(await request(`/accounts/${zone.account.id}/workers/scripts/${WORKER}/domains/changeset?replace_state=false`,
    {method:'POST',body:[{hostname:HOST,zone_id:zone.id}]}))?.result;
  console.log(JSON.stringify({event:'preview_dns_recovery_changeset',counts:Object.fromEntries(
    ['added','removed','updated','conflicting'].map(k=>[k,Array.isArray(changes?.[k])?changes[k].length:null]))}));
  if(!changes||!Array.isArray(changes.conflicting)||
    !Array.isArray(changes.updated)||changes.updated.some(d=>d.hostname===HOST&&d.service&&d.service!==WORKER)||
    !Array.isArray(changes.removed)||changes.removed.length)
    throw Error('Preview DNS recovery does not match the reviewed conflict; refusing to replace it.');
  // A provider-managed orphan may already be reusable without an external DNS
  // conflict. In that case keep DNS override disabled; receipt acceptance is
  // not permission to force replacement.
  if(!changes.conflicting.length)return false;
  if(changes.conflicting.length===1&&changes.conflicting[0].hostname===HOST&&
    changes.conflicting[0].external_dns_record_id===receipt.record_id&&
    (!changes.conflicting[0].service||changes.conflicting[0].service===WORKER))return true;
  console.log(JSON.stringify({event:'preview_recovery_conflict_mismatch',conflicts:changes.conflicting.length,
    matching_hostname:changes.conflicting.filter(d=>d.hostname===HOST).map(d=>({
      dns_id:/^[a-f0-9]{32}$/.test(d.external_dns_record_id||'')?d.external_dns_record_id:null,
      foreign_service:Boolean(d.service&&d.service!==WORKER),
    }))}));
  throw Error('Preview DNS recovery does not match the reviewed conflict; refusing to replace it.');
}
async function previewDns(zone) {
  const dns=await cf(`/zones/${zone.id}/dns_records?name=${HOST}&per_page=100`);
  if(!Array.isArray(dns.result)||(dns.result_info?.total_pages||1)>1)throw Error('Cannot verify the full preview DNS inventory.');
  return dns.result;
}
function recoveryReceipt() {
  const file='.github/preview-dns-recovery.json';
  return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
}
export async function attachPreviewDomain({request,readContext,revalidateRecovery,
  sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  for(let attempt=0;attempt<4;attempt++) {
    const {zone,domain}=await readContext();
    const overrideDns=!domain&&revalidateRecovery?await revalidateRecovery(zone):false;
    try {
      // Same fixed origin set on every attempt; do not override somebody else's
      // origin. DNS replacement is permitted only for the single reviewed
      // failed-operation record, revalidated immediately before this write.
      await request(`/accounts/${zone.account.id}/workers/scripts/${WORKER}/domains/records`,{method:'PUT',
        body:{override_scope:false,override_existing_origin:false,override_existing_dns_record:overrideDns,
          origins:[{hostname:HOST,zone_id:zone.id}]}});
      const current=await readContext();
      if(!current.domain)throw Error('Preview hostname attachment was not present after installation.');
      return;
    } catch(error) {
      if(error.status&&!transientControlStatus(error.status))throw error;
      // A 500/timeout can still have installed the origin. Reconcile first;
      // ownership mismatches throw before any further write is attempted.
      const current=await readContext();
      if(current.domain)return;
      if(attempt===3)throw error;
      await sleep(1000*2**attempt);
    }
  }
}
export async function detachPreviewDomain({request,readContext,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const initial=await readContext();
  if(!initial.domain)return;
  const domain=ownedDomain(initial.domain,initial.zone);
  for(let attempt=0;attempt<4;attempt++) {
    try {
      await request(`/accounts/${initial.zone.account.id}/workers/domains/${encodeURIComponent(domain.id)}`,
        {method:'DELETE',allow404:true});
    } catch(error) {
      if(error.status&&!transientControlStatus(error.status))throw error;
      const remaining=await readContext();
      if(!remaining.domain)return;
      if(remaining.domain.id!==domain.id)throw Error('Preview hostname attachment changed during cleanup; refusing to delete it.');
      if(attempt===3)throw error;
    }
    const remaining=await readContext();
    if(!remaining.domain)return;
    if(remaining.domain.id!==domain.id)throw Error('Preview hostname attachment changed during cleanup; refusing to delete it.');
    if(attempt===3)throw Error('Preview hostname remains attached after deletion.');
    await sleep(1000*2**attempt);
  }
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
  return {zone,domain:matches[0]?ownedDomain(matches[0],zone):null};
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
    const records=await previewDns(zone);
    const settings=await cf(`/accounts/${zone.account.id}/workers/scripts/${WORKER}/settings`,{allow404:true});
    if(settings&&!settings.result.bindings?.some(b=>b.name==='MODE'&&b.type==='plain_text'&&b.text==='preview'))throw Error('Existing Worker is not marked as our preview; refusing to overwrite it.');
    if(!domain&&records.length) {
      const recovered=settings?await recoverablePreviewDomain({request:cf,zone}):null;
      const reviewed=recovered?null:await reviewedPreviewRecovery({request:cf,zone,records,settings,receipt:recoveryReceipt()});
      if(!recovered&&!reviewed) {
        const binding=name=>settings?.result?.bindings?.find(b=>b.name===name&&b.type==='plain_text')?.text;
        console.log(JSON.stringify({event:'preview_dns_ownership_unproven',
          worker_revision:/^[a-f0-9]{40}$/.test(binding('RELEASE_COMMIT')||'')?binding('RELEASE_COMMIT'):null,
          worker_branch:/^br-[a-z0-9-]+$/.test(binding('NEON_BRANCH_ID')||'')?binding('NEON_BRANCH_ID'):null,
          records:records.map(r=>({
          id:/^[a-f0-9]{32}$/.test(r.id||'')?r.id:null,type:r.type,proxied:r.proxied,
          created_on:r.created_on,modified_on:r.modified_on,
          placeholder:(r.type==='AAAA'&&r.content==='100::')||(r.type==='A'&&r.content==='192.0.2.0'),
        }))}));
        throw Error('Preview DNS already exists without our Worker mapping; refusing to replace it.');
      }
      console.log(recovered?'Preview domain ownership verified through the current Worker domain record.':
        'Preview DNS matches the reviewed failed-operation recovery receipt; no preflight write was performed.');
    }
    variable('CLOUDFLARE_ACCOUNT_ID',zone.account.id);
    console.log('Scoped Cloudflare access and preview hostname ownership verified.');return;
  }
  if(action==='disable') {
    const enforce=process.env.PACK1_ENFORCE_PREVIEW_OWNER==='1';
    const owner={runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,branch:process.env.PREVIEW_BRANCH,sha:process.env.GITHUB_SHA};
    const verifyOwner=async()=>assertPreviewOwner(await cf(`/accounts/${zone.account.id}/workers/scripts/${WORKER}/settings`),owner);
    let records=[];
    if(enforce&&domain) {
      await verifyOwner();records=await previewDns(zone);
      writeResourceReceipt(resourceReceipt({...owner,expires:process.env.CI_RESOURCE_EXPIRES,phase:'cleanup-started',domainId:domain.id,records}));
    }
    await detachPreviewDomain({request:cf,readContext:context});
    const remaining=await context();if(remaining.domain)throw Error('Preview hostname remains attached after deletion.');
    if(enforce&&domain) {
      await cleanupOwnedDns({records,readRecords:()=>previewDns(zone),assertOwner:verifyOwner,
        remove:id=>cf(`/zones/${zone.id}/dns_records/${id}`,{method:'DELETE',allow404:true})});
      writeResourceReceipt(resourceReceipt({...owner,expires:process.env.CI_RESOURCE_EXPIRES,phase:'preview-removed'}));
    }
    console.log('Preview custom domain disabled. Backend guards remain enabled; the isolated branch expires automatically.');return;
  }
  if(action!=='deploy')throw Error('Unknown preview operation.');
  const branch=process.env.PREVIEW_BRANCH,commit=process.env.GITHUB_SHA;
  checkBranch(branch);
  if(process.env.PREVIEW_CREATED!=='true'||!/^[a-f0-9]{40}$/.test(commit||''))throw Error('Require a newly created isolated branch and exact release revision.');
  // Establish recovery ownership before overwriting this Worker's revision
  // bindings. Re-check the exact DNS fingerprint and provider conflict after
  // the fresh protected origins are installed, immediately before attachment.
  let recovery=null;
  if(!domain) {
    const records=await previewDns(zone);
    if(records.length) {
      const settings=await cf(`/accounts/${zone.account.id}/workers/scripts/${WORKER}/settings`,{allow404:true});
      const recovered=settings?await recoverablePreviewDomain({request:cf,zone}):null;
      if(!recovered) {
        recovery=await reviewedPreviewRecovery({request:cf,zone,records,settings,receipt:recoveryReceipt()});
        if(!recovery)throw Error('Preview DNS already exists without our Worker mapping; refusing to replace it.');
      }
    }
  }
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
    await deployPreviewFunction({branch,slug,directory:path.join(process.env.RUNNER_TEMP,'pack1-bundles',slug),environment:{PACK1_REQUIRE_INGRESS:'1',PACK1_INGRESS_SECRET:origin,...(slug==='draftrunapi'?{PACK1_CAPACITY_DIAGNOSTICS:'1'}:{})},apiKey:process.env.NEON_API_KEY});
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
  config.vars={...config.vars,NEON_BRANCH_ID:branch,RELEASE_COMMIT:commit,
    CI_PREVIEW_RUN:process.env.GITHUB_RUN_ID,CI_PREVIEW_ATTEMPT:process.env.GITHUB_RUN_ATTEMPT,CI_PREVIEW_EXPIRES:process.env.CI_RESOURCE_EXPIRES};
  if(recovery)config.vars={...config.vars,PREVIEW_DNS_RECOVERY_ID:recovery.record_id,
    PREVIEW_DNS_RECOVERY_SOURCE_REVISION:recovery.source_revision};
  const configPath=path.join(process.env.RUNNER_TEMP,'edge-wrangler.json');
  fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
  run('wrangler',['deploy','--config',configPath]);
  run('wrangler',['secret','bulk','--config',configPath],JSON.stringify({ORIGIN_SECRET:origin,PREVIEW_KEY:preview,QUOTA_KEY:quota}));
  await attachPreviewDomain({request:cf,readContext:context,revalidateRecovery:recovery?async zone=>{
    if(!recoveryRecordMatches(await previewDns(zone),recovery))throw Error('Preview DNS changed after recovery validation; refusing to replace it.');
    return await verifyRecoveryConflict({request:cf,zone,receipt:recovery});
  }:undefined});
  const installedDomain=(await context()).domain;
  writeResourceReceipt(resourceReceipt({branch,sha:commit,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,
    expires:process.env.CI_RESOURCE_EXPIRES,phase:'attached',domainId:installedDomain.id,records:await previewDns(zone)}));
  // A newly attached hostname or Worker version can lag the control-plane
  // response. Require sustained exact-revision health from fresh TLS
  // connections so one warm edge connection cannot declare propagation done.
  const readiness=await waitForPreviewReadiness({commit,probe:()=>freshPreviewHealth({preview})});
  if(!readiness.ready)throw Error('Preview hostname did not serve the reviewed revision consistently before the readiness deadline.');
  console.log(`Preview hostname stable after ${readiness.consecutive} consecutive fresh-connection revision checks.`);
  variable('PREVIEW_ACCESS_KEY',preview);variable('PREVIEW_ORIGIN_SECRET',origin);
  console.log('Private preview deployed. Live acceptance must still pass.');
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)main(process.argv[2]).catch(error=>{
  // Unexpected failures may carry request data. Only our fixed messages leave
  // this control process; never print a provider response or process arguments.
  const message=String(error.message||'');
  console.error(/^(Add repository|Invalid preview|An isolated|Cloudflare control|Cloudflare rejected|Neon control|Expected the|Invalid Cloudflare|Cannot verify|Preview hostname|Preview DNS|Existing Worker|Unexpected custom|Unknown preview|Require a newly|Unexpected inherited|Origin did|Origin revision|Origin closure|neon failed|wrangler failed)/.test(message)?message:'Preview operation failed; inspect the sanitized step status.');
  console.error(JSON.stringify({error_class:error.name||'Error',line:String(error.stack).match(/edge-control.mjs:(\d+)/)?.[1]||null}));
  process.exitCode=1;
});
