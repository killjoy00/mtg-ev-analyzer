// Isolated, bounded timeout/abort/acknowledgement reproducer for #1273.
// Uses only the run-owned, authenticated synthetic Cloudflare Worker.
// No Pack One application host, production quota binding, or real player data.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {runProbe} from './quota-benchmark.mjs';

export const TIMEOUT_PLAN=['normal','dispatch_timeout','client_abort','handler_entry_timeout','ack_timeout'];
const COUNTS={normal:1,dispatch_timeout:0,client_abort:0,ack_timeout:1};
const OUTCOMES={normal:'success',dispatch_timeout:'timeout',
  client_abort:'abort',handler_entry_timeout:'timeout',ack_timeout:'timeout'};

export async function reproduceQuotaTimeouts({url,key,fetcher=fetch,
  wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),repeats=2}={}){
  assert(Number.isInteger(repeats)&&repeats>=1&&repeats<=2,'invalid_repro_plan');
  assert(typeof url==='string'&&url.startsWith('https://')&&/^[a-f0-9]{64}$/.test(key||''),'invalid_repro_access');
  const results=[];let requests=0;
  const call=async(path,body)=>{
    assert(++requests<=20,'repro_request_budget_exceeded');
    let response;
    try {
      response=await fetcher(url+path,{method:'POST',redirect:'error',
        headers:{authorization:'Bearer '+key,'content-type':'application/json'},
        body:JSON.stringify(body),signal:AbortSignal.timeout(8500)});
    } catch {throw Error('repro_transport_failure');}
    assert(response.status===200,'repro_endpoint_status');
    const data=await response.json().catch(()=>null);
    assert(data&&typeof data==='object'&&!Array.isArray(data),'invalid_repro_response');
    // response.json() already consumed the body; canceling its locked stream
    // would throw ERR_INVALID_STATE and hide the actual probe result.
    return data;
  };
  for(let repeat=1;repeat<=repeats;repeat++){
    for(const scenario of TIMEOUT_PLAN){
      const cohort=randomBytes(16).toString('hex');
      const sample=await call('/timeout-probe',{scenario,cohort});
      assert(sample.scenario===scenario&&sample.outcome===OUTCOMES[scenario]&&
        sample.attempts===1&&Number.isSafeInteger(sample.elapsed_ms)&&sample.elapsed_ms>=0&&
        sample.elapsed_ms<=8500&&typeof sample.handler_timing_observed==='boolean',
        'incorrect_timeout_classification');
      if(scenario==='normal')assert(sample.handler_timing_observed,'normal_handler_timing_missing');
      if(scenario!=='normal')assert(!sample.handler_timing_observed,'timeout_timing_unexpected');
      // Let intentionally delayed DO entry/ack settle before inspecting. The
      // inspection is a GET of synthetic DO storage, not another quota debit.
      if(scenario==='handler_entry_timeout'||scenario==='ack_timeout')await wait(700);
      const snapshot=await call('/timeout-inspect',{cohort});
      assert(Object.keys(snapshot).length===1&&Number.isSafeInteger(snapshot.request_count)&&
        snapshot.request_count>=0&&snapshot.request_count<=1,'synthetic_counter_invalid');
      if(Object.hasOwn(COUNTS,scenario))
        assert(snapshot.request_count===COUNTS[scenario],'synthetic_debit_invariant_failed');
      results.push({repeat,scenario,outcome:sample.outcome,attempts:sample.attempts,
        elapsed_ms:sample.elapsed_ms,handler_timing_observed:sample.handler_timing_observed,
        stored_debits:snapshot.request_count});
    }
  }
  assert(requests===repeats*TIMEOUT_PLAN.length*2,'incomplete_repro_coverage');
  return {source:'synthetic-quota-only',profile:'five-second-fault-stage-v1',
    repeats,requests,deadline_ms:5000,scenario_results:results,
    verified:{no_dispatch_no_debit:true,aborted_dispatch_no_debit:true,
      acknowledged_success_debited_once:true,unacknowledged_committed_debit_not_retried:true,
      handler_entry_timeout_not_assumed_uncommitted:true},
    production_ready:false,
    interpretation:'Controlled delays show how the unchanged five-second gateway quota deadline can produce missing handler timing on pre-dispatch timeouts and on post-handler acknowledgment waits. A timed-out quota call may still have a confirmed stored debit; automatic retries are unsafe. Handler entry after a timeout is observational only. This does NOT attribute live #1273 to any one mechanism.',
    limitation:'Disposable single-region synthetic DOs with deliberately injected delay. No user traffic or production quotas were measured. Normal synthetic successes and forced faults do not establish the frequency or cause of real gateway 5xx.'};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  try {await runProbe(process.env,reproduceQuotaTimeouts,'SYNTHETIC_QUOTA_TIMEOUT_REPRO');}
  catch {console.error('Synthetic quota timeout reproduction failed; provider details withheld.');process.exitCode=1;}
}
