import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyReusableEnvironments} from '../scripts/verify-v5-rebuild-reuse.mjs';

function fixture() {
  const sets=Array.from({length:30},(_,i)=>`set-${i}`),commit='a'.repeat(40),id=37097278712;
  return {sets,currentIdentity:'b'.repeat(64),sourceIdentity:'b'.repeat(64),
    run:{id,repository:{full_name:'killjoy00/mtg-ev-analyzer'},path:'.github/workflows/rebuild-v5-draft-run-corpus.yml',event:'workflow_dispatch',head_branch:'main',head_sha:commit,status:'completed',conclusion:'failure'},
    jobs:{total_count:30,jobs:sets.map(s=>({name:`v5 ${s}`,status:'completed',conclusion:'success'}))},
    artifacts:{total_count:30,artifacts:sets.map((s,i)=>({id:i+1,name:`v5-environment-${s}`,expired:false,size_in_bytes:100,workflow_run:{id,head_sha:commit}}))}};
}
test('a failed finalizer can reuse every successful environment with identical build inputs',()=>{
  const result=verifyReusableEnvironments(fixture());assert.equal(result.length,30);assert.equal(result[0].name,'v5-environment-set-0');
});
test('recovery refuses changed training identity, unreviewed runs and incomplete environment evidence',()=>{
  for(const mutate of [
    x=>x.sourceIdentity='c'.repeat(64),x=>x.run.head_branch='unreviewed',x=>x.run.event='pull_request',
    x=>x.run.repository.full_name='other/repo',x=>x.run.path='.github/workflows/other.yml',
    x=>x.jobs.jobs[0].conclusion='failure',x=>x.jobs.jobs[0].name='v5 unexpected',
    x=>x.jobs.jobs.pop(),x=>x.artifacts.artifacts[0].expired=true,
    x=>x.artifacts.artifacts[0].workflow_run.head_sha='d'.repeat(40),
    x=>x.artifacts.artifacts[0].workflow_run.id=12345,
    x=>x.artifacts.artifacts[0].name=x.artifacts.artifacts[1].name,
  ]){const data=fixture();mutate(data);assert.throws(()=>verifyReusableEnvironments(data));}
});
