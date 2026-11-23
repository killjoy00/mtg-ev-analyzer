import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const approved=JSON.parse(readFileSync('.github/pack-one-approved-six-screenshots.json','utf8'));
const artifacts=approved.sourceArtifacts;
if(!Array.isArray(artifacts)||artifacts.length!==5)throw Error('Exactly five pinned native source artifacts required');
const repo=process.env.GITHUB_REPOSITORY;
if(!repo||!process.env.GH_TOKEN)throw Error('GitHub read-only Actions credentials required');
const api=path=>JSON.parse(execFileSync('gh',['api',path],{encoding:'utf8'}));
const validated=new Set();
for(const item of artifacts){
  const a=api('/repos/'+repo+'/actions/artifacts/'+item.id);
  if(a.id!==item.id||a.name!==item.name||a.expired||a.digest!==item.digest||a.workflow_run?.id!==item.run){
    throw Error('Artifact digest/name/run mismatch or expiration: '+item.id);
  }
  const r=api('/repos/'+repo+'/actions/runs/'+item.run);
  if(r.id!==item.run||r.event!=='push'||r.head_branch!=='main'||r.conclusion!=='success'||r.path!=='.github/workflows/mobile-store-screenshots.yml'){
    throw Error('Not a successful main-source native capture: '+item.run);
  }
  validated.add(item.id);
}
console.log('Verified '+validated.size+' immutable native screenshot source artifacts.');
