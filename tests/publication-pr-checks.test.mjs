import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePublicationPr,requiredPublicationRuns,validatePublicationRunJobs,waitForPublicationChecks,
} from '../.github/scripts/publication-pr-checks.mjs';

const expected={repo:'owner/repo',branch:'automation/creator-challenge-fixture-op',headSha:'a'.repeat(40),
  slug:'fixture',kind:'creator',action:'publish',prNumber:123};
const pr=()=>({number:123,state:'open',base:{ref:'main',repo:{full_name:expected.repo}},
  head:{ref:expected.branch,sha:expected.headSha,repo:{full_name:expected.repo}},user:{login:'github-actions[bot]'}});
const files=[
  {filename:'creator-challenges.json',status:'modified'},
  {filename:'creator/fixture/index.html',status:'added'},
  {filename:'creator/fixture/creator-card.png',status:'added'},
];
const runs=()=>['test','e2e'].map((name,index)=>({id:index+1,path:'.github/workflows/'+name+'.yml',
  event:'pull_request',head_sha:expected.headSha,head_branch:expected.branch,head_repository:{full_name:expected.repo},
  pull_requests:[{number:123}],status:'completed',conclusion:'action_required',html_url:'https://github.com/owner/repo/actions/runs/'+(index+1)}));
const jobsFor=run=>({jobs:[{
  name:run.path.endsWith('/test.yml')?'test':'browser',status:'completed',conclusion:'success',
  steps:[
    {name:run.path.endsWith('/test.yml')?'Validate publication-only source':'Run focused publication browser smoke',status:'completed',conclusion:'success'},
    {name:run.path.endsWith('/test.yml')?'Verify selected validation completed':'Verify selected browser validation completed',status:'completed',conclusion:'success'},
  ],
}]});

test('publication approval is confined to the generated same-repo static diff and frozen head',()=>{
  validatePublicationPr(pr(),files,expected);
  for(const wrong of [ {...pr(),head:{...pr().head,sha:'b'.repeat(40)}},
    {...pr(),head:{...pr().head,repo:{full_name:'attacker/fork'}}},
    {...pr(),state:'closed'}, {...pr(),user:{login:'untrusted'}} ])
    assert.throws(()=>validatePublicationPr(wrong,files,expected));
  assert.throws(()=>validatePublicationPr(pr(),[{filename:'worker/index.js',status:'modified'}],expected));
  assert.throws(()=>validatePublicationPr(pr(),[
    {filename:'creator-challenges.json',status:'modified'},{filename:'creator/fixture/index.html',status:'added'},
  ],expected),/social card/);
});

test('creator retirement permits only a removed social card and still requires registry plus neutral route',()=>{
  const retired={...expected,action:'retire'};
  validatePublicationPr(pr(),[
    {filename:'creator-challenges.json',status:'modified'},
    {filename:'creator/fixture/index.html',status:'modified'},
    {filename:'creator/fixture/creator-card.png',status:'removed'},
  ],retired);
  validatePublicationPr(pr(),[
    {filename:'creator-challenges.json',status:'modified'},
    {filename:'creator/fixture/index.html',status:'added'},
  ],retired);
  assert.throws(()=>validatePublicationPr(pr(),[
    {filename:'creator-challenges.json',status:'modified'},
    {filename:'creator/fixture/index.html',status:'modified'},
    {filename:'creator/fixture/creator-card.png',status:'modified'},
  ],retired),/may only delete/);
});

test('manual-dispatch green checks and unrelated PR runs cannot authorize publication',()=>{
  const valid=runs();
  const distractors=valid.flatMap(run=>[
    {...run,id:run.id+100,event:'workflow_dispatch',conclusion:'success'},
    {...run,id:run.id+200,pull_requests:[{number:999}],conclusion:'success'},
    {...run,id:run.id+300,head_sha:'b'.repeat(40),conclusion:'success'},
  ]);
  assert.deepEqual(requiredPublicationRuns([...valid,...distractors],expected).map(run=>run.id),[1,2]);
  assert.deepEqual(requiredPublicationRuns(distractors,expected),[undefined,undefined]);
});

test('successful publication runs must contain the selected publication validation steps',()=>{
  for(const run of runs())validatePublicationRunJobs(run,jobsFor(run).jobs);
  const run=runs()[0];
  const bad=jobsFor(run).jobs;
  bad[0].steps[0]={name:'Run unrelated tests',status:'completed',conclusion:'success'};
  assert.throws(()=>validatePublicationRunJobs(run,bad),/publication-only source/);
});

test('only exact PR runs are approved, then both real publication validations must succeed',async()=>{
  const events=[];let polls=0;
  const fetcher=async(url,options)=>{
    const path=new URL(url).pathname;
    events.push({path,method:options.method,token:options.headers.authorization});
    if(path.endsWith('/approve'))return new Response(null,{status:201});
    if(path.endsWith('/files'))return Response.json(files);
    if(path.endsWith('/pulls/123'))return Response.json(pr());
    const jobMatch=path.match(/\/actions\/runs\/(\d+)\/jobs$/);
    if(jobMatch){
      const run=runs().find(item=>item.id===Number(jobMatch[1]));
      return Response.json(jobsFor(run));
    }
    if(path.endsWith('/actions/runs'))return Response.json({workflow_runs:runs().map(run=>({...run,conclusion:polls?'success':'action_required'}))});
    throw Error('Unexpected request '+path);
  };
  const result=await waitForPublicationChecks({...expected,token:'read-and-merge',approvalToken:'actions-approve',fetcher,sleep:async()=>{polls++;}});
  assert.equal(result.length,2);
  const approvals=events.filter(event=>event.method==='POST');
  assert.deepEqual(approvals.map(event=>event.path),['/repos/owner/repo/actions/runs/1/approve','/repos/owner/repo/actions/runs/2/approve']);
  assert.ok(approvals.every(event=>event.token==='Bearer actions-approve'));
  assert.ok(events.filter(event=>event.method==='GET').every(event=>event.token==='Bearer read-and-merge'));
  assert.equal(events.filter(event=>/\/jobs$/.test(event.path)).length,2,'both exact successful runs are inspected for publication steps');
});

test('a green workflow that skipped publication validation cannot authorize publication',async()=>{
  const fetcher=async url=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/files'))return Response.json(files);
    if(path.endsWith('/pulls/123'))return Response.json(pr());
    const jobMatch=path.match(/\/actions\/runs\/(\d+)\/jobs$/);
    if(jobMatch)return Response.json({jobs:[{name:'test',status:'completed',conclusion:'success',steps:[
      {name:'Unrelated validation',status:'completed',conclusion:'success'},
    ]}]});
    return Response.json({workflow_runs:runs().map(run=>({...run,conclusion:'success'}))});
  };
  await assert.rejects(waitForPublicationChecks({...expected,token:'read',approvalToken:'approve',fetcher}),/publication/);
});

test('a genuine PR check failure stops publication without replacing its outcome',async()=>{
  const fetcher=async(url)=>new URL(url).pathname.endsWith('/files')?Response.json(files)
    :new URL(url).pathname.endsWith('/pulls/123')?Response.json(pr())
      :Response.json({workflow_runs:runs().map(run=>({...run,conclusion:'failure'}))});
  await assert.rejects(waitForPublicationChecks({...expected,token:'read',approvalToken:'approve',fetcher}),/Required PR check failed/);
});

const greenRuns=()=>({workflow_runs:runs().map(run=>({...run,conclusion:'success'}))});
const healthyRead=url=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/files'))return Response.json(files);
  if(path.endsWith('/pulls/123'))return Response.json(pr());
  const jobMatch=path.match(/\/actions\/runs\/(\d+)\/jobs$/);
  if(jobMatch){
    const run=runs().find(item=>item.id===Number(jobMatch[1]));
    return Response.json(jobsFor(run));
  }
  return Response.json(greenRuns());
};

for(const failure of [500,503,429,'network','timeout']){
  test(`transient GitHub read ${failure} recovers without approving or weakening checks`,async()=>{
    let reads=0,approvals=0;const delays=[];
    const fetcher=async(url,options)=>{
      assert.equal(options.headers.authorization,'Bearer read');
      if(options.method==='POST'){approvals++;throw Error('No approval expected');}
      if(new URL(url).pathname.endsWith('/actions/runs')&&++reads===1){
        if(failure==='network')throw new TypeError('fetch failed');
        if(failure==='timeout')throw new DOMException('read timed out','TimeoutError');
        return new Response('Temporary failure',{status:failure,headers:failure===429?{'retry-after':'2'}:{}});
      }
      return healthyRead(url);
    };
    const result=await waitForPublicationChecks({...expected,token:'read',approvalToken:'approve',fetcher,sleep:async ms=>{delays.push(ms);}});
    assert.equal(result.length,2);assert.equal(reads,2);assert.equal(approvals,0);
    assert.deepEqual(delays,[failure===429?2000:1000]);
  });
}

test('persistent outages are bounded and authorization failures are not retried',async()=>{
  for(const status of [500,403]){
    let reads=0,approvals=0;const delays=[];
    const fetcher=async(url,options)=>{
      if(options.method==='POST')approvals++;
      reads++;return new Response('Failure',{status});
    };
    await assert.rejects(waitForPublicationChecks({...expected,token:'read',approvalToken:'approve',fetcher,sleep:async ms=>{delays.push(ms);}}),new RegExp('GitHub read HTTP '+status));
    assert.equal(reads,status===500?5:1);assert.equal(approvals,0);
    assert.deepEqual(delays,status===500?[1000,2000,4000,8000]:[]);
  }
});

test('invalid JSON and ambiguous approval failures are never blindly retried',async()=>{
  let reads=0;
  await assert.rejects(waitForPublicationChecks({...expected,token:'read',approvalToken:'approve',
    fetcher:async()=>{reads++;return new Response('invalid JSON');},sleep:async()=>{throw Error('No retry expected');}}),SyntaxError);
  assert.equal(reads,2,'frozen PR and file reads start together before JSON parsing rejects');
  let approvals=0;
  const fetcher=async(url,options)=>{
    if(options.method==='POST'){approvals++;return new Response('Temporary failure',{status:500});}
    if(new URL(url).pathname.endsWith('/actions/runs'))return Response.json({workflow_runs:runs()});
    return healthyRead(url);
  };
  await assert.rejects(waitForPublicationChecks({...expected,token:'read',approvalToken:'approve',fetcher,sleep:async()=>{throw Error('No retry expected');}}),/GitHub approval HTTP 500/);
  assert.equal(approvals,1);
});

test('read retries cannot outlive the overall publication deadline',async()=>{
  let reads=0,sleeps=0;
  await assert.rejects(waitForPublicationChecks({...expected,token:'read',approvalToken:'approve',timeoutMs:500,now:()=>0,
    fetcher:async()=>{reads++;return new Response('Failure',{status:503});},sleep:async()=>{sleeps++;}}),/Timed out waiting/);
  assert.ok(reads>=1);assert.equal(sleeps,0);
});

test('a PR head changed during a read retry cannot use the old green runs',async()=>{
  let moved=false,reads=0,approvals=0;
  const fetcher=async(url,options)=>{
    const path=new URL(url).pathname;
    if(options.method==='POST'){approvals++;throw Error('No approval expected');}
    if(path.endsWith('/actions/runs')&&++reads===1)return new Response('Temporary failure',{status:500});
    if(path.endsWith('/pulls/123')&&moved)return Response.json({...pr(),head:{...pr().head,sha:'b'.repeat(40)}});
    return healthyRead(url);
  };
  await assert.rejects(waitForPublicationChecks({...expected,token:'read',approvalToken:'approve',fetcher,sleep:async()=>{moved=true;}}),/publication head changed/);
  assert.equal(approvals,0);
});
