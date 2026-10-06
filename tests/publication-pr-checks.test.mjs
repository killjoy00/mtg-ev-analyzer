import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePublicationPr,requiredPublicationRuns,waitForPublicationChecks} from '../.github/scripts/publication-pr-checks.mjs';

const expected={repo:'owner/repo',branch:'automation/creator-challenge-fixture-op',headSha:'a'.repeat(40),slug:'fixture',kind:'creator',prNumber:123};
const pr=()=>({number:123,state:'open',base:{ref:'main',repo:{full_name:expected.repo}},
  head:{ref:expected.branch,sha:expected.headSha,repo:{full_name:expected.repo}},user:{login:'github-actions[bot]'}});
const files=[{filename:'creator-challenges.json'},{filename:'creator/fixture/index.html'},{filename:'creator/fixture/creator-card.png'}];
const runs=()=>['test','e2e'].map((name,index)=>({id:index+1,path:'.github/workflows/'+name+'.yml',
  event:'pull_request',head_sha:expected.headSha,head_branch:expected.branch,head_repository:{full_name:expected.repo},
  pull_requests:[{number:123}],status:'completed',conclusion:'action_required',html_url:'https://github.com/owner/repo/actions/runs/'+(index+1)}));

test('publication approval is confined to the generated same-repo static diff and frozen head',()=>{
  validatePublicationPr(pr(),files,expected);
  for(const wrong of [ {...pr(),head:{...pr().head,sha:'b'.repeat(40)}},
    {...pr(),head:{...pr().head,repo:{full_name:'attacker/fork'}}},
    {...pr(),state:'closed'}, {...pr(),user:{login:'untrusted'}} ])
    assert.throws(()=>validatePublicationPr(wrong,files,expected));
  assert.throws(()=>validatePublicationPr(pr(),[{filename:'worker/index.js'}],expected));
  assert.throws(()=>validatePublicationPr(pr(),[{filename:'creator/other/index.html'}],expected));
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

test('only exact PR runs are approved with Actions token, then both real checks must succeed',async()=>{
  const events=[];let polls=0;
  const fetcher=async(url,options)=>{
    const path=new URL(url).pathname;
    events.push({path,method:options.method,token:options.headers.authorization});
    if(path.endsWith('/approve'))return new Response(null,{status:201});
    if(path.endsWith('/files'))return Response.json(files);
    if(path.endsWith('/pulls/123'))return Response.json(pr());
    if(path.endsWith('/actions/runs'))return Response.json({workflow_runs:runs().map(run=>({...run,conclusion:polls?'success':'action_required'}))});
    throw Error('Unexpected request');
  };
  const result=await waitForPublicationChecks({...expected,token:'read-and-merge',approvalToken:'actions-approve',fetcher,sleep:async()=>{polls++;}});
  assert.equal(result.length,2);
  const approvals=events.filter(event=>event.method==='POST');
  assert.deepEqual(approvals.map(event=>event.path),['/repos/owner/repo/actions/runs/1/approve','/repos/owner/repo/actions/runs/2/approve']);
  assert.ok(approvals.every(event=>event.token==='Bearer actions-approve'));
  assert.ok(events.filter(event=>event.method==='GET').every(event=>event.token==='Bearer read-and-merge'));
});

test('a genuine PR check failure stops publication without replacing its outcome',async()=>{
  const fetcher=async(url)=>new URL(url).pathname.endsWith('/files')?Response.json(files)
    :new URL(url).pathname.endsWith('/pulls/123')?Response.json(pr())
      :Response.json({workflow_runs:runs().map(run=>({...run,conclusion:'failure'}))});
  await assert.rejects(waitForPublicationChecks({...expected,token:'read',approvalToken:'approve',fetcher}),/Required PR check failed/);
});
