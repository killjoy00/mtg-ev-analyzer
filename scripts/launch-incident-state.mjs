import {alertSeverity} from '../launch-alert-policy.mjs';

const MARKER='pack1-launch-incident-v1';
const CONDITIONS=new Set(['gateway_5xx','network_or_application_429','authentication_429','slow_requests','slow_quota','worker_daily_usage','worker_daily_headroom','worker_daily_limit_risk','neon_compute_billing_period_usage','neon_egress_billing_period_usage','gateway_probe_failed','coverage_pending','coverage_continuation_failed','coverage_unrecoverable','telemetry_unavailable']);
const STATUS=new Set(['active','recovering','recovered','unknown']);
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
export const INCIDENT_RECOVERY_MS=30*60_000;

// Sliding windows overlap. Escalation requires a continuous half hour of bad
// window endpoints, not three copies of one burst or replayed windows.
export function persistentLatencyConditions(history,target) {
  const result=[];
  for(const condition of ['slow_requests','slow_quota']) {
    let count=0;
    for(let end=target;end>=target-INCIDENT_RECOVERY_MS;end-=5*60_000) {
      if(!history[new Date(end).toISOString()]?.includes(condition+'_gameplay'))break;
      count++;
    }
    if(count===7)result.push(condition);
  }
  return result;
}

export function parseIncidentState(body) {
  const m=String(body||'').match(/<!-- pack1-launch-incident-v1\n([^\n]+)\n-->/);
  if(!m)return null;
  try {
    const d=JSON.parse(m[1]);
    if(d.version!==1||!CONDITIONS.has(d.condition)||!STATUS.has(d.status)||!['alert','warning'].includes(d.severity)||!['alert','warning'].includes(d.worst_severity)||!Number.isSafeInteger(d.episodes)||d.episodes<1)return null;
    return {version:1,condition:d.condition,status:d.status,severity:d.severity,worst_severity:d.worst_severity,episodes:d.episodes,
      first_seen:iso(d.first_seen),last_seen:iso(d.last_seen),checked_through:iso(d.checked_through)};
  }catch{return null;}
}

function legacyIncidentState(body,condition) {
  // Migrate only timestamps/category from the old report. Never copy its
  // metrics or arbitrary strings into the new public lifecycle summary.
  try {
    const text=String(body||''),d=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1));
    const bad=(d.windows||[]).filter(w=>w.alerts?.includes(condition)).map(w=>iso(w.to)).filter(Boolean).sort();
    const last=bad.at(-1)||iso(d.at);if(!last)return null;
    return {version:1,condition,status:'unknown',severity:alertSeverity(condition),worst_severity:'alert',episodes:1,first_seen:bad[0]||last,last_seen:last,checked_through:null};
  }catch{return null;}
}

export function nextIncidentState(previous,condition,report) {
  if(!CONDITIONS.has(condition))throw Error('Unknown launch incident category');
  const windows=report.windows||[],bad=windows.filter(w=>w.alerts?.includes(condition));
  const observed=bad.map(w=>iso(w.to)).filter(Boolean).sort();
  const current=iso(report.coverage?.through),lastWindow=windows.at(-1);
  const healthyCoverage=report.coverage?.state_persisted===true&&report.coverage.pending_windows===0&&report.coverage.unrecoverable!==true&&!report.coverage.failed_window&&!report.errors?.length&&iso(lastWindow?.to)===current&&current===iso(report.coverage.target);
  const isWindowCondition=['gateway_5xx','network_or_application_429','authentication_429','slow_requests','slow_quota'].includes(condition);
  const globallyActive=!isWindowCondition&&report.alerts?.includes(condition);
  const times=[previous?.last_seen,...observed,...(globallyActive?[iso(report.at)]:[])].filter(Boolean).sort();
  const last_seen=times.at(-1)||null;
  const first_seen=[previous?.first_seen,observed[0],...(globallyActive?[iso(report.at)]:[])].filter(Boolean).sort()[0]||last_seen;
  let status='unknown';
  if(globallyActive||(healthyCoverage&&lastWindow.alerts?.includes(condition)))status='active';
  else if(healthyCoverage&&last_seen)status=Date.parse(current)-Date.parse(last_seen)>=INCIDENT_RECOVERY_MS?'recovered':'recovering';
  // Probe recovery is proven by its own explicit successful observation.
  if(condition==='gateway_probe_failed'&&report.probe?.ok===true)status='recovered';
  const recurrence=previous?.status==='recovered'&&[...observed,...(globallyActive?[iso(report.at)]:[])].filter(Boolean).some(t=>t>(previous.checked_through||previous.last_seen||''));
  const severity=report.severities?.[condition]||previous?.severity||alertSeverity(condition);
  return {version:1,condition,status,severity,worst_severity:severity==='alert'||previous?.worst_severity==='alert'?'alert':'warning',episodes:(previous?.episodes||1)+(recurrence?1:0),first_seen,last_seen,checked_through:healthyCoverage?current:previous?.checked_through||null};
}

function title(condition,state) {
  const prefix=state.status==='recovered'?'recovered':state.severity==='warning'?'warning':'alert';
  return `[launch ${prefix}] Production monitoring needs attention (${condition})`;
}

export function renderIncidentState(state) {
  return `Monitoring status: **${state.status}**. Severity: **${state.severity}**. Episodes observed: ${state.episodes}.\n`+
    `First / last breached window end: ${state.first_seen||'unavailable'} / ${state.last_seen||'unavailable'}.\n`+
    'Service recovery does not close the investigation. Window times are observations, not exact event times.\n\n'+
    `<!-- ${MARKER}\n${JSON.stringify(state)}\n-->`;
}

export async function reconcileIncidents({issues,base,report,request}) {
  let created=false,existing=false;
  const active=new Set(report.alerts||[]);
  for(const condition of CONDITIONS) {
    // Coverage/telemetry auto-closure remains owned by the existing router.
    const match=issues.find(i=>!i.pull_request&&(
      /^\[launch (?:alert|warning|recovered)\]/.test(i.title||'')&&i.title.endsWith(`(${condition})`)||
      i.title==='[launch alert] Production capacity needs attention'&&String(i.body||'').includes('"'+condition+'"')));
    if(!active.has(condition)&&!match)continue;
    if(!active.has(condition)&&['coverage_pending','coverage_continuation_failed','telemetry_unavailable'].includes(condition))continue;
    if(match&&!iso(report.at)){existing=true;continue;}
    const parsed=parseIncidentState(match?.body),previous=parsed||legacyIncidentState(match?.body,condition),state=nextIncidentState(previous,condition,report);
    if(match) {
      existing=active.has(condition)||existing;
      // Do not generate issue edits every polling interval. Persist breaches,
      // recurrence, escalation and recovery; an unchanged healthy state is quiet.
      const changed=!parsed||['status','severity','worst_severity','episodes','first_seen','last_seen'].some(k=>previous[k]!==state[k]);
      if(!changed)continue;
      const old=String(match.body||'').replace(/\n*Monitoring status: \*\*[\s\S]*?<!-- pack1-launch-incident-v1\n[^\n]+\n-->/,'');
      await request(`${base}/issues/${match.number}`,{title:title(condition,state),body:old+'\n\n'+renderIncidentState(state)},'PATCH');
    } else {
      const body=`Production monitoring category: ${condition}.\n\nFollow https://github.com/killjoy00/mtg-ev-analyzer/blob/main/docs/LAUNCH-OPERATIONS.md.\n`+
        'Use the existing watcher report and provider logs for investigation. Do not post detailed production telemetry in this issue.\n\n'+renderIncidentState(state);
      await request(base+'/issues',{title:title(condition,state),body},'POST');created=true;
    }
  }
  return {created,existing};
}
