import assert from 'node:assert/strict';
import {checkBranch} from '../scripts/edge-control.mjs';
const branch=process.env.PREVIEW_BRANCH,commit=process.env.GITHUB_SHA;
checkBranch(branch);
const preview=process.env.PREVIEW_ACCESS_KEY,origin=process.env.PREVIEW_ORIGIN_SECRET;
assert.match(preview||'',/^[a-f0-9]{64}$/);assert.match(origin||'',/^[a-f0-9]{64}$/);
const base='https://api-preview.packone.pro';
async function call(service,path,body,token) {
  const r=await fetch(`${base}/${service}${path}`,{method:body===undefined?'GET':'POST',redirect:'error',headers:{'x-pack1-preview-key':preview,'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
  assert.equal(r.status,200,`${service}${path}: status ${r.status}`);
  assert.equal(r.headers.get('cache-control'),'no-store');return r.json();
}
// New custom domains can take time to obtain TLS. Wait for at most three
// minutes, without retrying any write or printing credential-bearing errors.
let ready=false;
for(let attempt=0;attempt<18;attempt++) {
  try {const r=await fetch(base+'/growth/health?quick=1',{headers:{'x-pack1-preview-key':preview},redirect:'error',signal:AbortSignal.timeout(10000)});if(r.status===200){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,10000));
}
assert.ok(ready,'Preview TLS/readiness did not become available.');
const verify=async()=>{
  for(const [service,slug] of [['legacy','pack1api'],['growth','pack1growth'],['draft','draftrunapi']]) {
    assert.equal((await call(service,'/health?quick=1')).release_commit,commit);
    for(const headers of [{},{'x-pack1-ingress-secret':'forged','cf-connecting-ip':'127.0.0.1','x-forwarded-for':'127.0.0.1'}]) {
      const r=await fetch(`https://${branch}-${slug}.compute.c-5.us-east-2.aws.neon.tech/health?quick=1`,{headers,redirect:'error',signal:AbortSignal.timeout(30000)});
      assert.equal(r.status,403,'Direct origin bypass must fail.');
    }
  }
};
await verify();
const publicAttempt=await fetch(base+'/growth/health?quick=1',{redirect:'error'});assert.equal(publicAttempt.status,403);
const h=await fetch(`https://${branch}-draftrunapi.compute.c-5.us-east-2.aws.neon.tech/health`,{headers:{'x-pack1-ingress-secret':origin},redirect:'error',signal:AbortSignal.timeout(120000)});
assert.equal(h.status,200);const health=await h.json();assert.equal(health.unrated_puzzles,0);assert.deepEqual(health.missing_sets,[]);
const guest=await call('growth','/v1/session',{displayName:'QA gateway '+commit.slice(0,7)});
for(const environment of ['mixed','powered-cube']) {
  let run=await call('draft','/v1/runs',{environment,qa:true},guest.token);
  assert.equal(run.day,null);assert.equal(run.run_length,8);
  run=await call('draft',`/v1/runs/${run.id}/reroll`,{revision:run.revision,round:0,puzzleId:run.current.puzzle_id,type:'pack'},guest.token);
  for(let round=0;round<8;round++) {
    const pick={revision:run.revision,round,puzzleId:run.current.puzzle_id,cardId:run.current.candidates[0].id};
    run=await call('draft',`/v1/runs/${run.id}/pick`,pick,guest.token);
    assert.equal(run.complete,round===7);
    if(round===7)assert.equal((await call('draft',`/v1/runs/${run.id}/pick`,pick,guest.token)).score,run.score);
  }
  assert.equal(run.score,Math.round(run.answers.reduce((sum,a)=>sum+a.score,0)/8));
  const shared=await call('draft',`/v1/runs/${run.id}/share`,{},guest.token);
  const friend=await call('draft','/v1/runs',{challenge:shared.id,qa:true},guest.token);
  assert.equal(friend.current.puzzle_id,run.answers[0].puzzle.puzzle_id);
}
await verify();
// Invalid bodies consume the edge creation budget without creating accounts.
// Changing client-supplied forwarding headers must not grant extra capacity.
const limited=await Promise.all(Array.from({length:12},async(_,i)=>{
  const r=await fetch(base+'/growth/v1/session',{method:'POST',headers:{'x-pack1-preview-key':preview,'content-type':'application/json','x-forwarded-for':`192.0.2.${i+1}`},body:'null',redirect:'error'});
  assert.ok([400,429].includes(r.status));if(r.status===429)assert.ok(Number(r.headers.get('retry-after'))>0);return r.status;
}));
assert.ok(limited.filter(s=>s===400).length<=9,'Spoofed headers bypassed the creation quota.');
assert.ok(limited.includes(429));
console.log(JSON.stringify({status:'passed',commit,branch,preview:base,checks:['direct origin denied','private preview','mixed and Cube eight-pick practice','reroll, retry, share and scoring','durable network creation quota']},null,2));
