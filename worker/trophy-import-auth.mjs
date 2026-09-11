import {createPublicKey,verify} from 'node:crypto';
const ISSUER='https://token.actions.githubusercontent.com';
export const IMPORT_AUDIENCE='pack-one-trophy-import';
const REPO='killjoy00/mtg-ev-analyzer';
const WORKFLOW=`${REPO}/.github/workflows/import-all-trophies.yml@refs/heads/main`;
const SUBJECTS=new Set([`repo:${REPO}:ref:refs/heads/main`,'repo:killjoy00@211694413/mtg-ev-analyzer@1201587098:ref:refs/heads/main']);
let cache=null;
async function keys() {
  if(cache&&Date.now()-cache.at<300000)return cache.keys;
  const r=await fetch(`${ISSUER}/.well-known/jwks`,{signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('OIDC keys unavailable');const data=await r.json();
  cache={at:Date.now(),keys:data.keys};return data.keys;
}
export async function verifyImportToken(token,getKeys=keys,now=Math.floor(Date.now()/1000)) {
  const denied=()=>{throw Object.assign(Error('Import identity denied'),{status:403});};
  if(typeof token!=='string'||token.length>16000)denied();
  const parts=token.split('.');if(parts.length!==3)denied();
  let h,c;try{h=JSON.parse(Buffer.from(parts[0],'base64url'));c=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{denied();}
  if(h.alg!=='RS256'||h.typ!=='JWT'||typeof h.kid!=='string')denied();
  const key=(await getKeys()).find(k=>k.kid===h.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig'));
  if(!key||!verify('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),createPublicKey({key,format:'jwk'}),Buffer.from(parts[2],'base64url')))denied();
  if(c.iss!==ISSUER||c.aud!==IMPORT_AUDIENCE||!SUBJECTS.has(c.sub)||c.repository!==REPO||c.repository_id!=='1201587098'||c.repository_owner_id!=='211694413'||c.ref!=='refs/heads/main'||c.workflow_ref!==WORKFLOW||c.job_workflow_ref||!['push','workflow_dispatch'].includes(c.event_name)||!Number.isFinite(c.exp)||!Number.isFinite(c.nbf)||!Number.isFinite(c.iat)||c.exp<=now||c.nbf>now+30||c.iat>now+30||c.exp-c.iat>900)denied();
  return {run_id:c.run_id,sha:c.sha};
}
