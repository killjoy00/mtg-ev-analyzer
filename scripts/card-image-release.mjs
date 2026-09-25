import {pathToFileURL} from 'node:url';

const REPO='killjoy00/mtg-ev-analyzer';
const PLAN=[
  {
    workflow:'deploy-functions.yml',
    label:'development deploy',
    inputs:commit=>({target:'development',commit}),
    title:commit=>'deploy development '+commit,
  },
  {
    workflow:'deploy-functions.yml',
    label:'production deploy',
    inputs:commit=>({target:'production',commit}),
    title:commit=>'deploy production '+commit,
  },
  {
    workflow:'refresh-powered-cube-images.yml',
    label:'card-image refresh',
    inputs:commit=>({request_id:'release-'+commit.slice(0,12),code_commit:commit}),
    title:commit=>'refresh Pack One card images / release-'+commit.slice(0,12),
  },
];

export function releasePlan(commit) {
  if(!/^[a-f0-9]{40}$/.test(commit||''))throw Error('A full reviewed main commit SHA is required.');
  return PLAN.map(step=>({workflow:step.workflow,label:step.label,inputs:step.inputs(commit),title:step.title(commit)}));
}

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

async function github(path,options={}) {
  const response=await fetch('https://api.github.com/repos/'+REPO+path,{
    ...options,
    redirect:'error',
    signal:AbortSignal.timeout(30000),
    headers:{
      authorization:'Bearer '+process.env.GH_TOKEN,
      accept:'application/vnd.github+json',
      'content-type':'application/json',
      'X-GitHub-Api-Version':'2026-03-10',
      ...(options.headers||{}),
    },
  });
  if(!response.ok)throw Error('GitHub API '+response.status+' for '+path);
  if(response.status===204)return {};
  return response.json();
}

async function workflowRuns(workflow) {
  const data=await github('/actions/workflows/'+encodeURIComponent(workflow)+'/runs?branch=main&event=workflow_dispatch&per_page=20');
  return Array.isArray(data.workflow_runs)?data.workflow_runs:[];
}

export async function dispatchAndWait(workflow,inputs,label,title,{pollMs=10000,discoverAttempts=30,completeAttempts=720}={}) {
  const before=await workflowRuns(workflow);
  const beforeIds=new Set(before.map(run=>run.id));
  await github('/actions/workflows/'+encodeURIComponent(workflow)+'/dispatches',{
    method:'POST',
    body:JSON.stringify({ref:'main',inputs}),
  });
  let run=null;
  for(let attempt=0;attempt<discoverAttempts;attempt++) {
    await sleep(pollMs);
    const runs=await workflowRuns(workflow);
    run=runs.find(candidate=>!beforeIds.has(candidate.id)&&candidate.display_title===title)||null;
    if(run)break;
  }
  if(!run)throw Error('Could not identify dispatched '+label+' workflow run.');
  for(let attempt=0;attempt<completeAttempts;attempt++) {
    const current=await github('/actions/runs/'+run.id);
    if(current.status==='completed') {
      if(current.conclusion!=='success')throw Error(label+' failed: '+String(current.conclusion||'unknown'));
      console.log(JSON.stringify({label,workflow,run_id:run.id,conclusion:current.conclusion}));
      return current;
    }
    await sleep(pollMs);
  }
  throw Error(label+' exceeded orchestration wait budget.');
}

export async function runRelease(commit) {
  if(process.env.GITHUB_REPOSITORY!==REPO||process.env.GITHUB_REF!=='refs/heads/main')throw Error('Card-image release must run from reviewed main.');
  if(!process.env.GH_TOKEN)throw Error('GH_TOKEN is required.');
  for(const step of releasePlan(commit))await dispatchAndWait(step.workflow,step.inputs,step.label,step.title);
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)await runRelease(process.argv[2]);
