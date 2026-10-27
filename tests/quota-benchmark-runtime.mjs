import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {compareQuota} from '../scripts/quota-benchmark.mjs';
const require=createRequire(path.resolve(process.env.EDGE_TOOLS_DIR,'node_modules/wrangler/package.json'));
const {Miniflare,Log,LogLevel,convertV4MiniflareOptions}=await import(pathToFileURL(require.resolve('miniflare')));
const persist=await mkdtemp(path.join(tmpdir(),'pack1-quota-probe-')),script=path.join(persist,'probe.mjs');
const now=Date.now(),key='a'.repeat(64);
await writeFile(script,`Date.now=()=>${now};\n`+await readFile(process.argv[2],'utf8'));
let runtime;
try {
  runtime=new Miniflare(convertV4MiniflareOptions({log:new Log(LogLevel.ERROR),resourcePersistencePath:persist,
    workers:[{name:'quota-probe',scriptPath:script,rootPath:persist,modulesRoot:persist,modules:true,
      compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],
      bindings:{BENCHMARK_KEY:key,EXPIRES_AT:String(now+600000)},
      durableObjects:{BASELINE_QUOTA:{className:'BaselineQuota',useSQLite:true},CANDIDATE_QUOTA:{className:'CandidateQuota',useSQLite:true}}}]}));
  const report=await compareQuota({url:'https://synthetic.invalid',key,fetcher:(url,options)=>runtime.dispatchFetch(url,options)});
  assert.equal(report.exact_caps_passed,true);
  assert.equal(report.baseline.counter_write_decisions,195);assert.equal(report.candidate.counter_write_decisions,27);
  console.log('Real Workers/SQLite synthetic probe: authenticated routing, instrumented writes and exact ceilings passed.');
} finally {await runtime?.dispose();await rm(persist,{recursive:true,force:true});}
