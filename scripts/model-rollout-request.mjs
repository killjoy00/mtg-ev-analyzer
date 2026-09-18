// A reviewed main-branch request can dispatch only these existing workflows.
// Credentials, arbitrary workflow paths, refs and shell commands are never inputs.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

export function rolloutDispatch(request) {
  const {operation,reason,request_id,corpus_version,commit,sets,target}=request||{};
  const common=['operation','reason','request_id'];
  if(typeof reason!=='string'||!reason.trim()||!/^[-a-zA-Z0-9]+$/.test(request_id||''))throw Error('A named rollout request and reason are required.');
  let workflow,inputs={},extra=[];
  if(operation==='regenerate') {
    if(!/^elite-trophy-[a-z0-9-]+-v[0-9]+$/.test(corpus_version||''))throw Error('Invalid corpus version.');
    workflow='regenerate-draft-run-corpus.yml';inputs={corpus_version};extra=['corpus_version'];
  } else if(operation==='import') {
    if(!/^(all|[a-z0-9-]+(?:,[a-z0-9-]+)*)$/.test(sets||'')||!['build-only','development','production'].includes(target))throw Error('Invalid import request.');
    workflow='import-all-trophies.yml';inputs={sets,target};extra=['sets','target'];
  } else if(operation==='prepare-rebuild') {
    if(!['development','production'].includes(target))throw Error('Invalid staging target.');
    workflow='prepare-rebuild.yml';inputs={target};extra=['target'];
  } else if(operation==='frozen-scoring') {
    workflow='frozen-scoring.yml';
  } else if(operation==='format-research') {
    workflow='format-research.yml';
  } else if(operation==='traditional-puzzles') {
    workflow='traditional-puzzles.yml';
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
