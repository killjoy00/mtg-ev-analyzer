import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {controlRequest,transientControlStatus} from './control-read.mjs';
import {resourceReceipt,writeResourceReceipt} from './preview-resource-ownership.mjs';

const PROJECT='patient-shadow-91417882',BASE=`https://console.neon.tech/api/v2/projects/${PROJECT}`;
const PARENTS=['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b'];
export async function createCiBranch({prefix,parent,expires,suspend=300,token,
  nonce=randomBytes(16).toString('hex'),now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),
  fetcher=fetch,output=()=>{}}={}) {
  if(!/^(?:ci-pr-[0-9]+-[0-9]+-[0-9]+-[a-z_]+|launch-load-[0-9]+-[0-9]+|gateway-preview-[0-9]+-[0-9]+)$/.test(prefix||'')||
    !PARENTS.includes(parent)||!token||!Number.isInteger(suspend)||suspend<0||suspend>300||
    !/^[a-f0-9]{32}$/.test(nonce)||!Number.isFinite(Date.parse(expires))||
    Date.parse(expires)<=now()+60000||Date.parse(expires)>now()+25*3600000)
    throw Error('Neon control requires a fixed CI branch prefix, explicit parent and bounded expiry.');
  // A random per-invocation name permits reconciliation after an unknown POST
  // outcome without adopting another job's branch or issuing a second POST.
  const name=`${prefix}-${nonce}`;
  const request=(route,options={})=>controlRequest(BASE+route,{provider:'Neon',token,fetcher,sleep,...options});
  const inventory=async()=>{
    const result=await request(`/branches?search=${encodeURIComponent(name)}&limit=100`);
    if(!Array.isArray(result?.branches)||result.pagination?.next)throw Error('Neon control cannot verify the branch inventory.');
    const found=result.branches.filter(b=>b.name===name);
    if(found.length>1)throw Error('Neon control found ambiguous CI branch ownership.');
    return found[0];
  };
  if(await inventory())throw Error('Neon control refuses to reuse an existing CI branch.');
  let branch;
  try {
    branch=(await request('/branches',{method:'POST',body:{branch:{name,parent_id:parent,expires_at:expires},
      endpoints:[{type:'read_write',suspend_timeout_seconds:suspend}]}}))?.branch;
  } catch(error) {
    if(error.status&&!transientControlStatus(error.status))throw error;
    for(let attempt=0;attempt<4;attempt++) {
      branch=await inventory();if(branch)break;
      if(attempt<3)await sleep(1000*2**attempt);
    }
    if(!branch)throw Error('Neon control branch creation outcome is unknown; no second create was sent.');
  }
  if(!branch||!/^br-[a-z0-9-]+$/.test(branch.id||'')||PARENTS.includes(branch.id)||
    branch.name!==name||branch.parent_id!==parent||Date.parse(branch.expires_at)!==Date.parse(expires))
    throw Error('Neon control returned a branch without the requested isolation and expiry.');
  // Publish cleanup ownership before obtaining credentials. A later read
  // failure must not hide the branch from the workflow's always() cleanup.
  output('branch_id',branch.id);output('created','true');
  const result=await request(`/connection_uri?branch_id=${encodeURIComponent(branch.id)}&database_name=pack1&role_name=pack1_owner&pooled=false`);
  let url;try {url=new URL(result?.uri);} catch {throw Error('Neon control returned an invalid connection URI.');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname.endsWith('.neon.tech')||
    url.username!=='pack1_owner'||url.pathname!=='/pack1'||!url.password)
    throw Error('Neon control returned an invalid connection URI.');
  url.searchParams.set('sslmode','require');
  output('db_url',url.toString());
  return {branch_id:branch.id,created:'true'};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  let createdBranch;
  createCiBranch({prefix:process.env.CI_BRANCH_PREFIX,parent:process.env.CI_BRANCH_PARENT,
    expires:process.env.CI_BRANCH_EXPIRES,suspend:Number(process.env.CI_BRANCH_SUSPEND||300),token:process.env.NEON_API_KEY,
    output:(name,value)=>{
      if(name==='branch_id')createdBranch=value;
      if(name==='db_url') {
        const mask=value=>console.log('::add-mask::'+value.replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A'));
        mask(decodeURIComponent(new URL(value).password));mask(value);
      }
      fs.appendFileSync(process.env.GITHUB_OUTPUT,`${name}=${value}\n`);
      if(name==='created') {
        fs.appendFileSync(process.env.GITHUB_ENV,`CI_RESOURCE_EXPIRES=${process.env.CI_BRANCH_EXPIRES}\n`);
        writeResourceReceipt(resourceReceipt({branch:createdBranch,sha:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,expires:process.env.CI_BRANCH_EXPIRES,phase:'branch-created'}));
      }
    }}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
