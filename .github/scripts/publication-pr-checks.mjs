import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const paths=['.github/workflows/test.yml','.github/workflows/e2e.yml'];

export function validatePublicationPr(pr,files,{repo,branch,headSha,slug,kind}) {
  assert.equal(pr.state,'open');
  assert.equal(pr.base?.ref,'main');
  assert.equal(pr.base?.repo?.full_name,repo);
  assert.equal(pr.head?.repo?.full_name,repo,'never approve a fork');
  assert.equal(pr.head?.ref,branch);
  assert.equal(pr.head?.sha,headSha,'publication head changed');
  assert.equal(pr.user?.login,'github-actions[bot]');
  assert.match(slug,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(['creator','campaign'].includes(kind));
  const allowed=kind==='creator'
    ? ['creator-challenges.json','creator/'+slug+'/index.html','creator/'+slug+'/creator-card.png']
    : ['campaign-links.json','go/'+slug+'/index.html'];
  assert.ok(files.length>0&&files.length<=allowed.length);
  for(const file of files)assert.ok(allowed.includes(file.filename),'unexpected publication file: '+file.filename);
}

export function requiredPublicationRuns(runs,{repo,branch,headSha,prNumber}) {
  return paths.map(path=>runs.filter(run=>run.path===path&&run.event==='pull_request'
    &&run.head_sha===headSha&&run.head_branch===branch
    &&run.head_repository?.full_name===repo
    &&run.pull_requests?.some(pr=>pr.number===prNumber))
    .sort((a,b)=>b.id-a.id)[0]);
}

export async function waitForPublicationChecks({repo,branch,headSha,slug,kind,prNumber,
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
  const files=await api('/pulls/'+prNumber+'/files?per_page=100');
  const approved=new Set();
  while(now()<deadline){
    validatePublicationPr(await api('/pulls/'+prNumber),files,{repo,branch,headSha,slug,kind});
    let runs=[];
    for(let page=1;page<=3;page++){
      const data=await api('/actions/runs?event=pull_request&head_sha='+headSha+'&per_page=100&page='+page);
      runs.push(...data.workflow_runs);
      if(data.workflow_runs.length<100)break;
    }
    const required=requiredPublicationRuns(runs,{repo,branch,headSha,prNumber});
    if(required.every(run=>run?.status==='completed'&&run.conclusion==='success')){
      validatePublicationPr(await api('/pulls/'+prNumber),files,{repo,branch,headSha,slug,kind});
      return required;
    }
    for(const run of required.filter(Boolean)){
      if(run.conclusion==='action_required'){
        if(!approved.has(run.id)){
          validatePublicationPr(await api('/pulls/'+prNumber),files,{repo,branch,headSha,slug,kind});
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
    headSha:process.env.HEAD_SHA,slug:process.env.CAMPAIGN_SLUG,kind:process.env.PUBLISH_KIND,prNumber,
    token:process.env.GH_TOKEN,approvalToken:process.env.PUBLICATION_APPROVAL_TOKEN});
  console.log('Required publication PR checks passed: '+runs.map(run=>run.html_url).join(' '));
}
