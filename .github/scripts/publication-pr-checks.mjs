import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const paths=['.github/workflows/test.yml','.github/workflows/e2e.yml'];
const requiredStepByPath=new Map([
  ['.github/workflows/test.yml','Validate publication-only source'],
  ['.github/workflows/e2e.yml','Run focused publication browser smoke'],
]);
const completionStepByPath=new Map([
  ['.github/workflows/test.yml','Verify selected validation completed'],
  ['.github/workflows/e2e.yml','Verify selected browser validation completed'],
]);

export function validatePublicationPr(pr,files,{repo,branch,headSha,slug,kind,action='publish'}) {
  assert.equal(pr.state,'open');
  assert.equal(pr.base?.ref,'main');
  assert.equal(pr.base?.repo?.full_name,repo);
  assert.equal(pr.head?.repo?.full_name,repo,'never approve a fork');
  assert.equal(pr.head?.ref,branch);
  assert.equal(pr.head?.sha,headSha,'publication head changed');
  assert.equal(pr.user?.login,'github-actions[bot]');
  assert.match(slug,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(['creator','campaign'].includes(kind));
  assert.ok(['publish','retire'].includes(action));
  const registry=kind==='creator'?'creator-challenges.json':'campaign-links.json';
  const route=(kind==='creator'?'creator/':'go/')+slug+'/index.html';
  const card='creator/'+slug+'/creator-card.png';
  const allowed=kind==='creator'?[registry,route,card]:[registry,route];
  assert.ok(files.length>0&&files.length<=allowed.length);
  const byName=new Map(files.map(file=>[file.filename,file]));
  for(const file of files)assert.ok(allowed.includes(file.filename),'unexpected publication file: '+file.filename);
  assert.ok(byName.has(registry),'publication registry change is required');
  assert.ok(byName.has(route),'publication route change is required');
  assert.notEqual(byName.get(registry)?.status,'removed','publication registry cannot be deleted');
  if(action==='publish') {
    assert.notEqual(byName.get(route)?.status,'removed','published route cannot be deleted');
    if(kind==='creator') {
      assert.ok(byName.has(card),'creator publication requires the generated social card');
      assert.notEqual(byName.get(card)?.status,'removed','published creator social card cannot be deleted');
    }
  } else {
    if(kind==='campaign')assert.equal(byName.get(route)?.status,'removed','retired campaign route must be removed');
    if(kind==='creator'&&byName.has(card))assert.equal(byName.get(card)?.status,'removed','creator retirement may only delete the social card');
  }
}

export function requiredPublicationRuns(runs,{repo,branch,headSha,prNumber}) {
  return paths.map(path=>runs.filter(run=>run.path===path&&run.event==='pull_request'
    &&run.head_sha===headSha&&run.head_branch===branch
    &&run.head_repository?.full_name===repo
    &&run.pull_requests?.some(pr=>pr.number===prNumber))
    .sort((a,b)=>b.id-a.id)[0]);
}

export function validatePublicationRunJobs(run,jobs) {
  assert.ok(run&&paths.includes(run.path),'unexpected required publication run');
  assert.ok(Array.isArray(jobs)&&jobs.length>0,'required publication run has no jobs');
  const expectedStep=requiredStepByPath.get(run.path);
  const completionStep=completionStepByPath.get(run.path);
  const matching=jobs.filter(job=>job.status==='completed'&&job.conclusion==='success'
    &&job.steps?.some(step=>step.name===expectedStep));
  assert.equal(matching.length,1,'required publication run did not execute exactly one successful '+expectedStep+' step');
  const job=matching[0];
  const selected=job.steps.find(step=>step.name===expectedStep);
  assert.equal(selected.status,'completed');
  assert.equal(selected.conclusion,'success');
  const completion=job.steps.find(step=>step.name===completionStep);
  assert.ok(completion,'required publication run is missing completion assertion '+completionStep);
  assert.equal(completion.status,'completed');
  assert.equal(completion.conclusion,'success');
  return job;
}

export async function waitForPublicationChecks({repo,branch,headSha,slug,kind,action='publish',prNumber,
  token,approvalToken,fetcher=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  timeoutMs=30*60*1000,now=Date.now}) {
  assert.match(repo,/^[\w.-]+\/[\w.-]+$/);
  assert.match(headSha,/^[a-f0-9]{40}$/);
  assert.ok(Number.isSafeInteger(prNumber)&&prNumber>0);
  assert.ok(token&&approvalToken,'Protected publication requires the existing Actions-write approval token.');
  const deadline=now()+timeoutMs;
  const api=async(path,{approve=false}={})=>{
    for(let attempt=0;attempt<5;attempt++){
      assert.ok(now()<deadline,'Timed out waiting for required pull_request test/browser checks.');
      let response,transportError;
      try{
        response=await fetcher('https://api.github.com/repos/'+repo+path,{
          method:approve?'POST':'GET',
          headers:{authorization:'Bearer '+(approve?approvalToken:token),accept:'application/vnd.github+json',
            'x-github-api-version':'2026-03-10'},signal:AbortSignal.timeout(Math.max(1,Math.min(30000,deadline-now()))),
        });
      }catch(error){
        if(approve||!(error instanceof TypeError||['TimeoutError','AbortError'].includes(error.name)))throw error;
        transportError=error;
      }
      if(response?.ok)return approve||response.status===204?null:response.json();
      const retryable=!approve&&(transportError||response.status===429||response.status>=500&&response.status<=599);
      const failure='GitHub '+(approve?'approval':'read')+' '+(transportError?.name||'HTTP '+response.status)+' for '+path;
      assert.ok(retryable&&attempt<4,failure);
      const retryAfter=Number(response?.headers.get('retry-after'));
      const delay=Math.max(1000*2**attempt,Number.isFinite(retryAfter)?Math.min(60000,Math.max(0,retryAfter*1000)):0);
      assert.ok(now()+delay<deadline,'Timed out waiting for required pull_request test/browser checks.');
      if(response?.body)await response.body.cancel().catch(()=>{});
      console.log(failure+'; retrying read ('+(attempt+2)+'/5).');
      await sleep(delay);
    }
  };
  const validateFrozenPr=async()=>{
    const [pr,files]=await Promise.all([
      api('/pulls/'+prNumber),
      api('/pulls/'+prNumber+'/files?per_page=100'),
    ]);
    validatePublicationPr(pr,files,{repo,branch,headSha,slug,kind,action});
    return files;
  };
  const approved=new Set();
  while(now()<deadline){
    await validateFrozenPr();
    let runs=[];
    for(let page=1;page<=3;page++){
      const data=await api('/actions/runs?event=pull_request&head_sha='+headSha+'&per_page=100&page='+page);
      runs.push(...data.workflow_runs);
      if(data.workflow_runs.length<100)break;
    }
    const required=requiredPublicationRuns(runs,{repo,branch,headSha,prNumber});
    if(required.every(run=>run?.status==='completed'&&run.conclusion==='success')){
      await validateFrozenPr();
      for(const run of required) {
        const data=await api('/actions/runs/'+run.id+'/jobs?per_page=100');
        validatePublicationRunJobs(run,data.jobs);
      }
      await validateFrozenPr();
      return required;
    }
    for(const run of required.filter(Boolean)){
      if(run.conclusion==='action_required'){
        if(!approved.has(run.id)){
          await validateFrozenPr();
          await api('/actions/runs/'+run.id+'/approve',{approve:true});
          approved.add(run.id);
          console.log('Approved required PR check: '+run.html_url);
        }
      }else if(run.status==='completed'&&run.conclusion!=='success'){
        throw Error('Required PR check failed: '+run.html_url+' ('+run.conclusion+')');
      }
    }
    await sleep(10000);
  }
  throw Error('Timed out waiting for required pull_request test/browser checks.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const prNumber=Number(new URL(process.env.PR_URL).pathname.split('/').at(-1));
  const runs=await waitForPublicationChecks({repo:process.env.GITHUB_REPOSITORY,branch:process.env.BRANCH,
    headSha:process.env.HEAD_SHA,slug:process.env.CAMPAIGN_SLUG,kind:process.env.PUBLISH_KIND,
    action:process.env.PUBLISH_KIND==='creator'?process.env.CREATOR_ACTION||'publish':'publish',prNumber,
    token:process.env.GH_TOKEN,approvalToken:process.env.PUBLICATION_APPROVAL_TOKEN});
  console.log('Required publication PR checks passed: '+runs.map(run=>run.html_url).join(' '));
}
