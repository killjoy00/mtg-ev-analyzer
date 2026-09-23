// A reviewed main-branch request can dispatch only these existing workflows.
// Credentials, arbitrary workflow paths, refs and shell commands are never inputs.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

export function rolloutDispatch(request) {
  const {operation,reason,request_id,corpus_version,commit,sets,target,action,source,first_environment,measurement_mode,measurement_samples}=request||{};
  const common=['operation','reason','request_id'];
  if(typeof reason!=='string'||!reason.trim()||!/^[-a-zA-Z0-9]+$/.test(request_id||''))throw Error('A named rollout request and reason are required.');
  let workflow,inputs={},extra=[];
  if(operation==='regenerate') {
    if(!/^elite-trophy-[a-z0-9-]+-v[0-9]+$/.test(corpus_version||''))throw Error('Invalid corpus version.');
    workflow='regenerate-draft-run-corpus.yml';inputs={corpus_version};extra=['corpus_version'];
  } else if(operation==='rebuild-v4') {
    workflow='rebuild-v4-draft-run-corpus.yml';
  } else if(operation==='import') {
    if(!/^(all|[a-z0-9-]+(?:,[a-z0-9-]+)*)$/.test(sets||'')||!['build-only','development','production'].includes(target))throw Error('Invalid import request.');
    workflow='import-all-trophies.yml';inputs={sets,target};extra=['sets','target'];
  } else if(operation==='prepare-rebuild') {
    if(!['development','production'].includes(target))throw Error('Invalid staging target.');
    workflow='prepare-rebuild.yml';inputs={target};extra=['target'];
  } else if(operation==='puzzle-components') {
    if(!['development','production'].includes(target)||!['stage','publish'].includes(action)||!['powered-cube','regular-study','regular-phase2'].includes(source))throw Error('Invalid source release request.');
    workflow='publish-puzzle-components.yml';inputs={target,action,source};extra=['target','action','source'];
  } else if(operation==='corpus-health') {
    if(!['development','production'].includes(target))throw Error('Invalid health target.');
    workflow='corpus-health.yml';inputs={target};extra=['target'];
  } else if(operation==='frozen-scoring') {
    workflow='frozen-scoring.yml';
  } else if(operation==='format-research') {
    workflow='format-research.yml';
  } else if(operation==='traditional-puzzles') {
    workflow='traditional-puzzles.yml';
  } else if(operation==='audit-frozen-outcomes') {
    workflow='audit-frozen-outcomes.yml';
  } else if(operation==='patreon-discovery') {
    workflow='patreon-reconcile.yml';inputs={mode:'discover'};
  } else if(operation==='patreon-sync') {
    workflow='patreon-reconcile.yml';inputs={mode:'sync'};
  } else if(operation==='production-browser') {
    workflow='production-browser.yml';
    if(first_environment!==undefined||measurement_mode!==undefined||measurement_samples!==undefined) {
      const samples=measurement_samples===undefined?1:measurement_samples;
      if(!['mixed','powered-cube','latest','all'].includes(first_environment)||typeof measurement_mode!=='boolean'||![1,2,3].includes(samples))throw Error('Invalid production browser measurement request.');
      if(first_environment==='all'&&!measurement_mode)throw Error('All-environment browser runs are measurement-only.');
      inputs={first_environment,measurement_mode:measurement_mode?'true':'false',measurement_samples:String(samples)};
      extra=['first_environment','measurement_mode',...(measurement_samples===undefined?[]:['measurement_samples'])];
    }
  } else if(operation==='daily-generation') {
    if(!['development','production'].includes(target))throw Error('Invalid Daily generation target.');
    workflow='daily-generation.yml';inputs={target};extra=['target'];
  } else if(operation==='daily-calendar-migration') {
    if(!/^[a-f0-9]{40}$/.test(commit||'')||!['development','production'].includes(target))throw Error('Invalid Daily calendar migration request.');
    workflow='daily-calendar-migration.yml';inputs={commit,target};extra=['commit','target'];
  } else if(operation==='card-images') {
    workflow='refresh-powered-cube-images.yml';
  } else if(operation==='card-image-release') {
    if(!/^[a-f0-9]{40}$/.test(commit||''))throw Error('Invalid card-image release request.');
    workflow='card-image-release.yml';inputs={commit};extra=['commit'];
  } else if(operation==='browser') {
    workflow='e2e.yml';
  } else if(operation==='deploy') {
    if(!/^[a-f0-9]{40}$/.test(commit||'')||!['development','production'].includes(target))throw Error('Invalid release request.');
    workflow='deploy-functions.yml';inputs={commit,target};extra=['commit','target'];
  } else throw Error('Unsupported rollout operation.');
  if(Object.keys(request).some(key=>![...common,...extra].includes(key)))throw Error('Unexpected rollout input.');
  return {workflow,body:{ref:'main',inputs}};
}

async function main() {
  if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer')throw Error('Rollouts must be requested on this repository’s main branch.');
  const request=JSON.parse(fs.readFileSync('.github/model-rollout-request.json','utf8'));
  const {workflow,body}=rolloutDispatch(request);
  const response=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/${workflow}/dispatches`,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{authorization:`Bearer ${process.env.GH_TOKEN}`,'content-type':'application/json','accept':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'},
    body:JSON.stringify(body),
  });
  if(!response.ok)throw Error(`Workflow dispatch failed (${response.status}).`);
  const result=response.status===204?{}:await response.json();
  console.log(JSON.stringify({request_id:request.request_id,workflow,...result}));
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)await main();
