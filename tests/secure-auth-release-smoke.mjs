// Secure-account release acceptance intentionally avoids Draft Run corpus/gameplay.
// It proves the exact reviewed revision is live on all three shared runtimes,
// then exercises only non-destructive account-deletion controls.
import assert from 'node:assert/strict';

const [branch,commit]=process.argv.slice(2);
if(!/^br-[a-z0-9-]+$/.test(branch||'')||!/^[a-f0-9]{40}$/.test(commit||'')) {
  throw Error('Usage: secure-auth-release-smoke.mjs BRANCH_ID FULL_COMMIT_SHA [--settle]');
}
const settle=process.argv.includes('--settle');
const settleMs=settle?10*60*1000:0;
const pollMs=10*1000;

async function request(slug,path,{method='GET',body,headers={},status=200}={}) {
  const response=await fetch(`https://${branch}-${slug}.compute.c-5.us-east-2.aws.neon.tech${path}`,{
    method,
    headers:{accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'}),...headers},
    body:body===undefined?undefined:JSON.stringify(body),
    redirect:'error',
    signal:AbortSignal.timeout(30000),
  });
  const data=await response.json().catch(()=>({}));
  assert.equal(response.status,status,`${slug}${path}: ${JSON.stringify(data)}`);
  return data;
}

async function marker(slug) {
  const data=await request(slug,'/health?quick=1');
  assert.equal(data.ok,true,`${slug} quick health`);
  return data.release_commit;
}

async function waitForRevision() {
  for(const slug of ['draftrunapi','pack1growth','pack1api']) {
    const deadline=Date.now()+settleMs;
    for(;;) {
      const seen=await marker(slug);
      if(seen===commit)break;
      if(!settle||Date.now()>=deadline)assert.equal(seen,commit,`${slug} revision`);
      await new Promise(resolve=>setTimeout(resolve,pollMs));
    }
  }
}

await waitForRevision();

async function waitForGrowthHealth() {
  const deadline=Date.now()+settleMs;
  for(;;) {
    const growth=await request('pack1growth','/health');
    assert.equal(growth.ok,true);
    if(growth.release_commit===commit)return growth;
    if(!settle||Date.now()>=deadline)assert.equal(growth.release_commit,commit,'pack1growth full health revision');
    await new Promise(resolve=>setTimeout(resolve,pollMs));
  }
}

const growth=await waitForGrowthHealth();
assert.equal(growth.account_deletion_enabled,true,'account deletion kill switch must be enabled');
assert.equal(growth.verification_sweep_enabled,true,'verification sweep kill switch must be enabled');

// Non-destructive route proof: the endpoint must be mounted, accept only the
// trusted first-party origin, and reject a request without the secure account
// cookie before any deletion state can be created.
const unauthDelete=await request('pack1growth','/v1/account/delete',{
  method:'POST',
  headers:{origin:'https://packone.pro'},
  body:{confirm:true,currentPassword:'release-smoke-invalid'},
  status:401,
});
assert.match(String(unauthDelete.error||''),/Account session required/i);

// Maintenance is deliberately not on the public gateway. A forged bearer must
// not authorize the direct internal endpoint.
const maintenance=await fetch(`https://${branch}-pack1growth.compute.c-5.us-east-2.aws.neon.tech/internal/account-deletion-maintenance`,{
  method:'POST',
  headers:{authorization:'Bearer forged'},
  redirect:'error',
  signal:AbortSignal.timeout(30000),
});
assert.ok([401,403].includes(maintenance.status),`maintenance forged bearer unexpectedly returned ${maintenance.status}`);

if(settle) {
  const deadline=Date.now()+settleMs;
  const stableWindow=30*1000;
  let stableSince=0;
  while(Date.now()<deadline) {
    let all=true;
    for(const slug of ['draftrunapi','pack1growth','pack1api']) {
      if(await marker(slug)!==commit)all=false;
    }
    if(all) {
      if(!stableSince)stableSince=Date.now();
      if(Date.now()-stableSince>=stableWindow)break;
    } else {
      stableSince=0;
    }
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
  assert.ok(stableSince&&Date.now()-stableSince>=stableWindow,'release markers did not stabilize on the reviewed revision');
}
for(const slug of ['draftrunapi','pack1growth','pack1api'])assert.equal(await marker(slug),commit,`${slug} closing revision`);

console.log(JSON.stringify({branch,commit,account_deletion_enabled:true,verification_sweep_enabled:true,unauthenticated_delete_rejected:true,maintenance_forged_bearer_rejected:true}));
