// Bounded synthetic baseline/candidate comparison. No Neon, game traffic or
// production Worker changes. Never print CLI output, keys or provider bodies.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {controlRequest} from './control-read.mjs';
const API='https://api.cloudflare.com/client/v4',PREFIX='pack1-quota-probe-';
const modes=['baseline','candidate'];
const assert=(ok,reason)=>{if(!ok)throw Error(reason);};
export function summarizeSamples(values) {
  const sorted=values.toSorted((a,b)=>a-b),at=p=>sorted.length?Math.round(sorted[Math.max(0,Math.ceil(p*sorted.length)-1)]*100)/100:null;
  return {samples:sorted.length,p50_ms:at(.5),p95_ms:at(.95),p99_ms:at(.99),gt_1000ms:sorted.filter(v=>v>1000).length};
}
export function probeName(run,attempt,nonce) {
  assert(/^[0-9]{1,20}$/.test(run||'')&&/^[0-9]{1,3}$/.test(attempt||'')&&/^[a-f0-9]{10}$/.test(nonce||''),'invalid_probe_identity');
  return PREFIX+run+'-'+attempt+'-'+nonce;
}
export async function compareQuota({url,key,fetcher=fetch,clock=performance.now.bind(performance)}={}) {
  const samples=Object.fromEntries(modes.map(m=>[m,{cold:[],warm:[],handler:[],writes:0}]));
  const call=async(mode,cohort,kind='request')=>{
    const began=clock(),r=await fetcher(url+'/'+kind,{method:'POST',redirect:'error',
      headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({mode,cohort}),signal:AbortSignal.timeout(5000)});
    if(![204,429].includes(r.status)) {
      const body=await r.json().catch(()=>null);
      const reason=body?.error==='synthetic_quota_exception'&&['storage_quota','storage_receiver','type_error','reference_error','unclassified'].includes(body.reason)?body.reason:'unclassified_response';
      const code=['sqlite_out_of_memory','storage_reset','provider_internal','transport_reset'].includes(body?.failure_code)?body.failure_code:reason;
      throw Error(`probe_${mode}_http_${r.status}_${code}`);
    }
    const ms=clock()-began,rawTotal=r.headers.get('x-quota-counter-write-total'),rawHandler=r.headers.get('x-pack1-quota-handler-ms');
    const total=Number(rawTotal),handler=Number(rawHandler);
    assert(rawTotal!==null&&rawHandler!==null&&Number.isSafeInteger(total)&&total>=0&&Number.isFinite(handler)&&handler>=0,'missing_probe_evidence');
    await r.body?.cancel();return {status:r.status,total,handler,ms};
  };
  for(let round=0;round<3;round++) {
    const cohort=randomBytes(16).toString('hex'),last={baseline:0,candidate:0};
    const order=round%2?[...modes].reverse():modes;
    for(const mode of order) {
      const r=await call(mode,cohort);assert(r.status===204,'cold_quota_failed');samples[mode].cold.push(r.ms);last[mode]=r.total;
    }
    for(let chunk=0;chunk<8;chunk++)for(const mode of (chunk%2?[...order].reverse():order)) {
      const rows=await Promise.all(Array.from({length:8},()=>call(mode,cohort)));
      assert(rows.every(r=>r.status===204),'warm_quota_failed');
      const total=Math.max(...rows.map(r=>r.total));assert(total>=last[mode],'probe_object_restarted');last[mode]=total;
      samples[mode].warm.push(...rows.map(r=>r.ms));samples[mode].handler.push(...rows.map(r=>r.handler));
    }
    for(const mode of modes)samples[mode].writes+=last[mode];
  }
  // Independently prove exact session and burst ceilings without resetting
  // counters. Separate cohort IDs prevent interaction with latency samples.
  for(const mode of modes)for(const [kind,cap] of [['request',600],['session-only',120]]) {
    const cohort=randomBytes(16).toString('hex'),began=clock();
    // Concurrent batches keep the ten-second burst check bounded in time.
    for(let sent=0;sent<cap;sent+=20) {
      const rows=await Promise.all(Array.from({length:Math.min(20,cap-sent)},()=>call(mode,cohort,kind)));
      assert(rows.every(r=>r.status===204),'premature_probe_denial');
    }
    assert(kind!=='request'||clock()-began<9000,'burst_proof_window_elapsed');
    assert((await call(mode,cohort,kind)).status===429,'probe_limit_not_enforced');
  }
  const summary=Object.fromEntries(modes.map(mode=>[mode,{cold:summarizeSamples(samples[mode].cold),
    warm:summarizeSamples(samples[mode].warm),handler:summarizeSamples(samples[mode].handler),counter_write_decisions:samples[mode].writes}]));
  assert(summary.baseline.counter_write_decisions>=195&&summary.candidate.counter_write_decisions<summary.baseline.counter_write_decisions/2,'write_reduction_unverified');
  return {source:'synthetic-quota-only',...summary,exact_caps_passed:true,
    latency_improved:summary.candidate.handler.p95_ms<summary.baseline.handler.p95_ms,
    limitation:'Short synthetic run from one client region. Write decisions exclude internal provider transaction retries. Does not establish production tail latency, eviction frequency, billing savings or gameplay acceptance.'};
}
function context(env) {
  assert(env.GITHUB_REPOSITORY==='killjoy00/mtg-ev-analyzer'&&env.GITHUB_REF==='refs/heads/main','reviewed_main_required');
  assert(env.CLOUDFLARE_EDGE_TOKEN&&env.RUNNER_TEMP&&env.EDGE_TOOLS_DIR,'probe_capability_missing');
  return path.join(env.RUNNER_TEMP,'quota-benchmark-receipt.json');
}
export async function cleanupProbe({env=process.env,fetcher=fetch}={}) {
  const receipt=context(env);if(!fs.existsSync(receipt))return;
  const row=JSON.parse(fs.readFileSync(receipt)),name=probeName(env.GITHUB_RUN_ID,env.GITHUB_RUN_ATTEMPT,row.nonce);
  assert(row.name===name&&row.owner===env.GITHUB_RUN_ID+'-'+env.GITHUB_RUN_ATTEMPT+'-'+row.nonce&&
    /^[a-f0-9]{32}$/.test(row.account),'probe_receipt_mismatch');
  const base=API+'/accounts/'+row.account+'/workers/scripts/'+name;
  const cf=(route,options={})=>controlRequest(base+route,{provider:'Cloudflare',token:env.CLOUDFLARE_EDGE_TOKEN,fetcher,...options});
  const settings=await cf('/settings',{allow404:true});if(settings===null)return;
  assert(settings.success===true&&settings.result?.bindings?.some(b=>b.name==='PROBE_OWNER'&&b.text===row.owner),'probe_ownership_unverified');
  // The random Worker and both namespaces were created solely by this run.
  // Verify identity before deleting, and verify absence after an ambiguous DELETE.
  try{await cf('?force=true',{method:'DELETE'});}catch{}
  assert(await cf('/settings',{allow404:true})===null,'probe_cleanup_unverified');
  console.log('Synthetic quota Worker cleanup verified.');
}
async function run(env=process.env) {
  const receipt=context(env),nonce=randomBytes(5).toString('hex');
  const name=probeName(env.GITHUB_RUN_ID,env.GITHUB_RUN_ATTEMPT,nonce),owner=env.GITHUB_RUN_ID+'-'+env.GITHUB_RUN_ATTEMPT+'-'+nonce;
  const cf=(url,options={})=>controlRequest(API+url,{provider:'Cloudflare',token:env.CLOUDFLARE_EDGE_TOKEN,...options});
  const zones=await cf('/zones?name=packone.pro&per_page=50');
  assert(zones.success===true&&zones.result?.length===1&&/^[a-f0-9]{32}$/.test(zones.result[0].account?.id),'probe_account_unverified');
  const account=zones.result[0].account.id;
  assert(await cf('/accounts/'+account+'/workers/scripts/'+name+'/settings',{allow404:true})===null,'probe_already_exists');
  const config={name,account_id:account,main:path.resolve('edge/quota-benchmark.mjs'),compatibility_date:'2026-09-01',
    compatibility_flags:['nodejs_compat'],workers_dev:true,preview_urls:false,observability:{enabled:false},
    vars:{PROBE_OWNER:owner,EXPIRES_AT:String(Date.now()+10*60000)},
    durable_objects:{bindings:[{name:'BASELINE_QUOTA',class_name:'BaselineQuota'},{name:'CANDIDATE_QUOTA',class_name:'CandidateQuota'}]},
    migrations:[{tag:'v1',new_sqlite_classes:['BaselineQuota','CandidateQuota']}]};
  const configPath=path.join(env.RUNNER_TEMP,'quota-benchmark-wrangler.json');fs.writeFileSync(configPath,JSON.stringify(config),{mode:0o600});
  fs.writeFileSync(receipt,JSON.stringify({name,account,owner,nonce}),{mode:0o600});
  const cli=(args,input)=>{
    const r=spawnSync(path.join(env.EDGE_TOOLS_DIR,'node_modules/.bin/wrangler'),args,{input,encoding:'utf8',timeout:120000,
      env:{...env,CLOUDFLARE_API_TOKEN:env.CLOUDFLARE_EDGE_TOKEN,WRANGLER_SEND_METRICS:'false'}});
    assert(!r.error&&r.status===0,'probe_cli_failed');return r.stdout;
  };
  const output=cli(['deploy','--config',configPath]);
  const urls=[...output.matchAll(/https:\/\/[a-z0-9.-]+\.workers\.dev/g)].map(m=>m[0]);
  const url=urls.find(value=>new URL(value).hostname.startsWith(name+'.'));
  assert(url,'probe_url_unverified');
  const key=randomBytes(32).toString('hex');
  cli(['secret','bulk','--config',configPath],JSON.stringify({BENCHMARK_KEY:key}));
  // Wait only for deployment propagation, before any quota calls. Retries here
  // cannot repeat an admitted request or conceal a quota/latency failure.
  let ready=false;
  for(let i=0;i<12;i++) {
    const r=await fetch(url+'/invalid',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+key},signal:AbortSignal.timeout(5000)});
    ready=r.status===400;await r.body?.cancel();if(ready)break;
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert(ready,'probe_not_ready');
  assert((await fetch(url+'/request',{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000)})).status===403,'probe_auth_failed');
  const report=await compareQuota({url,key});
  console.log('SYNTHETIC_QUOTA_COMPARISON '+JSON.stringify(report));
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
  const action=process.argv[2];
  try {if(action==='run')await run();else if(action==='cleanup')await cleanupProbe();else throw Error('invalid_probe_action');}
  catch(error){console.error('Synthetic quota comparison failed: '+(/^[a-z0-9_]+$/.test(error.message)?error.message:'details_withheld'));process.exitCode=1;}
}
