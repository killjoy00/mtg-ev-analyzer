import {randomBytes} from 'node:crypto';

const AUTH_BASE='https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth';
const WORKER='pack1-auth-webhook-probe-temp';

async function cf(route) {
  const response=await fetch('https://api.cloudflare.com/client/v4'+route,{
    headers:{authorization:`Bearer ${process.env.CLOUDFLARE_EDGE_TOKEN}`},
    redirect:'error',
    signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)throw Error(`Cloudflare control HTTP ${response.status}.`);
  const body=await response.json();
  if(!body.success)throw Error('Cloudflare rejected probe execution setup.');
  return body.result;
}
async function authPost(pathname,body) {
  const response=await fetch(AUTH_BASE+pathname,{
    method:'POST',
    redirect:'manual',
    headers:{origin:'http://localhost:4173','content-type':'application/json'},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(20000),
  });
  const text=await response.text();
  let json=null;
  try {json=text?JSON.parse(text):null;} catch {}
  return {status:response.status,json};
}
async function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

async function main() {
  if(!process.env.CLOUDFLARE_EDGE_TOKEN)throw Error('Cloudflare operations credential is missing.');
  const zones=await cf('/zones?name=packone.pro&per_page=50');
  if(!Array.isArray(zones)||zones.length!==1||zones[0].status!=='active')throw Error('Expected the active Pack One Cloudflare zone.');
  const accountId=zones[0].account?.id;
  const accountSubdomain=(await cf(`/accounts/${accountId}/workers/subdomain`))?.subdomain;
  if(!/^[a-z0-9-]+$/.test(accountSubdomain||''))throw Error('Workers.dev subdomain is unavailable.');

  const workerUrl=`https://${WORKER}.${accountSubdomain}.workers.dev`;
  const health=await fetch(workerUrl+'/health',{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!health.ok)throw Error('Temporary Auth probe Worker is not staged.');

  const cleared=await fetch(workerUrl+'/evidence',{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(cleared.status!==204)throw Error('Temporary Auth probe evidence could not be cleared.');

  const password='P1-'+randomBytes(24).toString('base64url')+'!';
  console.log('::add-mask::'+password);
  const runId=String(process.env.GITHUB_RUN_ID||Date.now());
  const attempt=String(process.env.GITHUB_RUN_ATTEMPT||'1');
  const email=`pack1-auth-probe-${runId}-${attempt}@planitnow.us`;

  const signup=await authPost('/sign-up/email',{name:'Pack One Auth Probe',email,password});
  if(signup.status<200||signup.status>=300)throw Error(`QA Auth probe signup failed with HTTP ${signup.status}.`);
  const authUserId=signup.json?.user?.id||signup.json?.id||null;
  console.log('AUTH_PROBE_SIGNUP_STATUS '+signup.status);
  console.log('AUTH_PROBE_EMAIL '+email);
  console.log('AUTH_PROBE_USER_ID '+(authUserId||'unknown'));

  const resetStarted=new Date().toISOString();
  console.log('AUTH_PROBE_RESET_STARTED '+resetStarted);
  const reset=await authPost('/request-password-reset',{email,redirectTo:'http://localhost:4173/reset-password/'});
  console.log('AUTH_PROBE_RESET_STATUS '+reset.status);
  if(reset.status<200||reset.status>=300)throw Error(`QA password reset request failed with HTTP ${reset.status}.`);

  let evidence=null;
  for(let i=0;i<20;i++) {
    const response=await fetch(workerUrl+'/evidence',{redirect:'error',signal:AbortSignal.timeout(10000)});
    if(response.ok){evidence=await response.json();break;}
    await sleep(750);
  }
  if(!evidence)throw Error('No signed Auth webhook evidence was captured.');
  console.log('AUTH_PROBE_EVIDENCE '+JSON.stringify(evidence));
  if(!evidence?.verification?.verified)throw Error('Managed Neon webhook signature did not verify against the documented reconstruction.');
  if(!evidence.token_present)throw Error('Managed Neon recovery webhook did not expose a raw token.');
}
main().catch(error=>{
  const message=String(error?.message||'');
  console.error(/^(Cloudflare control|Cloudflare rejected|Expected the active|Workers\.dev|Temporary Auth probe|QA Auth probe signup|QA password reset|No signed Auth webhook|Managed Neon)/.test(message)?message:'Auth webhook capability execution failed; inspect sanitized step status.');
  process.exitCode=1;
});
