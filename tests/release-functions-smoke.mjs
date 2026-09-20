// HTTP acceptance using private QA guests. Dailies are unranked and immutable.
import assert from 'node:assert/strict';
const [branch,commit]=process.argv.slice(2);
if(!/^br-[a-z0-9-]+$/.test(branch||'')||!/^[a-f0-9]{40}$/.test(commit||''))throw Error('Usage: release-functions-smoke.mjs BRANCH_ID FULL_COMMIT_SHA [--daily] (legacy --practice also runs unranked Daily acceptance)');
const timings=[];
async function call(slug,path,body,token,status=200) {
  const start=performance.now();
  const r=await fetch(`https://${branch}-${slug}.compute.c-5.us-east-2.aws.neon.tech${path}`,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
  const data=await r.json();assert.equal(r.status,status,`${slug}${path}: ${JSON.stringify(data)}`);
  timings.push({service:slug,path:path.replace(/[a-f0-9-]{24,}/g,'<qa>'),ms:Math.round(performance.now()-start)});return data;
}
// Neon reporting a deployment "completed" is not the same as every instance
// serving it. A production deploy of an unchanged-but-remarked bundle reported
// pack1growth/9 active at 04:10:28 and was still answering with the PREVIOUS
// commit ten minutes later, then answered with the new one without any further
// deploy. The mechanism is not visible from here - an instance outliving its
// deployment is the obvious guess, not a confirmed cause - but asserting one
// request after the deploy call returns makes a green release a coin flip.
// Only the caller that just deployed passes --settle. The pre-promotion gate
// asks whether development ALREADY runs this revision, which is a question that
// should be answered instantly, so it keeps failing fast.
const SETTLE_MS=process.argv.includes('--settle')?10*60*1000:0, POLL_MS=10*1000;
async function verifyMarkers({settle=false}={}) {
  const deadline=Date.now()+SETTLE_MS;
  for(const slug of ['draftrunapi','pack1growth','pack1api']) {
    const started=Date.now();
    for(;;) {
      const h=await call(slug,'/health?quick=1');
      assert.equal(h.ok,true);
      if(h.release_commit===commit) {
        const waited=Math.round((Date.now()-started)/1000);
        // Absorbing this silently would hide a pipeline getting slower.
        if(waited>=POLL_MS/1000)console.log(`${slug}: settled on ${commit.slice(0,7)} after ${waited}s`);
        break;
      }
      // The closing pass is a different question - has something redeployed
      // underneath the acceptance run? - so it gets no grace at all.
      if(!settle||Date.now()>=deadline) assert.equal(h.release_commit,commit,`${slug} revision`);
      await new Promise(resolve=>setTimeout(resolve,POLL_MS));
    }
  }
}
await verifyMarkers({settle:true});
async function waitForStableMarkers() {
  if(!SETTLE_MS)return;
  const deadline=Date.now()+SETTLE_MS,stableWindow=30*1000;
  let stableSince=0,last={};
  while(Date.now()<deadline) {
    let all=true;
    for(const slug of ['draftrunapi','pack1growth','pack1api']) {
      const h=await call(slug,'/health?quick=1');
      assert.equal(h.ok,true);
      last[slug]=h.release_commit;
      if(h.release_commit!==commit)all=false;
    }
    if(all) {
      if(!stableSince)stableSince=Date.now();
      if(Date.now()-stableSince>=stableWindow) {
        console.log(`release markers held ${commit.slice(0,7)} continuously for ${stableWindow/1000}s`);
        return;
      }
    } else stableSince=0;
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
  assert.deepEqual(last,{draftrunapi:commit,pack1growth:commit,pack1api:commit},'release markers did not stabilize');
}
const health=await call('draftrunapi','/health');
assert.equal(health.ok,true);assert.equal(health.run_length,8);assert.equal(health.selection_version,'eight-pick-v4');
assert.equal(health.unrated_puzzles,0);assert.deepEqual(health.missing_sets,[]);assert.equal(health.daily_featured_sets.length,4);
await call('pack1growth','/v1/events',{events:[{event:'page_view',props:{}}]},null,401);
if(process.argv.includes('--daily')||process.argv.includes('--practice')) {
  const guest=await call('pack1growth','/v1/session',{displayName:'QA release '+commit.slice(0,7)});
  const friend=await call('pack1growth','/v1/session',{displayName:'QA universal '+commit.slice(0,7)});
  for(const environment of ['mixed','powered-cube','latest']) {
    await call('draftrunapi','/v1/runs',{environment,qa:true},guest.token,environment==='latest'?400:403);
    let run=await call('draftrunapi','/v1/runs',{environment,daily:true,qa:true},guest.token);
    assert.equal(run.run_length,8);assert.ok(run.day);
    assert.equal(run.leaderboard_eligible,false);
    assert.deepEqual(run.rerolls,{set:0,pack:0});
    const same=await call('draftrunapi','/v1/runs',{environment,daily:true,qa:true},friend.token);
    assert.equal(same.current.puzzle_id,run.current.puzzle_id);
    await call('draftrunapi',`/v1/runs/${run.id}/reroll`,{revision:run.revision,round:0,puzzleId:run.current.puzzle_id,type:'pack'},guest.token,409);
    for(let round=0;round<8;round++) {
      if(environment==='powered-cube')assert.equal(run.current.set_id,environment);
      if(environment==='latest')assert.equal(run.current.set_id,run.daily_featured_sets[0]);
      if(run.selection_version==='eight-pick-v4')assert.equal(run.current.pick_number,round+(environment==='powered-cube'?2:1));
      const pick={revision:run.revision,round,puzzleId:run.current.puzzle_id,cardId:run.current.candidates[0].id};
      run=await call('draftrunapi',`/v1/runs/${run.id}/pick`,pick,guest.token);
      const answer=run.answers[round];
      if(answer.historicalMatch)assert.equal(answer.score,100);
      else assert.ok(answer.score>=0&&answer.score<=95);
      assert.equal(run.complete,round===7);
      if(round===7)assert.equal((await call('draftrunapi',`/v1/runs/${run.id}/pick`,pick,guest.token)).score,run.score);
    }
    assert.equal(run.score,Math.round(run.answers.reduce((sum,a)=>sum+a.score,0)/8));
    assert.equal(run.leaderboard_eligible,false);assert.equal(run.standing,null);
    const shared=await call('draftrunapi',`/v1/runs/${run.id}/share`,{},guest.token);
    assert.equal(shared.daily,true);assert.equal(shared.id,undefined);
    const url=new URL(shared.url,'https://packone.pro');assert.equal(url.searchParams.get('daily'),'1');assert.equal(url.searchParams.has('challenge'),false);
    const resumed=await call('draftrunapi','/v1/runs',{environment,daily:true,qa:true},guest.token);
    assert.equal(resumed.id,run.id);assert.equal(resumed.score,run.score);
    console.log(environment+': guest practice denied, universal fixed Daily, no rerolls, completion retry, trophy scoring, unranked result, universal share and resume passed');
  }
}
// Neon can briefly route an old instance even after the new revision has
// already answered successfully. Require a sustained exact-revision window
// first, then keep the closing check fail-fast so a concurrent deploy landing
// underneath acceptance is still caught immediately.
await waitForStableMarkers();
await verifyMarkers();
console.log(JSON.stringify({branch,commit,timings},null,2));
