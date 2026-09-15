// HTTP acceptance using private QA guests and practice only. No ranked writes.
import assert from 'node:assert/strict';
const [branch,commit]=process.argv.slice(2);
if(!/^br-[a-z0-9-]+$/.test(branch||'')||!/^[a-f0-9]{40}$/.test(commit||''))throw Error('Usage: release-functions-smoke.mjs BRANCH_ID FULL_COMMIT_SHA [--practice]');
const timings=[];
async function call(slug,path,body,token,status=200) {
  const start=performance.now();
  const r=await fetch(`https://${branch}-${slug}.compute.c-5.us-east-2.aws.neon.tech${path}`,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
  const data=await r.json();assert.equal(r.status,status,`${slug}${path}: ${JSON.stringify(data)}`);
  timings.push({service:slug,path:path.replace(/[a-f0-9-]{24,}/g,'<qa>'),ms:Math.round(performance.now()-start)});return data;
}
async function verifyMarkers() {
  for(const slug of ['draftrunapi','pack1growth','pack1api']) {
    const h=await call(slug,'/health?quick=1');assert.equal(h.ok,true);assert.equal(h.release_commit,commit,`${slug} revision`);
  }
}
await verifyMarkers();
const health=await call('draftrunapi','/health');
assert.equal(health.ok,true);assert.equal(health.run_length,8);assert.equal(health.selection_version,'eight-pick-v3');
assert.equal(health.unrated_puzzles,0);assert.deepEqual(health.missing_sets,[]);assert.equal(health.daily_featured_sets.length,3);
await call('pack1growth','/v1/events',{events:[{event:'page_view',props:{}}]},null,401);
if(process.argv.includes('--practice')) {
  const guest=await call('pack1growth','/v1/session',{displayName:'QA release '+commit.slice(0,7)});
  for(const environment of ['mixed','powered-cube']) {
    let run=await call('draftrunapi','/v1/runs',{environment,qa:true},guest.token);
    assert.equal(run.run_length,8);assert.equal(run.day,null);
    run=await call('draftrunapi',`/v1/runs/${run.id}/reroll`,{revision:run.revision,round:0,puzzleId:run.current.puzzle_id,type:'pack'},guest.token);
    for(let round=0;round<8;round++) {
      if(environment==='powered-cube')assert.equal(run.current.set_id,environment);
      const pick={revision:run.revision,round,puzzleId:run.current.puzzle_id,cardId:run.current.candidates[0].id};
      run=await call('draftrunapi',`/v1/runs/${run.id}/pick`,pick,guest.token);
      assert.equal(run.complete,round===7);
      if(round===7)assert.equal((await call('draftrunapi',`/v1/runs/${run.id}/pick`,pick,guest.token)).score,run.score);
    }
    assert.equal(run.score,Math.round(run.answers.reduce((sum,a)=>sum+a.score,0)/8));
    const shared=await call('draftrunapi',`/v1/runs/${run.id}/share`,{},guest.token);
    const info=await call('draftrunapi',`/v1/challenges/${shared.id}`);assert.equal(info.run_length,8);
    const friend=await call('draftrunapi','/v1/runs',{challenge:shared.id,qa:true},guest.token);
    assert.equal(friend.run_length,8);assert.equal(friend.comparison.exact,true);assert.equal(friend.current.puzzle_id,run.answers[0].puzzle.puzzle_id);
    console.log(`${environment}: eight picks, reroll, completion retry, score and stored friend challenge passed`);
  }
}
// Catch a concurrent deployment during the acceptance pass, not just stale
// code at the beginning. Image maintenance must never redeploy this backend.
await verifyMarkers();
console.log(JSON.stringify({branch,commit,timings},null,2));
