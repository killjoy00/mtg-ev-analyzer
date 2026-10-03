import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const REPOSITORY='killjoy00/mtg-ev-analyzer';
export function verifyReusableEnvironments({run,jobs,artifacts,sets,currentIdentity,sourceIdentity}) {
  if(run.repository?.full_name!==REPOSITORY||run.path!=='.github/workflows/rebuild-v5-draft-run-corpus.yml'||
     run.event!=='workflow_dispatch'||run.head_branch!=='main'||run.status!=='completed'||
     !/^[a-f0-9]{40}$/.test(run.head_sha||''))throw Error('Only a completed reviewed main v5 rebuild can supply environments.');
  if(!/^[a-f0-9]{64}$/.test(currentIdentity)||sourceIdentity!==currentIdentity)throw Error('Environment build identity changed; artifacts cannot be relabeled.');
  if(sets.length!==30||new Set(sets).size!==30)throw Error('Expected the exact 30-environment plan.');
  if(jobs.total_count!==jobs.jobs.length||artifacts.total_count!==artifacts.artifacts.length)throw Error('Incomplete workflow provenance response.');
  const expected=new Set(sets.map(s=>`v5 ${s}`)),environmentJobs=jobs.jobs.filter(j=>j.name.startsWith('v5 '));
  if(environmentJobs.length!==sets.length||new Set(environmentJobs.map(j=>j.name)).size!==sets.length||
     environmentJobs.some(j=>!expected.has(j.name)||j.status!=='completed'||j.conclusion!=='success'))throw Error('Every expected environment job must have succeeded.');
  const byName=new Map(artifacts.artifacts.map(a=>[a.name,a]));
  if(byName.size!==artifacts.artifacts.length)throw Error('Ambiguous environment artifacts.');
  return sets.map(s=>{
    const a=byName.get(`v5-environment-${s}`);
    if(!a||a.expired||!(a.size_in_bytes>0)||String(a.workflow_run?.id)!==String(run.id)||a.workflow_run?.head_sha!==run.head_sha)throw Error(`Missing or mismatched exact environment artifact: ${s}`);
    return {id:a.id,name:a.name,size_in_bytes:a.size_in_bytes,digest:a.digest??null};
  });
}

function main(reuseRun) {
  if(process.env.GITHUB_REPOSITORY!==REPOSITORY)throw Error('Unexpected repository.');
  const source={schema:'v5-environment-origin-v1',environment_run_id:process.env.GITHUB_RUN_ID,
    environment_commit:process.env.GITHUB_SHA,build_identity:process.env.V5_BUILD_ID,artifacts:[]};
  if(!/^[1-9][0-9]{4,20}$/.test(source.environment_run_id||'')||!/^[a-f0-9]{40}$/.test(source.environment_commit||'')||!/^[a-f0-9]{64}$/.test(source.build_identity||''))throw Error('Missing reviewed build provenance.');
  if(reuseRun) {
    if(!/^[1-9][0-9]{4,20}$/.test(reuseRun)||reuseRun===source.environment_run_id)throw Error('Invalid source rebuild run.');
    const api=suffix=>JSON.parse(execFileSync('gh',['api',`repos/${REPOSITORY}/actions/runs/${reuseRun}${suffix}`],{encoding:'utf8',maxBuffer:8*1024*1024}));
    const run=api(''),jobs=api('/jobs?per_page=100'),artifacts=api('/artifacts?per_page=100');
    if(!/^[a-f0-9]{40}$/.test(run.head_sha||''))throw Error('Invalid source commit.');
    execFileSync('git',['merge-base','--is-ancestor',run.head_sha,'HEAD']);
    const checkout=fs.mkdtempSync(path.join(os.tmpdir(),'v5-source-'));
    let sourceIdentity;
    try {
      execFileSync('git',['worktree','add','--detach',checkout,run.head_sha],{stdio:'pipe'});
      sourceIdentity=execFileSync('python',['scripts/v5_rebuild.py','identity'],{cwd:checkout,encoding:'utf8'}).trim();
    } finally {
      execFileSync('git',['worktree','remove','--force',checkout],{stdio:'pipe'});
    }
    source.artifacts=verifyReusableEnvironments({run,jobs,artifacts,sets:JSON.parse(fs.readFileSync('research/v5-build-source-pins.json','utf8')).sets.map(s=>s.id).sort(),currentIdentity:source.build_identity,sourceIdentity});
    source.environment_run_id=String(run.id);source.environment_commit=run.head_sha;
  }
  fs.mkdirSync('generated',{recursive:true});
  fs.writeFileSync('generated/v5-environment-origin.json',JSON.stringify(source,null,2)+'\n');
  fs.appendFileSync(process.env.GITHUB_OUTPUT,`environment_run_id=${source.environment_run_id}\nenvironment_commit=${source.environment_commit}\n`);
  console.log(JSON.stringify(source));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv[2]||'');
