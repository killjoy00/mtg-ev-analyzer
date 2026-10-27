import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {SLOW_REQUEST_MS,SLOW_QUOTA_MS,alertSeverity} from '../launch-alert-policy.mjs';
import {reconcileIncidents,persistentLatencyConditions} from './launch-incident-state.mjs';
import {
  COVERAGE_ISSUE_NUMBER,COVERAGE_ISSUE_TITLE,WINDOW_MS,STEP_MS,
  normalizeCoverageState,parseCoverageState,renderCoverageState,mergeCoverageState,planCoverage,withWindowAlerts,
} from '../launch-monitoring.mjs';

const PROJECT='patient-shadow-91417882',TITLE='[launch alert] Production capacity needs attention';
const CONTINUATION_WORKFLOW='launch-alert.yml';
export const MAX_CONTINUATION_DEPTH=12;
export const GATEWAY_PAGE_SIZE=2000,GATEWAY_MAX_PAGES=32;
const RECOVERABLE_ALERTS=new Set(['coverage_pending','coverage_continuation_failed','telemetry_unavailable']);
export const thresholds={window_minutes:15,minimum_errors:5,estimated_error_fraction:.01,minimum_429:10,minimum_slow_samples:3,slow_ms:SLOW_REQUEST_MS,quota_ms:SLOW_QUOTA_MS,requests_per_day:100000,free_requests_warning:80000,free_requests_alert:95000,compute_cu_hours_per_billing_period:200,egress_bytes_per_billing_period:50*1024**3};

async function json(fetcher,url,token,body,method=body?'POST':'GET') {
  const r=await fetcher(url,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
  const d=await r.json().catch(()=>null);
  if(!r.ok||d?.success===false||d?.errors?.length)throw Object.assign(Error(new URL(url).hostname+new URL(url).pathname+' telemetry HTTP '+r.status),{status:r.status});
  return d;
}

export function parseGatewayEvent(row) {
  let p=row?.source;
  if(typeof p==='string')try{p=JSON.parse(p);}catch{return null;}
  if(!p||typeof p!=='object')try{p=JSON.parse(row?.$metadata?.message);}catch{return null;}
  if(!p||typeof p!=='object'||p.event!=='gateway_request'||![.1,1].includes(p.sample_rate)||!Number.isInteger(p.status)||p.status<100||p.status>599||!Number.isFinite(p.duration_ms)||p.duration_ms<0)return null;
  const duration=value=>Number.isFinite(value)&&value>=0?value:0;
  const boundedTiming=value=>Number.isFinite(value)&&value>=0&&value<=600000?Math.round(value):null;
  const integer=value=>Number.isInteger(value)&&value>=0&&value<=100?value:null;
  const event={id:row?.$metadata?.id,route:/^[a-z_]{1,40}$/.test(p.route)?p.route:'other',status:p.status,sample_rate:p.sample_rate,duration_ms:p.duration_ms,quota_ms:duration(p.quota_ms),upstream_ms:duration(p.upstream_ms),quota_scope:['request','session','request,session'].includes(p.quota_scope)?p.quota_scope:null,release:/^[a-f0-9]{40}$/.test(p.release)?p.release:'unknown',
    tail_sampling_version:p.tail_sampling_version===1?1:0,rate_limit_class:p.rate_limit_class==='player_auth'&&p.status===429&&p.route==='account'&&p.upstream_status===429&&p.upstream_calls===1&&!p.quota_scope?'player_auth':null,
    upstream_calls:integer(p.upstream_calls),upstream_status:Number.isInteger(p.upstream_status)&&p.upstream_status>=100&&p.upstream_status<=599?p.upstream_status:null,
    quota_handler_ms:boundedTiming(p.quota_handler_ms),quota_transport_wait_ms:boundedTiming(p.quota_transport_wait_ms),
    quota_attempts:integer(p.quota_attempts),quota_retryable:p.quota_retryable===true,quota_overloaded:p.quota_overloaded===true,quota_remote:p.quota_remote===true,
    error:['timeout','invalid_body','gateway_failure'].includes(p.error)?p.error:null};
  if(event.tail_sampling_version===1&&(event.duration_ms>thresholds.slow_ms||event.quota_ms>thresholds.quota_ms)&&event.sample_rate!==1)return null;
  return event;
}

// Only aggregate bounded stage counts; never copy gateway traces, object tags,
// IPs or provider diagnostic records into the public watcher report. The
// residual includes transport, queueing and the output gate, not pure network
// latency. A handler/residual split alone cannot establish a root cause.
export function quotaStageSummary(events) {
  const result={slow_events:0,timing_available:0,handler_dominant:0,residual_dominant:0,missing_timing:0,retried:0,quota_failures:0};
  for(const e of events) {
    if(!(e.quota_ms>thresholds.quota_ms))continue;
    result.slow_events++;
    if(e.quota_attempts>1)result.retried++;
    if(e.status>=500)result.quota_failures++;
    if(!Number.isFinite(e.quota_handler_ms)||!Number.isFinite(e.quota_transport_wait_ms)) {
      result.missing_timing++;
      continue;
    }
    result.timing_available++;
    if(e.quota_handler_ms>=e.quota_transport_wait_ms)result.handler_dominant++;
    else result.residual_dominant++;
  }
  return result;
}

export function evaluate(events,usage) {
  const estimated=events.reduce((n,e)=>n+1/e.sample_rate,0),errors=events.filter(e=>e.status>=500).length,limited=events.filter(e=>e.status===429).length;
  const slow=events.filter(e=>e.duration_ms>thresholds.slow_ms).length,quotaSlow=events.filter(e=>e.quota_ms>thresholds.quota_ms).length;
  const alerts=[];
  if(errors>=thresholds.minimum_errors&&errors/Math.max(1,estimated)>thresholds.estimated_error_fraction)alerts.push('gateway_5xx');
  const authLimited=events.filter(e=>e.status===429&&e.rate_limit_class==='player_auth').length;
  if(limited-authLimited>=thresholds.minimum_429)alerts.push('network_or_application_429');
  if(authLimited>=thresholds.minimum_429)alerts.push('authentication_429');
  if(slow>=thresholds.minimum_slow_samples)alerts.push('slow_requests');
  if(quotaSlow>=thresholds.minimum_slow_samples)alerts.push('slow_quota');
  // Unknown plans retain a warning; Paid traffic volume is report-only.
  // Free headroom uses current UTC-day, account-wide usage, not yesterday's gateway.
  if(!['free','paid'].includes(usage.worker_plan)&&usage.worker_requests>=thresholds.requests_per_day)alerts.push('worker_daily_usage');
  if(usage.worker_plan==='free'&&usage.worker_account_requests_today>=thresholds.free_requests_alert)alerts.push('worker_daily_limit_risk');
  else if(usage.worker_plan==='free'&&usage.worker_account_requests_today>=thresholds.free_requests_warning)alerts.push('worker_daily_headroom');
  // Daily Neon history is whole-project (production, development, and CI), so keep it in reports but do not route it as a production incident.
  if(usage.billing_period_compute_cu_hours>=thresholds.compute_cu_hours_per_billing_period)alerts.push('neon_compute_billing_period_usage');
  if(usage.billing_period_egress_bytes>=thresholds.egress_bytes_per_billing_period)alerts.push('neon_egress_billing_period_usage');
  const diagnostic_categories=new Set();
  for(const e of events.filter(e=>e.status>=500||e.status===429||e.duration_ms>thresholds.slow_ms||e.quota_ms>thresholds.quota_ms)) {
    diagnostic_categories.add(e.route?.startsWith('draft_')?'draft':e.route==='account'?'account':e.route?.startsWith('admin_')?'admin':'other');
    if(e.status>=500)diagnostic_categories.add(e.upstream_calls===0?'quota_or_gateway':e.upstream_status>=500?'origin_failure':'unattributed_failure');
    if(e.quota_overloaded)diagnostic_categories.add('quota_overloaded');
    if(e.error==='timeout')diagnostic_categories.add('timeout');
    if(e.quota_scope)diagnostic_categories.add('network_quota');
    if(e.rate_limit_class==='player_auth')diagnostic_categories.add('player_auth_limit');
  }
  const gameplay=e=>/^draft_(?:start|view|pick|reroll|read|daily_status|shared_read|creator_challenge_read)$/.test(e.route||'')||e.route==='player_session';
  const persistent_candidates=[];
  if(events.filter(e=>gameplay(e)&&e.duration_ms>thresholds.slow_ms).length>=thresholds.minimum_slow_samples)persistent_candidates.push('slow_requests_gameplay');
  if(events.filter(e=>gameplay(e)&&e.quota_ms>thresholds.quota_ms).length>=thresholds.minimum_slow_samples)persistent_candidates.push('slow_quota_gameplay');
  return {alerts,persistent_candidates,severities:Object.fromEntries(alerts.map(c=>[c,alertSeverity(c)])),diagnostic_categories:[...diagnostic_categories].sort(),latency_sampling:events.length&&events.every(e=>e.tail_sampling_version===1)?'complete_tail':'legacy_or_mixed',sampled_events:events.length,estimated_requests:estimated,errors,limited,slow_samples:slow,slow_quota_samples:quotaSlow,quota_stage_summary:quotaStageSummary(events),releases:[...new Set(events.map(e=>e.release))],usage};
}

export function parseBillingPeriodUsage(project,now=Date.now()) {
  const p=project,from=Date.parse(p?.consumption_period_start),to=Date.parse(p?.consumption_period_end);
  if(p?.id!==PROJECT||!Number.isFinite(p.compute_time_seconds)||p.compute_time_seconds<0||!Number.isSafeInteger(p.data_transfer_bytes)||p.data_transfer_bytes<0||!Number.isFinite(from)||!Number.isFinite(to)||from>=to||now<from||now>=to)throw Error('Neon billing-period counters unavailable or stale');
  return {billing_period_compute_cu_hours:p.compute_time_seconds/3600,billing_period_egress_bytes:p.data_transfer_bytes,billing_period_start:new Date(from).toISOString(),billing_period_end:new Date(to).toISOString(),billing_period_scope:'entire-project/all-branches/public-and-private-network-transfer',billing_period_source:'project counters; observation time is not a consumption watermark'};
}

export function parseNeonUsage(data) {
  const project=data.projects?.find(p=>p.project_id===PROJECT);
  if(!project||!Array.isArray(project.periods))throw Error('Unexpected Neon usage schema');
  let compute=0,egress=0;
  for(const period of project.periods)for(const frame of period.consumption||[])for(const m of frame.metrics||[]) {
    if(!Number.isFinite(m.value)||m.value<0)throw Error('Invalid Neon usage value');
    if(m.metric_name==='compute_unit_seconds')compute+=m.value;
    if(m.metric_name==='public_network_transfer_bytes')egress+=m.value;
  }
  return {compute_cu_hours:compute/3600,egress_bytes:egress};
}

export async function queryEvents(fetcher,token,account,from,to) {
  const url=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`,seen=new Map();
  let offset=null;
  for(let page=0;page<GATEWAY_MAX_PAGES;page++) {
    const body={queryId:'pack1-launch-watch',timeframe:{from,to},dry:true,limit:GATEWAY_PAGE_SIZE,view:'events',parameters:{datasets:['cloudflare-workers'],filterCombination:'and',filters:[{key:'$metadata.service',operation:'eq',type:'string',value:'pack1-gateway'},{key:'event',operation:'eq',type:'string',value:'gateway_request'}]}};
    if(offset){body.offset=offset;body.offsetDirection='next';}
    const d=await json(fetcher,url,token,body);
    const rows=d.result?.events?.events;if(!Array.isArray(rows))throw Error('Unexpected gateway log schema');
    for(const row of rows){const event=parseGatewayEvent(row);if(!event?.id)throw Error('Unexpected gateway event schema');seen.set(event.id,event);}
    if(rows.length<GATEWAY_PAGE_SIZE)return [...seen.values()];
    const next=rows.at(-1)?.$metadata?.id;
    if(typeof next!=='string'||!next||next.length>512||next===offset)throw Error('Gateway telemetry cursor invalid');
    offset=next;
  }
  throw Error('Gateway telemetry exceeds bounded query capacity');
}

function dedupeEvents(events) {
  const seen=new Set(),result=[];
  for(const event of events||[]) {
    const key=typeof event?.id==='string'&&event.id?event.id:null;
    if(key&&seen.has(key))continue;
    if(key)seen.add(key);
    result.push(event);
  }
  return result;
}

function gatewaySummary(summary) {
  return {
    alerts:summary.alerts,
    severities:summary.severities,
    diagnostic_categories:summary.diagnostic_categories,
    latency_sampling:summary.latency_sampling,
    sampled_events:summary.sampled_events,
    estimated_requests:summary.estimated_requests,
    errors:summary.errors,
    limited:summary.limited,
    slow_samples:summary.slow_samples,
    slow_quota_samples:summary.slow_quota_samples,
    quota_stage_summary:summary.quota_stage_summary,
    releases:summary.releases,
  };
}

export async function inspectGatewayCoverage({state,now=Date.now(),loadWindow}) {
  if(typeof loadWindow!=='function')throw Error('Gateway window loader is required');
  const current=normalizeCoverageState(state||{version:1,coverage_floor:null,covered_through:null,alerted_windows:{},updated_at:null});
  const plan=planCoverage(current,{now});
  let next={...current,coverage_floor:new Date(plan.coverageFloor).toISOString(),alerted_windows:{...current.alerted_windows}};
  const routed=new Set(),windows=[];
  if(plan.unrecoverable) {
    return {state:next,plan,windows,alerts:[],failed:null,unrecoverable:true,remainingNewWindows:plan.allNewEnds.length};
  }
  const newEnds=new Set(plan.newEnds);
  let failed=null;
  for(const end of plan.inspectionEnds) {
    const from=end-WINDOW_MS,endIso=new Date(end).toISOString();
    try {
      const events=dedupeEvents(await loadWindow(from,end));
      const summary=evaluate(events,{});
      // Durable window evidence must never suppress a retry if GitHub issue routing failed.
      // Open category issues remain the authoritative cross-run alert dedupe layer.
      for(const alert of summary.alerts)routed.add(alert);
      next=withWindowAlerts(next,end,[...summary.alerts,...summary.persistent_candidates]);
      if(newEnds.has(end))next.covered_through=endIso;
      windows.push({from:new Date(from).toISOString(),to:endIso,replay:!newEnds.has(end),...gatewaySummary(summary)});
    } catch(error) {
      failed={from:new Date(from).toISOString(),to:endIso,error:String(error?.message||error).slice(0,180)};
      break;
    }
  }
  const coveredAfter=next.covered_through?Date.parse(next.covered_through):null;
  const remainingNewWindows=coveredAfter===null
    ?plan.allNewEnds.length
    :Math.max(0,Math.ceil((plan.target-coveredAfter)/STEP_MS));
  const persistent=persistentLatencyConditions(next.alerted_windows,plan.target);
  return {state:next,plan,windows,alerts:[...routed],persistent,failed,unrecoverable:false,remainingNewWindows};
}

export async function usage(fetcher,env,account,now) {
  // Complete UTC day avoids treating partially reported current-hour metrics as complete.
  const to=new Date(now);to.setUTCHours(0,0,0,0);const from=new Date(to-86400000);
  const cf=await json(fetcher,'https://api.cloudflare.com/client/v4/graphql',env.CLOUDFLARE_EDGE_TOKEN,{query:'query($account: string, $from: string, $to: string) { viewer { accounts(filter: {accountTag: $account}) { workersInvocationsAdaptive(limit: 1, filter: {scriptName: "pack1-gateway", datetime_geq: $from, datetime_lt: $to}) { sum { requests errors } } } } }',variables:{account,from:from.toISOString(),to:to.toISOString()}});
  const rows=cf.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
  if(!Array.isArray(rows))throw Error('Unexpected Worker usage schema');
  const project=await json(fetcher,'https://console.neon.tech/api/v2/projects/'+PROJECT,env.NEON_API_KEY);
  const billing=parseBillingPeriodUsage(project.project,now);
  const org=project.project?.org_id;if(!/^[a-z0-9-]{1,60}$/.test(org||''))throw Error('Neon project organization unavailable');
  const params=new URLSearchParams({org_id:org,project_ids:PROJECT,from:from.toISOString(),to:to.toISOString(),granularity:'daily',metrics:'compute_unit_seconds,public_network_transfer_bytes'});
  let neon;
  try {neon=parseNeonUsage(await json(fetcher,'https://console.neon.tech/api/v2/consumption_history/v2/projects?'+params,env.NEON_API_KEY));}
  catch(error) {
    if(![403,404].includes(error.status))throw error;
    params.delete('org_id');params.set('metrics','compute_time_seconds');
    try {
      const legacy=await json(fetcher,'https://console.neon.tech/api/v2/consumption_history/projects?'+params,env.NEON_API_KEY);
      const selected=legacy.projects?.find(p=>p.project_id===PROJECT);
      if(!selected?.periods||!Number.isFinite(project.project.data_transfer_bytes))throw Error('Legacy Neon usage unavailable');
      const frames=selected.periods.flatMap(p=>p.consumption||[]);
      if(frames.some(f=>!Number.isFinite(f.compute_time_seconds)))throw Error('Legacy Neon compute usage unavailable');
      neon={compute_cu_hours:frames.reduce((n,f)=>n+f.compute_time_seconds,0)/3600,billing_period_egress_bytes:project.project.data_transfer_bytes,billing_period_start:project.project.consumption_period_start,source:'legacy consumption history; egress is current billing period, not daily'};
    } catch(legacyError) {
      if(![403,404].includes(legacyError.status))throw legacyError;
      const p=project.project;
      if(!Number.isFinite(p.compute_time_seconds)||!Number.isFinite(p.data_transfer_bytes)||!p.consumption_period_start)throw Error('Neon project usage counters unavailable');
      neon={billing_period_compute_cu_hours:p.compute_time_seconds/3600,billing_period_egress_bytes:p.data_transfer_bytes,billing_period_start:p.consumption_period_start,source:'project billing-period counters; daily Neon history unavailable'};
    }
  }
  const worker_plan=['free','paid'].includes(env.PACK1_WORKERS_PLAN)?env.PACK1_WORKERS_PLAN:'unknown';
  let worker_account_requests_today;
  if(worker_plan==='free') {
    const current=await json(fetcher,'https://api.cloudflare.com/client/v4/graphql',env.CLOUDFLARE_EDGE_TOKEN,{query:'query($account: string, $from: string, $to: string) { viewer { accounts(filter: {accountTag: $account}) { workersInvocationsAdaptive(limit: 1, filter: {datetime_geq: $from, datetime_lt: $to}) { sum { requests } } } } }',variables:{account,from:to.toISOString(),to:new Date(now).toISOString()}});
    const currentRows=current.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
    if(!Array.isArray(currentRows)||currentRows.some(r=>!Number.isFinite(r.sum?.requests)||r.sum.requests<0))throw Error('Current account Worker usage unavailable');
    worker_account_requests_today=currentRows.reduce((n,r)=>n+r.sum.requests,0);
  }
  return {day:from.toISOString().slice(0,10),scope:'entire Neon project including CI branches; production gateway only',worker_requests:rows.reduce((n,r)=>n+(r.sum?.requests||0),0),worker_plan,...(worker_plan==='free'?{worker_account_requests_today,worker_usage_observed_at:new Date(now).toISOString(),worker_current_usage_scope:'all account Workers; current UTC day; provider accounting may lag'}:{}),...neon,...billing};
}

function coverageIssueUrl(env) {
  if(env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer')throw Error('Invalid launch coverage repository');
  return `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/issues/${COVERAGE_ISSUE_NUMBER}`;
}

export async function loadCoverageState(fetcher,env) {
  const issue=await json(fetcher,coverageIssueUrl(env),env.GITHUB_TOKEN);
  if(issue?.number!==COVERAGE_ISSUE_NUMBER||issue?.title!==COVERAGE_ISSUE_TITLE)throw Error('Launch coverage state issue mismatch');
  return parseCoverageState(issue.body);
}

export async function saveCoverageState(fetcher,env,proposed,{now=Date.now()}={}) {
  const url=coverageIssueUrl(env),issue=await json(fetcher,url,env.GITHUB_TOKEN);
  if(issue?.number!==COVERAGE_ISSUE_NUMBER||issue?.title!==COVERAGE_ISSUE_TITLE)throw Error('Launch coverage state issue mismatch');
  const merged=mergeCoverageState(parseCoverageState(issue.body),proposed,{now});
  const updated=await json(fetcher,url,env.GITHUB_TOKEN,{body:renderCoverageState(merged)},'PATCH');
  if(updated?.number!==COVERAGE_ISSUE_NUMBER)throw Error('Launch coverage state update failed');
  return merged;
}

export async function routeAlert(fetcher,env,report) {
  if(!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY||''))throw Error('Invalid alert repository');
  const base='https://api.github.com/repos/'+env.GITHUB_REPOSITORY;
  const issues=[];
  for(let page=1;page<=10;page++) {
    const batch=await json(fetcher,base+`/issues?state=open&per_page=100${page===1?'':'&page='+page}`,env.GITHUB_TOKEN);
    if(!Array.isArray(batch))throw Error('Invalid launch incident list');
    issues.push(...batch);
    if(batch.length<100)break;
    if(page===10)throw Error('Launch incident list exceeds bounded pagination');
  }
  const active=new Set(report.alerts||[]);
  let {created,existing}=await reconcileIncidents({issues,base,report,request:(url,body,method)=>json(fetcher,url,env.GITHUB_TOKEN,body,method)});
  let recovered=false;
  for(const condition of RECOVERABLE_ALERTS) {
    if(active.has(condition))continue;
    const persisted=report.coverage?.state_persisted===true;
    const resolved=condition==='coverage_pending'
      ?persisted&&report.coverage.pending_windows===0
      :condition==='coverage_continuation_failed'
        ?persisted&&['queued','not_needed'].includes(report.coverage?.continuation?.status)
        :persisted
          &&report.coverage.pending_windows===0
          &&report.coverage.failed_window==null
          &&report.coverage.unrecoverable!==true
          &&!(report.errors?.length);
    if(!resolved)continue;
    const title=TITLE+' ('+condition+')';
    const match=issues.find(i=>!i.pull_request&&(i.title===title||/^\[launch (?:alert|warning|recovered)\]/.test(i.title||'')&&i.title.endsWith(`(${condition})`)));
    if(!match)continue;
    await json(fetcher,base+'/issues/'+match.number,env.GITHUB_TOKEN,{state:'closed',state_reason:'completed'},'PATCH');
    recovered=true;
  }
  if(created)return 'created';
  if(recovered)return 'recovered';
  if(existing)return 'existing';
  return 'none';
}
// Gateway logs only reflect real traffic, so an outage stays invisible while
// nobody plays (2026-10-07). One health request through the gateway's quota
// and origin path per run; a single retry keeps one blip from alerting.
export const PROBE_URL='https://api.packone.pro/draft/health?quick=1',PROBE_RETRY_MS=5000;
export async function probeGateway(fetcher,{retryMs=PROBE_RETRY_MS,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  for(let attempt=1;;attempt++) {
    let result;
    try {
      const r=await fetcher(PROBE_URL,{redirect:'error',signal:AbortSignal.timeout(15000)});
      const body=await r.json().catch(()=>null);
      result={status:r.status,ok:r.status===200&&body?.ok===true,attempts:attempt};
    } catch(error) {
      result={status:0,ok:false,attempts:attempt,error:error?.name==='TimeoutError'?'timeout':'network'};
    }
    if(result.ok||attempt===2)return result;
    await sleep(retryMs);
  }
}

async function productionAccount(fetcher,env) {
  const zones=await json(fetcher,'https://api.cloudflare.com/client/v4/zones?name=packone.pro&per_page=50',env.CLOUDFLARE_EDGE_TOKEN);
  const zone=zones.result?.filter(z=>z.name==='packone.pro'&&z.status==='active');
  if(zone?.length!==1||!/^[a-f0-9]{32}$/.test(zone[0].account?.id))throw Error('Unexpected Cloudflare account');
  return zone[0].account.id;
}

function pushError(report,error) {
  report.errors??=[];
  const message=String(error?.message||error).slice(0,180);
  if(!report.errors.includes(message))report.errors.push(message);
}

async function currentWindowCheck(fetcher,env,account,now) {
  let events=await queryEvents(fetcher,env.CLOUDFLARE_EDGE_TOKEN,account,now-WINDOW_MS,now);
  if(env.PACK1_EXPECT_RELEASE) {
    if(!/^[a-f0-9]{40}$/.test(env.PACK1_EXPECT_RELEASE))throw Error('Invalid expected release');
    const deadline=Date.now()+180000;
    while(!events.some(e=>e.release===env.PACK1_EXPECT_RELEASE)&&Date.now()<deadline) {
      // Read-only health probes produce sampled events without creating players.
      for(let i=0;i<10;i++)await fetcher('https://api.packone.pro/draft/health?quick=1',{redirect:'error',signal:AbortSignal.timeout(15000)});
      await new Promise(r=>setTimeout(r,15000));
      events=await queryEvents(fetcher,env.CLOUDFLARE_EDGE_TOKEN,account,Date.now()-WINDOW_MS,Date.now());
    }
    if(!events.some(e=>e.release===env.PACK1_EXPECT_RELEASE))throw Error('Expected release absent from retained gateway logs');
  }
  return evaluate(events,await usage(fetcher,env,account,now));
}

async function alertCoverageCheck(fetcher,env,account,now,report) {
  const state=await loadCoverageState(fetcher,env);
  const inspected=await inspectGatewayCoverage({state,now,loadWindow:(from,to)=>queryEvents(fetcher,env.CLOUDFLARE_EDGE_TOKEN,account,from,to)});
  report.coverage={
    issue:COVERAGE_ISSUE_NUMBER,
    target:new Date(inspected.plan.target).toISOString(),
    before:state.covered_through,
    through:inspected.state.covered_through,
    bootstrap:inspected.plan.bootstrap,
    replay_windows:inspected.plan.replayEnds.length,
    catchup_windows:inspected.plan.newEnds.length,
    pending_windows:inspected.remainingNewWindows,
    minimum_retention_floor:new Date(inspected.plan.retentionFloor).toISOString(),
    unrecoverable:inspected.unrecoverable,
    failed_window:inspected.failed,
  };
  report.windows=inspected.windows;
  report.severities=Object.fromEntries(inspected.alerts.map(c=>[c,alertSeverity(c,{persistent:inspected.persistent?.includes(c)})]));
  report.alerts.push(...inspected.alerts);
  if(inspected.unrecoverable)report.alerts.push('coverage_unrecoverable');
  if(!inspected.unrecoverable&&inspected.remainingNewWindows>0)report.alerts.push('coverage_pending');
  if(inspected.failed) {report.alerts.push('telemetry_unavailable');pushError(report,inspected.failed.error);}

  try {
    const usageReport=evaluate([],await usage(fetcher,env,account,now));
    report.usage=usageReport.usage;
    report.alerts.push(...usageReport.alerts);
    Object.assign(report.severities,usageReport.severities);
  } catch(error) {
    report.alerts.push('telemetry_unavailable');pushError(report,error);
  }

  try {
    const saved=await saveCoverageState(fetcher,env,inspected.state,{now});
    report.coverage.persisted_through=saved.covered_through;
    report.coverage.persisted_at=saved.updated_at;
    report.coverage.state_persisted=true;
  } catch(error) {
    report.alerts.push('telemetry_unavailable');pushError(report,error);
    report.coverage.state_persisted=false;
  }
}

export function launchContinuationDepth(env=process.env) {
  const raw=String(env.PACK1_LAUNCH_CONTINUATION_DEPTH??'0').trim();
  if(!/^\d{1,2}$/.test(raw))throw Error('Invalid launch continuation depth');
  const depth=Number(raw);
  if(depth>MAX_CONTINUATION_DEPTH)throw Error('Launch continuation depth exceeds limit');
  return depth;
}

export async function scheduleCoverageContinuation(fetcher,env,coverage) {
  const pending=Number(coverage?.pending_windows||0);
  if(!Number.isInteger(pending)||pending<0)throw Error('Invalid pending launch coverage count');
  if(pending===0||coverage?.unrecoverable)return {status:'not_needed',pending_windows:pending};
  if(env.GITHUB_REPOSITORY!=='killjoy00/mtg-ev-analyzer')throw Error('Invalid launch continuation repository');
  const depth=launchContinuationDepth(env);
  if(depth>=MAX_CONTINUATION_DEPTH)return {status:'limit_reached',depth,max_depth:MAX_CONTINUATION_DEPTH,pending_windows:pending};
  const root=String(env.PACK1_LAUNCH_CONTINUATION_ROOT_RUN_ID||env.GITHUB_RUN_ID||'').trim();
  if(!/^\d{1,24}$/.test(root))throw Error('Invalid launch continuation root run');
  await json(
    fetcher,
    'https://api.github.com/repos/'+env.GITHUB_REPOSITORY+'/actions/workflows/'+CONTINUATION_WORKFLOW+'/dispatches',
    env.GITHUB_TOKEN,
    {ref:'main',inputs:{continuation_depth:String(depth+1),continuation_root_run_id:root}},
    'POST',
  );
  return {status:'queued',depth:depth+1,max_depth:MAX_CONTINUATION_DEPTH,root_run_id:root,pending_windows:pending};
}

export async function run({fetcher=fetch,env=process.env,now=Date.now(),mode='check'}={}) {
  const report={at:new Date(now).toISOString(),thresholds,alerts:[]};
  try {
    const account=await productionAccount(fetcher,env);
    if(mode==='alert')await alertCoverageCheck(fetcher,env,account,now,report);
    else Object.assign(report,await currentWindowCheck(fetcher,env,account,now));
  } catch(error) {
    report.alerts.push('telemetry_unavailable');pushError(report,error);
  }
  report.alerts=[...new Set(report.alerts)];
  if(mode==='alert') {
    report.probe=await probeGateway(fetcher);
    if(!report.probe.ok)report.alerts.push('gateway_probe_failed');
    if(report.coverage?.pending_windows>0&&!report.coverage.unrecoverable) {
      try {
        const continuation=await scheduleCoverageContinuation(fetcher,env,report.coverage);
        report.coverage.continuation=continuation;
        if(continuation.status==='limit_reached') {
          report.alerts.push('coverage_continuation_failed');
          pushError(report,Error('Launch coverage continuation depth limit reached'));
        }
      } catch(error) {
        report.alerts.push('coverage_continuation_failed');
        pushError(report,error);
        if(report.coverage)report.coverage.continuation={status:'failed'};
      }
    } else if(report.coverage) {
      report.coverage.continuation={status:'not_needed',pending_windows:Number(report.coverage.pending_windows||0)};
    }
    report.alerts=[...new Set(report.alerts)];
    report.severities??={};
    for(const c of report.alerts)report.severities[c]??=alertSeverity(c);
    const latest=report.windows?.at(-1);
    report.active_alerts=[...new Set([...(latest?.alerts||[]),...report.alerts.filter(c=>!['gateway_5xx','network_or_application_429','authentication_429','slow_requests','slow_quota'].includes(c))])];
    report.pause_outreach=report.active_alerts.some(c=>report.severities[c]==='alert');
    try {
      report.alert_route=await routeAlert(fetcher,env,report);
    } catch(error) {
      report.alerts.push('telemetry_unavailable');pushError(report,error);report.alert_route='failed';
    }
  }
  report.alerts=[...new Set(report.alerts)];
  if(mode==='alert'&&report.alerts.some(c=>['telemetry_unavailable','coverage_unrecoverable','coverage_continuation_failed','gateway_probe_failed'].includes(c)))report.pause_outreach=true;
  fs.mkdirSync('artifacts/launch-alert',{recursive:true});fs.writeFileSync('artifacts/launch-alert/report.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  if(mode==='alert')console.log('Launch alert route: '+(report.alert_route||'none'));
  if(report.alerts.includes('coverage_unrecoverable'))throw Error('Launch telemetry coverage is unrecoverable');
  if(report.alerts.includes('coverage_continuation_failed'))throw Error('Launch telemetry continuation failed');
  if(report.alerts.includes('telemetry_unavailable'))throw Error('Launch telemetry access failed');
  // Fail the run as well as routing the issue: a hard-down gateway should also
  // reach the operator through GitHub's failed-run notification.
  if(report.alerts.includes('gateway_probe_failed'))throw Error('Production gateway probe failed');
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run({mode:process.argv[2]||'check'}).catch(()=>{console.error('Launch watcher failed; inspect sanitized report.');process.exitCode=1;});
