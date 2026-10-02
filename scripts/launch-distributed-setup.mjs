import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {policy,metadata} from './launch-distributed-control.mjs';
import {PROJECT,projectSnapshot} from './neon-egress-evidence.mjs';
import {previewAccount,queryPreviewEvents} from './launch-distributed-telemetry.mjs';
export function inspectPreflightEvents(events,sha) {
  const status_counts=Object.fromEntries([...new Set(events.map(e=>e.status))].sort((a,b)=>a-b).map(status=>[status,events.filter(e=>e.status===status).length]));
  const route_status_counts={};
  for(const e of events) {const k=(e.route||'other')+':'+e.status;route_status_counts[k]=(route_status_counts[k]||0)+1;}
  const matching=events.filter(e=>e.release===sha&&e.status===200&&e.route==='health');
  const wrong_release=events.filter(e=>e.release!==sha).length;
  const system_errors=events.filter(e=>e.status===429||e.status>=500).length;
  const boundary_rejections=events.filter(e=>e.status>=400&&e.status<500&&e.status!==429).length;
  return {matching_events:matching.length,wrong_release,system_errors,boundary_rejections,status_counts,route_status_counts,
    passed:wrong_release===0&&system_errors===0&&matching.length>0};
}
export async function preflightTelemetry({fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),clock=Date.now}={}) {
  const sha=process.env.GITHUB_SHA,key=process.env.PREVIEW_ACCESS_KEY,account=await previewAccount({fetcher});
  assert.match(sha||'',/^[a-f0-9]{40}$/);assert.match(key||'',/^[a-f0-9]{64}$/);
  const from=clock(),healthRequests=policy.telemetry_preflight_requests;
  // Prove log API/schema access before any gameplay, then generate only bounded
  // private health traffic. No production probe or mutation can be supplied.
  await queryPreviewEvents(fetcher,process.env.CLOUDFLARE_EDGE_TOKEN,account,from-60000,from);
  for(let i=0;i<healthRequests;i++) {
    const r=await fetcher('https://api-preview.packone.pro/draft/health?quick=1',{headers:{'x-pack1-preview-key':key,connection:'close'},redirect:'error',signal:AbortSignal.timeout(10000)});
    let body=null;try {body=await r.json();}catch { /* non-JSON cannot prove the reviewed revision */ }
    const received=body?.release_commit,release=typeof received==='string'&&/^[a-f0-9]{40}$/.test(received)?received:null;
    if(!(r.ok&&received===sha)) {
      console.error(JSON.stringify({event:'private_preview_revision_failed',request:i+1,status:r.status,release_commit:release}));
      assert.fail('private_preview_revision');
    }
    await sleep(500);
  }
  const to=clock(),deadline=to+policy.telemetry_timeout_seconds*1000,checks=[];
  await sleep(policy.telemetry_settlement_seconds*1000);
  for(;;) {
    const queriedAt=clock(),events=await queryPreviewEvents(fetcher,process.env.CLOUDFLARE_EDGE_TOKEN,account,from,to),inspection=inspectPreflightEvents(events,sha);
    checks.push({queried_at:new Date(queriedAt).toISOString(),retained_events:events.length,...inspection});
    const report={sha,service:'pack1-gateway-preview',from,to,health_requests:healthRequests,
      settlement_seconds:policy.telemetry_settlement_seconds,timeout_seconds:policy.telemetry_timeout_seconds,
      retained_events:events.length,checks};
    if(inspection.wrong_release)return {...report,passed:false,reason:'wrong_release_preview_telemetry'};
    if(inspection.system_errors)return {...report,passed:false,reason:'retained_preview_system_error'};
    if(inspection.matching_events)return {...report,passed:true};
    if(queriedAt>=deadline)return {...report,passed:false,reason:'positive_preview_telemetry_missing'};
    await sleep(Math.min(15000,Math.max(1,deadline-queriedAt)));
  }
}
export async function verifyCleanup(branch,{fetcher=fetch}={}) {
  assert.match(branch||'',/^br-[a-z0-9-]+$/);assert.ok(!['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b'].includes(branch));
  const account=await previewAccount({fetcher});
  const domain=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/domains`,{headers:{authorization:'Bearer '+process.env.CLOUDFLARE_EDGE_TOKEN},redirect:'error',signal:AbortSignal.timeout(20000)});
  const d=await domain.json();assert.ok(domain.ok&&d.success&&Array.isArray(d.result)&&(d.result_info?.total_pages||1)<=1,'cleanup_domain_inventory');
  const branchResult=await fetcher(`https://console.neon.tech/api/v2/projects/${PROJECT}/branches/${branch}`,{headers:{authorization:'Bearer '+process.env.NEON_API_KEY},redirect:'error',signal:AbortSignal.timeout(20000)});
  const report={branch,observed_at:new Date().toISOString(),preview_mapping_absent:!d.result.some(v=>v.hostname==='api-preview.packone.pro'),branch_get_status:branchResult.status};
  report.passed=report.preview_mapping_absent&&report.branch_get_status===404;return report;
}
async function main() {
  fs.mkdirSync('artifacts/launch-load',{recursive:true});
  if(process.argv[2]==='budget') {
    const snapshot=projectSnapshot((await metadata('')).project,new Date().toISOString());
    fs.writeFileSync('artifacts/launch-load/usage-before-provisioning.json',JSON.stringify(snapshot,null,2));
  } else if(process.argv[2]==='telemetry') {
    const r=await preflightTelemetry();fs.writeFileSync('artifacts/launch-load/telemetry-preflight.json',JSON.stringify(r,null,2));
    assert.ok(r.passed,r.reason||'telemetry_preflight_failed');
  } else if(process.argv[2]==='cleanup') {
    const r=await verifyCleanup(process.env.PREVIEW_BRANCH);fs.writeFileSync('artifacts/launch-load/cleanup.json',JSON.stringify(r,null,2));
    if(!r.passed)throw Error('cleanup_verification_failed');
  } else throw Error('unknown_setup_action');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{const message=String(error?.message||'');console.error(JSON.stringify({error:'capacity_safety_or_evidence_check_failed',code:error.code||null,reason:/^[a-z0-9_:-]{1,80}$/.test(message)?message:null,line:String(error.stack).match(/launch-distributed-[a-z]+\.mjs:(\d+)/)?.[0]||null}));process.exitCode=1;});
