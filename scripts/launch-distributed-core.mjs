// Pure acceptance and live-cohort state machine. No production data or transport.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const quantiles=values=>{
  if(!values.length)return {samples:0,p50_ms:null,p95_ms:null,p99_ms:null,max_ms:null};
  assert.ok(values.every(v=>Number.isFinite(v)&&v>=0),'invalid_latency');
  const sorted=[...values].sort((a,b)=>a-b),at=p=>sorted[Math.ceil(p*sorted.length)-1];
  return {samples:sorted.length,p50_ms:at(.5),p95_ms:at(.95),p99_ms:at(.99),max_ms:sorted.at(-1)};
};
export function validatePolicy(p) {
  assert.equal(p.version,3);assert.equal(p.generators,5);
  const special=p.sequence==='50_to_100';
  assert.ok((!special&&[25,50].includes(p.proposed_target))||(special&&p.proposed_target===100),'capacity_target');
  assert.deepEqual(p.stages.map(s=>s.players),special?[50,100]:p.proposed_target===25?[25]:[25,50]);
  assert.equal(p.supported_launch_target,special?50:p.proposed_target);
  if(special)assert.deepEqual(p.stages.map(s=>s.hold_seconds),[600,600],'50_then_100_full_holds');
  assert.ok(p.stages.every(s=>s.hold_seconds>=120&&s.players%p.generators===0));
  assert.ok((p.proposed_target===25||p.stages.at(-1).hold_seconds>=600)&&p.recovery_seconds>=60);
  assert.ok(p.initial_seconds>=90&&p.drain_seconds>=60&&p.recovery_players===5);
  for(const k of ['ramp_seconds','heartbeat_seconds','lease_seconds','cohort_timeout_seconds','arm_seconds','ack_margin_seconds','maximum_start_lateness_ms','maximum_arrival_lateness_ms','telemetry_bin_seconds','telemetry_settlement_seconds','telemetry_timeout_seconds','telemetry_preflight_requests','maximum_experiment_minutes','maximum_branch_lifetime_minutes','maximum_compute_cu','maximum_requests','maximum_response_bytes','maximum_project_reported_egress_delta_bytes'])assert.ok(Number.isSafeInteger(p[k])&&p[k]>0,k);
  assert.ok(p.lease_seconds>=3*p.heartbeat_seconds&&p.arm_seconds>p.ack_margin_seconds+p.lease_seconds);
  assert.ok(p.maximum_compute_cu<=8&&p.maximum_requests<=(special?50000:30000)&&p.maximum_branch_lifetime_minutes<=75&&p.telemetry_preflight_requests<=100);
  if(special) {
    assert.equal(p.maximum_experiment_minutes,60);assert.equal(p.maximum_runner_minutes,358);
    assert.equal(p.maximum_requests,50000);assert.equal(p.maximum_coordinator_queries,20000);
    assert.equal(p.maximum_response_bytes,268435456);
    assert.equal(p.maximum_project_reported_egress_delta_bytes,1073741824);
  }
  assert.ok(p.maximum_branch_lifetime_minutes*p.maximum_compute_cu/60<=p.emergency_compute_ceiling_cu_hours);
  assert.ok(p.maximum_experiment_minutes<p.maximum_branch_lifetime_minutes);
  assert.equal(p.maximum_error_fraction,0);assert.equal(p.maximum_legitimate_429s,0);assert.equal(p.maximum_correctness_failures,0);
  assert.deepEqual(Object.keys(p.route_budgets_ms).sort(),['pick','read','reroll','session','start','view']);
  for(const [route,b] of Object.entries(p.route_budgets_ms))assert.ok(b.p95>0&&b.p99>=b.p95&&p.minimum_route_samples[route]>0);
  return p;
}
// Ordinary PRs requalify the supported 25-player level. The longer 50-player
// experiment requires an explicit selection and keeps its original gates.
export function selectCapacityPolicy(p,target='25') {
  validatePolicy(p);
  assert.ok(['25','50','50-100'].includes(target),'capacity_target_must_be_25_50_or_50_100');
  const selected=structuredClone(p);
  if(target==='50-100') {
    // Single explicit temporary acceptance path: stage 0 is full 50-player gameplay,
    // followed only after all gates pass by 100 distinct actors. No 25-player warmup.
    assert.deepEqual(p.stages,[{players:25,hold_seconds:120},{players:50,hold_seconds:600}]);
    selected.sequence='50_to_100';
    selected.stages=[{players:50,hold_seconds:600},{players:100,hold_seconds:600}];
    selected.supported_launch_target=50;selected.proposed_target=100;
    selected.maximum_experiment_minutes=60;
    selected.maximum_runner_minutes=358;
    selected.maximum_requests=50000;
  } else {
    const players=Number(target);
    selected.stages=selected.stages.filter(s=>s.players<=players);
    selected.supported_launch_target=players;selected.proposed_target=players;
  }
  return validatePolicy(selected);
}
export function initialControl(scope,now,p) {
  validatePolicy(p);
  assert.match(scope.sha,/^[a-f0-9]{40}$/);assert.match(scope.policy_hash,/^[a-f0-9]{64}$/);
  assert.match(scope.run_id,/^\d+$/);assert.match(scope.attempt,/^\d+$/);
  assert.match(scope.branch,/^br-[a-z0-9-]+$/);
  assert.ok(!['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b'].includes(scope.branch));
  return {version:2,scope,created_at:now,stage:0,phase:'forming',forming_deadline:now+p.cohort_timeout_seconds*1000,cohort:{},history:[],failure:null};
}
export function transition(input,message,now,p) {
  const s=structuredClone(input),fail=(category,reason)=>{s.phase='aborted';s.failure={category,reason,at:now};return s;};
  if(['complete','aborted'].includes(s.phase))return s;
  if(!Number.isFinite(now)||now<s.created_at)return fail('generator','invalid_clock');
  if(now-s.created_at>p.maximum_experiment_minutes*60000)return fail('cost','experiment_deadline');
  if(fingerprint(message.scope)!==fingerprint(s.scope))return fail('generator','scope_mismatch');
  const id=message.shard;
  if(!Number.isInteger(id)||id<0||id>=p.generators||!/^[-a-f0-9]{36}$/.test(message.nonce||''))return fail('generator','invalid_generator');
  const previous=s.cohort[id];
  if(previous&&previous.nonce!==message.nonce)return fail('generator','duplicate_generator');
  if(!/^[a-f0-9]{64}$/.test(message.network||''))return fail('generator','missing_real_egress');
  if(previous&&previous.network!==message.network)return fail('generator','egress_changed');
  if(message.failure)return fail(['generator','application','correctness','cost','telemetry','safety'].includes(message.failure.category)?message.failure.category:'generator',/^[a-z0-9_]{1,80}$/.test(message.failure.reason||'')?message.failure.reason:'runner_failed');
  if(s.phase!=='forming'&&Object.values(s.cohort).some(r=>now-r.heartbeat_at>p.lease_seconds*1000))return fail('generator','lost_heartbeat');
  s.cohort[id]={...previous,nonce:message.nonce,network:message.network,heartbeat_at:now,
    ready:message.ready,ack:message.ack,done:message.done};
  const cohort=Object.values(s.cohort),fresh=cohort.every(r=>now-r.heartbeat_at<=p.lease_seconds*1000);
  if(new Set(cohort.map(r=>r.network)).size!==cohort.length)return fail('generator','duplicate_real_egress');
  if(s.phase!=='forming'&&!fresh)return fail('generator','lost_heartbeat');
  if(s.phase==='forming') {
    if(now>s.forming_deadline)return fail('generator','incomplete_cohort');
    if(cohort.length===p.generators&&fresh&&cohort.every(r=>r.ready===s.stage)) {
      s.phase='armed';s.start_at=now+p.arm_seconds*1000;s.armed_at=now;
    }
  } else if(s.phase==='armed') {
    if(now>=s.start_at-p.ack_margin_seconds*1000)return fail('generator','missing_start_ack');
    if(cohort.length===p.generators&&cohort.every(r=>r.ack===s.stage))s.phase='released';
  } else if(s.phase==='released') {
    const spec=p.stages[s.stage];
    const limit=s.start_at+(p.initial_seconds+spec.hold_seconds+p.drain_seconds+p.recovery_seconds+30)*1000;
    if(now>limit&&cohort.some(r=>r.done!==s.stage))return fail('generator','stage_deadline');
    if(cohort.every(r=>r.done===s.stage)){s.phase='checking';s.check_deadline=now+p.telemetry_timeout_seconds*1000;}
  } else if(s.phase==='checking') {
    if(now>s.check_deadline)return fail('telemetry','stage_evidence_deadline');
    if(message.decision) {
      if(id!==0||message.decision.stage!==s.stage)return fail('generator','invalid_stage_decision');
      if(!message.decision.passed)return fail(message.decision.category||'application',message.decision.reason||'stage_gate');
      // Positive telemetry and application results must both be explicit.
      if(message.decision.telemetry_passed!==true||message.decision.usage_passed!==true)return fail('telemetry','missing_positive_evidence');
      s.history.push(message.decision);s.stage++;
      if(s.stage===p.stages.length)s.phase='complete';
      else {s.phase='forming';s.forming_deadline=now+p.cohort_timeout_seconds*1000;delete s.start_at;}
    }
  }
  return s;
}
export function timing(start,spec,p) {
  const hold=start+p.initial_seconds*1000,drain=hold+spec.hold_seconds*1000,recovery=drain+p.drain_seconds*1000;
  return {start,hold,drain,recovery,end:recovery+p.recovery_seconds*1000};
}
export function permittedRequest(path,body) {
  const u=new URL(path,'https://api-preview.packone.pro');
  assert.equal(u.origin,'https://api-preview.packone.pro','fixed_private_preview_only');
  const post=body!==undefined;
  const ok=post ? ['/growth/v1/player/session','/growth/v1/account/link-browser','/draft/v1/runs'].includes(u.pathname)||/^\/draft\/v1\/runs\/[a-f0-9-]{36}\/(view|pick|reroll|share)$/.test(u.pathname)
    : ['/draft/health','/draft/v1/daily-status','/draft/v1/practice-sets','/draft/v1/leaderboard','/growth/v1/profile/me'].includes(u.pathname);
  assert.ok(ok,'side_effect_route_not_allowed');
  return u;
}
export function evaluateStage(reports,{scope,stage,start_at,networks},p) {
  const spec=p.stages[stage],windows=timing(start_at,spec,p),reasons=[];
  const reject=(category,reason)=>reasons.push({category,reason});
  if(reports.length!==p.generators||new Set(reports.map(r=>r.shard)).size!==p.generators)reject('generator','incomplete_or_duplicate_reports');
  for(const r of reports) {
    if(fingerprint(r.scope)!==fingerprint(scope)||r.stage!==stage||r.start_at!==start_at||!Number.isInteger(r.shard)||r.shard<0||r.shard>=p.generators)reject('generator','report_scope');
    if(r.network!==networks[r.shard])reject('generator','report_egress');
    if(!Number.isFinite(r.start_lateness_ms)||r.start_lateness_ms<0||r.start_lateness_ms>p.maximum_start_lateness_ms)reject('generator','start_lateness');
    if(r.started!==spec.players/p.generators||r.initial_completed!==spec.players/p.generators)reject('application','incomplete_initial_workload');
    if(!Number.isInteger(r.correctness_failures)||r.correctness_failures!==0||!Array.isArray(r.failures)||r.failures.length)reject(r.failure_category||'application','runner_failures');
    if(!Array.isArray(r.arrival_delay_ms)||r.arrival_delay_ms.length!==spec.players/p.generators||r.arrival_delay_ms.some(v=>!Number.isFinite(v)||v<0||v>p.maximum_arrival_lateness_ms))reject('generator','arrival_lateness');
    if(!Array.isArray(r.actors)||r.actors.length!==spec.players/p.generators||new Set(r.actors.map(a=>a.id)).size!==r.actors.length)reject('generator','actor_coverage');
    for(const a of r.actors||[])if(a.hold_entered_at<windows.hold||a.hold_entered_at>windows.hold+1000||a.hold_exited_at<windows.drain||!Number.isFinite(a.hold_entered_at)||!Number.isFinite(a.hold_exited_at)||(!a.guest&&a.hold_runs<1)||a.hold_reads<1)reject('generator','sustained_hold_incomplete');
    if(r.recovery_started_at>windows.recovery+1000||r.recovery_ended_at<windows.end||!Number.isFinite(r.recovery_started_at)||!Number.isFinite(r.recovery_ended_at))reject('generator','recovery_incomplete');
  }
  const requests=reports.flatMap(r=>r.requests||[]),routes={},phase_routes={};
  if(requests.some(r=>!Number.isFinite(r.ms)||r.ms<0||!Number.isFinite(r.at)||!Number.isInteger(r.status)||!Object.hasOwn(p.route_budgets_ms,r.route)||!['initial','hold','drain','recovery'].includes(r.phase)))reject('generator','invalid_request_evidence');
  const statuses=Object.fromEntries([...new Set(requests.map(r=>r.status))].map(s=>[s,requests.filter(r=>r.status===s).length]));
  if(requests.some(r=>r.status<200||r.status>=300))reject('application','request_error');
  for(const [route,budget] of Object.entries(p.route_budgets_ms)) {
    const rows=requests.filter(r=>r.route===route);routes[route]=quantiles(rows.map(r=>r.ms));
    if(rows.length<p.minimum_route_samples[route])reject('generator','missing_route_samples_'+route);
    if(rows.length&&(routes[route].p95_ms>budget.p95||routes[route].p99_ms>budget.p99))reject('application','route_latency_'+route);
  }
  for(const phase of ['initial','hold','recovery']) {
    phase_routes[phase]={};
    for(const [route,budget] of Object.entries(p.route_budgets_ms)) {
      const rows=requests.filter(r=>r.phase===phase&&r.route===route);if(!rows.length)continue;
      const q=quantiles(rows.map(r=>r.ms));phase_routes[phase][route]=q;
      if(q.p95_ms>budget.p95||q.p99_ms>budget.p99)reject('application',phase+'_latency_'+route);
    }
  }
  if(!phase_routes.hold.pick||!phase_routes.hold.reroll||!phase_routes.hold.read||!phase_routes.recovery.read)reject('generator','missing_phase_workload');
  const daily={};
  for(const environment of ['mixed','powered-cube','latest']) {
    const signatures=reports.flatMap(r=>r.daily?.[environment]||[]);daily[environment]=[...new Set(signatures)];
    if(signatures.some(s=>!/^[a-f0-9]{64}$/.test(s)))reject('correctness','invalid_daily_signature');
    if(!signatures.length)reject('generator','missing_daily_'+environment);
    else if(daily[environment].length!==1)reject('correctness','cross_generator_daily_mismatch');
  }
  const summary={schema:2,scope,stage,target:spec.players,generators:p.generators,distinct_real_egress:new Set(Object.values(networks)).size,
    start_at,windows,hold_seconds:spec.hold_seconds,recovery_seconds:p.recovery_seconds,requests:requests.length,statuses,routes,phase_routes,daily,
    initial_completed:reports.reduce((n,r)=>n+(r.initial_completed||0),0),hold_completed_runs:reports.reduce((n,r)=>n+(r.actors||[]).reduce((m,a)=>m+(a.hold_runs||0),0),0),
    correctness_failures:reports.reduce((n,r)=>n+(r.correctness_failures||0),0),reasons,passed:reasons.length===0};
  const actorIds=reports.flatMap(r=>(r.actors||[]).map(a=>a.id));
  if(actorIds.length!==spec.players||new Set(actorIds).size!==spec.players||actorIds.some(n=>!Number.isInteger(n)||n<0||n>=spec.players))reject('generator','global_actor_coverage');
  if(summary.distinct_real_egress!==p.generators)reject('generator','egress_count');
  summary.passed=reasons.length===0;return summary;
}

// Aggregate failure diagnostics only: no actor IDs, request bodies, network
// hashes, encrypted fixtures or raw provider error messages enter CI logs.
export function stageFailureEvidence(summary) {
  const code=value=>typeof value==='string'&&/^[a-z0-9_]{1,100}$/.test(value)?value:'unclassified';
  const number=value=>Number.isFinite(value)&&value>=0?value:null;
  const telemetry=summary.telemetry,usage=summary.usage;
  return {target:number(summary.target),passed:summary.passed===true,
    reasons:(summary.reasons||[]).map(r=>({category:code(r.category),reason:code(r.reason)})),
    telemetry:telemetry?{passed:telemetry.passed===true,reason:telemetry.reason?code(telemetry.reason):null,
      detail:telemetry.detail?code(telemetry.detail):null,
      failed_bins:(telemetry.bins||[]).filter(b=>!b.passed).map(b=>({from:number(b.from),to:number(b.to),
        client_requests:number(b.client_requests),retained_events:number(b.retained_events),required_events:number(b.required_events),
        failures:(b.failures||[]).map(code)}))}:null,
    usage:usage?{passed:usage.passed===true,reason:usage.reason?code(usage.reason):null,
      comparison_status:usage.comparison?.status?code(usage.comparison.status):null,
      delta_bytes:number(usage.comparison?.delta_bytes),ceiling_bytes:number(usage.ceiling_bytes)}:null};
}
