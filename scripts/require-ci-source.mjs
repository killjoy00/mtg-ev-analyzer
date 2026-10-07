import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {controlRequest} from './control-read.mjs';
export function inspectSourceChecks(pull,checks,{head,requiredNames}) {
  assert.equal(pull.head.sha,head,'Queued source head changed; do not provision resources');
  assert.equal(pull.state,'open','Capacity acceptance requires an open reviewed PR');
  assert.equal(pull.draft,false,'Draft PRs must not provision preview resources');
  const latest=new Map();
  for(const check of checks)if(check.head_sha===head&&check.app?.slug==='github-actions'&&requiredNames.includes(check.name)) {
    const previous=latest.get(check.name);
    if(!previous||Number(check.id)>Number(previous.id))latest.set(check.name,check);
  }
  const required=requiredNames.map(name=>latest.get(name));
  assert.ok(!required.some(check=>check?.status==='completed'&&check.conclusion!=='success'),'Required CI failed; do not provision resources');
  return required.every(check=>check?.status==='completed'&&check.conclusion==='success');
}
export async function requireCiSource({repo,token,head,pr,requirePerformance=false,once=false,
  get=path=>controlRequest('https://api.github.com/repos/'+repo+path,{provider:'GitHub',token}),
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),clock=Date.now,deadlineMs=30*60*1000}={}) {
  assert.match(head||'',/^[a-f0-9]{40}$/);assert.match(String(pr||''),/^[1-9][0-9]*$/);
  const requiredNames=requirePerformance?['test','browser','baseline']:['test','browser'];
  const deadline=clock()+deadlineMs;
  do {
    const pull=await get('/pulls/'+pr),checks=[];
    for(let page=1;page<=10;page++) {
      const batch=await get(`/commits/${head}/check-runs?per_page=100&page=${page}`);
      assert.ok(Array.isArray(batch.check_runs),'Invalid GitHub check inventory');checks.push(...batch.check_runs);
      if(batch.check_runs.length<100)break;
      if(page===10)throw Error('Check inventory exceeded the bounded source gate');
    }
    if(inspectSourceChecks(pull,checks,{head,requiredNames}))return {head,requiredNames};
    if(once)throw Error('Queued source no longer has successful prerequisite checks');
    if(clock()>=deadline)break;
    await sleep(Math.min(10000,deadline-clock()));
  } while(clock()<deadline);
  throw Error('Required CI did not finish within the source gate');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const result=await requireCiSource({repo:process.env.GITHUB_REPOSITORY,token:process.env.GH_TOKEN,
    head:process.env.REVIEWED_HEAD,pr:process.env.REVIEWED_PR,requirePerformance:process.env.REQUIRE_PERFORMANCE==='true',once:process.argv.includes('--once')});
  console.log('Unchanged source passed '+result.requiredNames.join(', ')+' acceptance.');
}
