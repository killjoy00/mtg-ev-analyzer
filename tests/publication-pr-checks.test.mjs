import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePublicationPr,requiredPublicationRuns,validatePublicationRunJobs,waitForPublicationChecks} from '../.github/scripts/publication-pr-checks.mjs';

const expected={repo:'owner/repo',branch:'automation/creator-challenge-fixture-op',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),slug:'fixture',kind:'creator',prNumber:123};
const pr=()=>({number:123,state:'open',base:{ref:'main',sha:expected.baseSha,repo:{full_name:expected.repo}},
  head:{ref:expected.branch,sha:expected.headSha,repo:{full_name:expected.repo}},user:{login:'github-actions[bot]'}});
const files=[{filename:'creator-challenges.json'},{filename:'creator/fixture/index.html'},{filename:'creator/fixture/creator-card.png'},{filename:'creator/fixture/creator-card-square.png'}];
const runs=()=>['test','e2e'].map((name,index)=>({id:index+1,path:'.github/workflows/'+name+'.yml',
  event:'pull_request',head_sha:expected.headSha,head_branch:expected.branch,head_repository:{full_name:expected.repo},
  pull_requests:[{number:123}],status:'completed',conclusion:'action_required',html_url:'https://github.com/owner/repo/actions/runs/'+(index+1)}));
const jobsFor=runId=>({jobs:[{name:runId===1?'test':'browser',status:'completed',conclusion:'success',steps:(runId===1?[
  'Validate publication diff and generated outputs','Run selected test validation','Verify selected test validation completed',
]:[
  'Validate publication diff and generated outputs','Run focused publication browser smoke','Verify selected browser validation completed',
]).map(name=>({name,status:'completed',conclusion:'success'}))}]});

test('publication approval is confined to the generated same-repo static diff and frozen head',()=>{
  validatePublicationPr(pr(),files,expected);
  for(const wrong of [ {...pr(),head:{...pr().head,sha:'c'.repeat(40)}},
    {...pr(),base:{...pr().base,sha:'d'.repeat(40)}},
    {...pr(),head:{...pr().head,repo:{full_name:'attacker/fork'}}},
    {...pr(),state:'closed'}, {...pr(),user:{login:'untrusted'}} ])
    assert.throws(()=>validatePublicationPr(wrong,files,expected));
  assert.throws(()=>validatePublicationPr(pr(),[{filename:'worker/index.js'}],expected));
  assert.throws(()=>validatePublicationPr(pr(),[{filename:'creator/other/index.html'}],expected));
  assert.throws(()=>validatePublicationPr(pr(),[...files,{filename:'creator/fixture/extra.png'}],expected));
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

test('successful publication runs must contain the selected validation steps',()=>{
  validatePublicationRunJobs('.github/workflows/test.yml',jobsFor(1).jobs);
  validatePublicationRunJobs('.github/workflows/e2e.yml',jobsFor(2).jobs);
  const incomplete=jobsFor(1).jobs.map(job=>({...job,steps:job.steps.filter(step=>step.name!=='Run selected test validation')}));
  assert.throws(()=>validatePublicationRunJobs('.github/workflows/test.yml',incomplete),/missing validation step/);
  const failed=jobsFor(2).jobs.map(job=>({...job,steps:job.steps.map(step=>step.name==='Run focused publication browser smoke'?{...step,conclusion:'failure'}:step)}));
  assert.throws(()=>validatePublicationRunJobs('.github/workflows/e2e.yml',failed),/did not pass/);
});

test('only exact PR runs are approved with Actions token, then both real checks must succeed',async()=>{
  const events=[];let polls=0;
  const fetcher=async(url,options)=>{
    const path=new URL(url).pathname;
    events.push({path,method:options.method,token:options.headers.authorization});
    if(path.endsWith('/approve'))return new Response(null,{status:201});
    if(path.endsWith('/files'))return Response.json(files);
    if(path.endsWith('/pulls/123'))return Response.json(pr());
    const jobMatch=path.match(/\/actions\/runs\/(\d+)\/jobs$/);
    if(jobMatch)return Response.json(jobsFor(Number(jobMatch[1])));
    if(path.endsWith('/actions/runs'))return Response.json({workflow_runs:runs().map(run=>({...run,conclusion:polls?'success':'action_required'}))});
    throw Error('Unexpected request');
  };
  const result=await waitForPublicationChecks({...expected,token:'read-and-merge',approvalToken:'actions-approve',fetcher,sleep:async()=>{polls++;}});
  assert.equal(result.length,2);
  const approvals=events.filter(event=>event.method==='POST');
  assert.deepEqual(approvals.map(event=>event.path),['/repos/owner/repo/actions/runs/1/approve','/repos/owner/repo/actions/runs/2/approve']);
  assert.ok(approvals.every(event=>event.token==='Bearer actions-approve'));
  assert.ok(events.filter(event=>event.method==='GET').every(event=>event.token==='Bearer read-and-merge'));
  assert.equal(events.filter(event=>event.path.endsWith('/jobs')).length,2);
});

test('moving main base invalidates old green publication evidence',async()=>{
  let frozenReads=0;
  const fetcher=async url=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/files')){frozenReads++;return Response.json(files);}
    if(path.endsWith('/pulls/123')){
      const moved=frozenReads>=1;
      return Response.json(moved?{...pr(),base:{...pr().base,sha:'d'.repeat(40)}}:pr());
    }
    if(path.endsWith('/actions/runs'))return Response.json({workflow_runs:runs().map(run=>({...run,conclusion:'success'}))});
    const jobMatch=path.match(/\/actions\/runs\/(\d+)\/jobs$/);
    if(jobMatch)return Response.json(jobsFor(Number(jobMatch[1])));
    throw Error('Unexpected request '+path);
  };
  await assert.rejects(waitForPublicationChecks({...expected,token:'read',approvalToken:'approve',fetcher}),/publication base changed/);
  assert.equal(frozenReads,2,'file evidence is refreshed on the second frozen-PR validation before old green runs can be accepted');
});

test('green run without complete selected validation is rejected',async()=>{
  const fetcher=async(url,options)=>{
    const path=new URL(url).pathname;
    if(path.endsWith('/files'))return Response.json(files);
    if(path.endsWith('/pulls/123'))return Response.json(pr());
    if(path.endsWith('/actions/runs'))return Response.json({workflow_runs:runs().map(run=>({...run,conclusion:'success'}))});
    if(path.endsWith('/actions/runs/1/jobs'))return Response.json({jobs:[{steps:[]}]});
    if(path.endsWith('/actions/runs/2/jobs'))return Response.json(jobsFor(2));
    throw Error('Unexpected request '+path+' '+options?.method);
  };
  await assert.rejects(waitForPublicationChecks({...expected,token:'read',approvalToken:'approve',fetcher}),/missing validation step/);
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
  if(jobMatch)return Response.json(jobsFor(Number(jobMatch[1])));
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
  assert.equal(reads,1);
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
  assert.equal(reads,1);assert.equal(sleeps,0);
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
