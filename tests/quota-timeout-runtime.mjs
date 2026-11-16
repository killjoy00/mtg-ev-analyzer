import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const require=createRequire(path.resolve(process.env.EDGE_TOOLS_DIR,'node_modules/wrangler/package.json'));
const {Miniflare,Log,LogLevel,convertV4MiniflareOptions}=await import(pathToFileURL(require.resolve('miniflare')));
const persist=await mkdtemp(path.join(tmpdir(),'pack1-quota-timeout-')),script=path.join(persist,'probe.mjs');
const key='a'.repeat(64),cohort='b'.repeat(32);
await writeFile(script,await readFile(process.argv[2],'utf8'));
let runtime;
try {
  runtime=new Miniflare(convertV4MiniflareOptions({log:new Log(LogLevel.ERROR),resourcePersistencePath:persist,
    workers:[{name:'timeout-probe',scriptPath:script,rootPath:persist,modulesRoot:persist,modules:true,
      compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],
      bindings:{BENCHMARK_KEY:key,EXPIRES_AT:String(Date.now()+600000)},
      durableObjects:{BASELINE_QUOTA:{className:'BaselineQuota',useSQLite:true},
        CONTROL_QUOTA:{className:'ControlQuota',useSQLite:true},
        CANDIDATE_QUOTA:{className:'CandidateQuota',useSQLite:true},
        PAIRED_QUOTA:{className:'CrossoverQuota',useSQLite:true}}}]}));
  const call=async(route,body)=>{
    const response=await runtime.dispatchFetch('https://synthetic.invalid'+route,{method:'POST',
      headers:{authorization:'Bearer '+key,'content-type':'application/json'},
      body:JSON.stringify(body)});
    assert.equal(response.status,200);
    return response.json();
  };
  const normal=await call('/timeout-probe',{scenario:'normal',cohort});
  assert.equal(normal.outcome,'success');assert.equal(normal.attempts,1);
  assert.equal(normal.handler_timing_observed,true);
  const before=await call('/timeout-inspect',{cohort});
  assert.equal(before.request_count,1);
  const after=await call('/timeout-inspect',{cohort});
  assert.equal(after.request_count,1,'read-only inspection must not debit quota');
  console.log('Isolated Workers/SQLite quota timeout probe normal path and read-only counter inspection passed.');
} finally {await runtime?.dispose();await rm(persist,{recursive:true,force:true});}
