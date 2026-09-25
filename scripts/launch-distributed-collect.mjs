import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {unseal} from './launch-distributed-bundle.mjs';
import {summarize} from './practice-performance.mjs';
const target=Number(process.env.LOAD_TARGET),generators=target===25?5:20;
assert.ok([25,100,500,1000].includes(target));
const directory='artifacts/distributed-results';
const files=(fs.existsSync(directory)?fs.readdirSync(directory,{recursive:true}):[]).filter(n=>new RegExp('distributed-'+target+'-\\d+\\.json$').test(n));
const reports=files.map(n=>JSON.parse(fs.readFileSync(path.join(directory,n),'utf8')));
const policy=JSON.parse(fs.readFileSync('scripts/launch-load-policy.json','utf8'));
const requests=reports.flatMap(r=>r.stages.flatMap(s=>s.requests));
const networks=reports.map(r=>unseal(r.egress).network);
const identityVerified=networks.every(n=>/^[a-f0-9]{64}$/.test(n||''))&&new Set(networks).size===generators;
const summary={target,generators,received_generators:reports.length,distinct_real_egress:identityVerified?generators:null,
  code_sha:process.env.GITHUB_SHA,completed:reports.reduce((n,r)=>n+r.stages[0].completed,0),requests:requests.length,
  statuses:Object.fromEntries([...new Set(requests.map(r=>r.status))].map(s=>[s,requests.filter(r=>r.status===s).length])),routes:{},passed:false};
for(const route of Object.keys(policy.route_budgets_ms))summary.routes[route]=summarize(requests.filter(r=>r.route===route).map(r=>r.ms));
summary.passed=reports.length===generators&&new Set(reports.map(r=>r.generator)).size===generators&&
  reports.every(r=>r.sha===process.env.GITHUB_SHA&&r.passed&&r.stages[0].arrival_delay.p99_ms<=5000)&&identityVerified&&summary.completed===target&&
  requests.filter(r=>r.status<200||r.status>=400).length/Math.max(1,requests.length)<=policy.maximum_error_fraction&&
  !summary.statuses[429]&&Object.entries(summary.routes).every(([route,s])=>!s.samples||s.p95_ms<=policy.route_budgets_ms[route].p95&&s.p99_ms<=policy.route_budgets_ms[route].p99);
fs.mkdirSync('artifacts/launch-load',{recursive:true});
fs.writeFileSync('artifacts/launch-load/distributed-stage-'+target+'.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));
if(summary.passed&&target!==1000)fs.appendFileSync(process.env.GITHUB_OUTPUT,'start_at='+(Date.now()+150000)+'\n');
if(!summary.passed)process.exitCode=1;
