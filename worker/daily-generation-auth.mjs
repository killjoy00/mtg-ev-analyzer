import {createPublicKey,verify} from 'node:crypto';

const ISSUER='https://token.actions.githubusercontent.com';
const REPO='killjoy00/mtg-ev-analyzer';
const REPOSITORY_ID='1201587098';
const OWNER_ID='211694413';
export const DAILY_GENERATION_AUDIENCE='pack-one-daily-generation';
export const DAILY_GENERATION_WORKFLOW=`${REPO}/.github/workflows/daily-generation.yml@refs/heads/main`;
const SUBJECTS=new Set([
  `repo:${REPO}:ref:refs/heads/main`,
  'repo:killjoy00@211694413/mtg-ev-analyzer@1201587098:ref:refs/heads/main',
]);
let cache=null;

async function keys() {
  if(cache&&Date.now()-cache.at<300000)return cache.keys;
  const r=await fetch(`${ISSUER}/.well-known/jwks`,{signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('OIDC keys unavailable');
  const data=await r.json();
  cache={at:Date.now(),keys:data.keys};
  return data.keys;
}

const denied=()=>{throw Object.assign(Error('Daily generation identity denied'),{status:403});};

export async function verifyDailyGenerationToken(token,getKeys=keys,now=Math.floor(Date.now()/1000)) {
  if(typeof token!=='string'||token.length>16000)denied();
  const parts=token.split('.');
  if(parts.length!==3)denied();
  let h,c;
  try {
    h=JSON.parse(Buffer.from(parts[0],'base64url'));
    c=JSON.parse(Buffer.from(parts[1],'base64url'));
  } catch {denied();}
  if(h.alg!=='RS256'||h.typ!=='JWT'||typeof h.kid!=='string')denied();
  const key=(await getKeys()).find(k=>k.kid===h.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig'));
  if(!key||!verify('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')))denied();
  const checks={
    issuer:c.iss===ISSUER,
    audience:c.aud===DAILY_GENERATION_AUDIENCE,
    subject:SUBJECTS.has(c.sub),
    repository:c.repository===REPO,
    repositoryId:c.repository_id===REPOSITORY_ID,
    ownerId:c.repository_owner_id===OWNER_ID,
    branch:c.ref==='refs/heads/main',
    workflow:c.workflow_ref===DAILY_GENERATION_WORKFLOW,
    reusableWorkflow:!c.job_workflow_ref||c.job_workflow_ref===DAILY_GENERATION_WORKFLOW,
    event:['schedule','workflow_dispatch'].includes(c.event_name),
    time:Number.isFinite(c.exp)&&Number.isFinite(c.nbf)&&Number.isFinite(c.iat)&&c.exp>now&&c.nbf<=now+30&&c.iat<=now+30&&c.exp-c.iat<=900,
  };
  const rejected=Object.keys(checks).filter(k=>!checks[k]);
  if(rejected.length){console.warn('Daily generation identity rejected',rejected.join(','));denied();}
  return {run_id:c.run_id,sha:c.sha,workflow_ref:c.workflow_ref};
}
