import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {compareQuota,verifyProbeAuth} from '../scripts/quota-benchmark.mjs';
import {confirmQuotaLatency} from '../scripts/quota-latency-confirmation.mjs';
const require=createRequire(path.resolve(process.env.EDGE_TOOLS_DIR,'node_modules/wrangler/package.json'));
const {Miniflare,Log,LogLevel,convertV4MiniflareOptions}=await import(pathToFileURL(require.resolve('miniflare')));
const persist=await mkdtemp(path.join(tmpdir(),'pack1-quota-probe-')),script=path.join(persist,'probe.mjs');
const now=Date.now(),key='a'.repeat(64);
await writeFile(script,await readFile(process.argv[2],'utf8'));
let runtime;
try {
  runtime=new Miniflare(convertV4MiniflareOptions({log:new Log(LogLevel.ERROR),resourcePersistencePath:persist,
    workers:[{name:'quota-probe',scriptPath:script,rootPath:persist,modulesRoot:persist,modules:true,
      compatibilityDate:'2026-09-01',compatibilityFlags:['nodejs_compat'],
      bindings:{BENCHMARK_KEY:key,EXPIRES_AT:String(now+600000)},
      durableObjects:{BASELINE_QUOTA:{className:'BaselineQuota',useSQLite:true},CONTROL_QUOTA:{className:'ControlQuota',useSQLite:true},CANDIDATE_QUOTA:{className:'CandidateQuota',useSQLite:true}}}]}));
  await verifyProbeAuth(await runtime.dispatchFetch('https://synthetic.invalid/request',{method:'POST'}));
  const report=await compareQuota({url:'https://synthetic.invalid',key,extended:true,fetcher:(url,options)=>runtime.dispatchFetch(url,options)});
  assert.equal(report.exact_caps_passed,true);
  assert.equal(report.baseline.counter_write_decisions,1032);assert.equal(report.candidate.counter_write_decisions,136);
  assert.equal(report.requests,9157);assert.equal(report.shared_network.candidate.admitted,2100);
  assert.equal(report.restarts.baseline.admitted,120);assert.equal(report.restarts.candidate.admitted,117);
  assert.equal(report.quiet.expired_credit_cap_passed,true);
  const confirmation=await confirmQuotaLatency({url:'https://synthetic.invalid',key,fetcher:(url,options)=>runtime.dispatchFetch(url,options)});
  assert.equal(confirmation.requests,8256);assert.equal(confirmation.repetitions.length,4);
  for(const repeat of confirmation.repetitions) {
    assert.equal(repeat.counter_write_decisions.baseline,1032);
    assert.equal(repeat.counter_write_decisions.right,repeat.comparison==='aa'?1032:136);
  }
  console.log('Real Workers/SQLite probe: authenticated routing, paced shared networks, expiry, three real resets and exact ceilings passed.');
  console.log('Real Workers/SQLite confirmation: separate identical controls, fixed A/A and A/B sequence, implementations, counters and complete coverage passed.');
} finally {await runtime?.dispose();await rm(persist,{recursive:true,force:true});}
