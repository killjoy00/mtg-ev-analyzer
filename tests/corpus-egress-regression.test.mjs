import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {routeAlert,thresholds} from '../scripts/launch-alert.mjs';

// Execute the checked-in workflow's actual shell, not a rewritten model of its
// guard. Stub only the expensive subprocesses; an unexpected invocation fails.
function healthStep() {
 const workflow=fs.readFileSync(new URL('../.github/workflows/corpus-operations.yml',import.meta.url),'utf8');
 const step=workflow.split('      - name: Verify newly ingested Candidate health\n')[1]?.split('\n      - ')[0];
 const run=step?.split('        run: |\n')[1];assert.ok(run,'Health step must remain testable');
 return run.split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
}
function runStep({pending='',validated,target='production'}={}) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'corpus-egress-'));
 try {
  fs.mkdirSync(path.join(dir,'generated/corpus-operations'),{recursive:true});fs.mkdirSync(path.join(dir,'bin'));
  fs.writeFileSync(path.join(dir,'generated/corpus-operations/pending.txt'),pending);
  if(validated!==undefined)fs.writeFileSync(path.join(dir,'generated/corpus-operations/validated-sets.txt'),validated);
  const calls=path.join(dir,'calls.jsonl');
  fs.writeFileSync(path.join(dir,'bin/node'),`#!${process.execPath}\nrequire('node:fs').appendFileSync(process.env.EGRESS_CALLS,JSON.stringify(process.argv.slice(2))+'\\n');\n`,{mode:0o700});
  const stdout=execFileSync('bash',['-e','-u','-o','pipefail','-c',healthStep()],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:path.join(dir,'bin')+path.delimiter+process.env.PATH,EGRESS_CALLS:calls,TARGET:target,RUNNER_TEMP:'/fixture'}});
  return {stdout,calls:fs.existsSync(calls)?fs.readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse):[]};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('no-op corpus discovery invokes neither payload health nor gameplay canary',()=>{
 for(const target of ['development','production']){const result=runStep({target});assert.deepEqual(result.calls,[]);assert.match(result.stdout,/skipping deep payload health scan/);}
});
test('production health receives only the validated set IDs, not a stale pending list',()=>{
 assert.deepEqual(runStep({pending:'unrelated',validated:'set-a,set-b'}).calls,[['scripts/check-corpus-health.mjs','/fixture/corpus.connection','set-a','set-b']]);
});
test('development keeps scoped validation and its necessary gameplay canary',()=>{
 assert.deepEqual(runStep({pending:'set-a',target:'development'}).calls,[['scripts/check-corpus-health.mjs','/fixture/corpus.connection','set-a'],['scripts/candidate-gameplay-canary.mjs','/fixture/corpus.connection']]);
});
test('a long-lived legacy usage warning does not suppress new error or latency incidents',async()=>{
 const writes=[];
 const fetcher=async(url,options)=>{
  if(options.method==='GET')return Response.json([{number:541,title:'[launch alert] Production capacity needs attention',body:'"neon_egress_billing_period_usage"'}]);
  writes.push(JSON.parse(options.body));return Response.json({number:1000+writes.length});
 };
 const result=await routeAlert(fetcher,{GITHUB_REPOSITORY:'fixture/repo',GITHUB_TOKEN:'fixture'},{alerts:['neon_egress_billing_period_usage','gateway_5xx','slow_requests']});
 assert.equal(result,'created');assert.equal(writes.length,2);assert.ok(writes.some(w=>w.title.endsWith('(gateway_5xx)')));assert.ok(writes.some(w=>w.title.endsWith('(slow_requests)')));
 assert.equal('egress_bytes_per_day' in thresholds,false);assert.equal(thresholds.egress_bytes_per_billing_period,50*1024**3);
});
