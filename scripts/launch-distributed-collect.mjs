import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {unseal} from './launch-distributed-bundle.mjs';
import {policy} from './launch-distributed-control.mjs';
import {evaluateStage,fingerprint,stageFailureEvidence} from './launch-distributed-core.mjs';
const root='artifacts/distributed-results',files=fs.existsSync(root)?fs.readdirSync(root,{recursive:true}):[];
const named=pattern=>files.filter(f=>pattern.test(path.basename(f))).map(f=>JSON.parse(fs.readFileSync(path.join(root,f),'utf8')));
const declarations=named(/^experiment-declaration\.json$/),preflights=named(/^telemetry-preflight\.json$/),cohorts=named(/^cohort-\d\.json$/),summaries=named(/^distributed-stage-\d+\.json$/),reasons=[];
const reject=reason=>reasons.push(reason);
const declaration=declarations[0],scope=declaration?.scope;
if(declarations.length!==1||scope?.sha!==process.env.GITHUB_SHA||scope?.run_id!==process.env.GITHUB_RUN_ID||scope?.attempt!==process.env.GITHUB_RUN_ATTEMPT||scope?.policy_hash!==fingerprint(policy))reject('declaration_missing_or_wrong_revision');
const preflight=preflights[0];
if(preflights.length!==1||preflight?.passed!==true||preflight?.sha!==scope?.sha||preflight?.health_requests!==policy.telemetry_preflight_requests)reject('telemetry_preflight_missing_or_failed');
if(cohorts.length!==policy.generators||new Set(cohorts.map(r=>r.shard)).size!==policy.generators||cohorts.some(r=>fingerprint(r.scope)!==fingerprint(scope)||!r.passed))reject('cohort_incomplete_or_failed');
const stages=[];
for(let stage=0;stage<policy.stages.length;stage++) {
  try {
    const retained=summaries.filter(s=>s.stage===stage);assert.equal(retained.length,1);
    const reports=named(new RegExp('^distributed-'+stage+'-\\d\\.json$')).map(r=>({...r,network:unseal(r.egress).network}));
    const networks=Object.fromEntries(reports.map(r=>[r.shard,r.network])),recomputed=evaluateStage(reports,{scope,stage,start_at:retained[0].start_at,networks},policy);
    assert.equal(recomputed.passed,true);assert.equal(retained[0].passed,true);assert.equal(retained[0].telemetry.passed,true);assert.equal(retained[0].usage.passed,true);
    assert.equal(recomputed.requests,retained[0].requests);assert.deepEqual(recomputed.routes,retained[0].routes);
    assert.ok(cohorts.every(c=>c.history?.[stage]?.digest===fingerprint(retained[0])),'stage_decision_digest');stages.push(retained[0]);
  } catch {reject('stage_'+policy.stages[stage].players+'_missing_or_failed');}
}
const failuresFromReports=named(/^distributed-[0-9]+-[0-4]\.json$/).filter(r=>r.root_failure);
const root_failures=failuresFromReports.map(r=>{
  const f=r.root_failure||{},request=Number.isInteger(f.request_index)?r.requests?.[f.request_index]:null;
  const gateway=request?.diagnostics?.gateway||{};
  return {stage_index:r.stage,stage_players:policy.stages[r.stage]?.players||null,
    generator:r.shard,category:f.category||null,reason:f.reason||null,
    request_index:f.request_index??null,route:f.latency?.route||request?.route||null,
    endpoint:request?.endpoint||null,phase:request?.phase||null,
    request_start_at:request?.at??null,http_status:request?.status??null,
    client_ms:request?.ms??null,socket:request?.transport?.socket||null,
    connect_ms:request?.transport?.connect_ms??null,
    gateway_ms:gateway.duration_ms??null,quota_ms:gateway.quota_ms??null,
    upstream_ms:gateway.upstream_ms??null,
    latency:f.latency||null};
});
const independent_triggers=root_failures.filter(f=>f.reason!=='cohort_aborted'&&f.reason!=='runner_or_evidence_failed');
const primary_trigger=independent_triggers.length===1?independent_triggers[0]:null;
const budget=cohorts.reduce((n,c)=>{for(const key of Object.keys(n))n[key]+=c.budget?.[key]||0;return n;},{gateway_requests:preflight?.health_requests||0,response_bytes:0,coordinator_queries:0});
if(budget.gateway_requests>policy.maximum_requests||budget.response_bytes>policy.maximum_response_bytes||budget.coordinator_queries>policy.maximum_coordinator_queries)reject('aggregate_resource_ceiling');
const report={scope,policy,verified:declaration?.verified,budget,stages,reasons,passed:!reasons.length,
  historical_supported_distributed_players:50,candidate_distributed_players:!reasons.length?policy.proposed_target:null,
  root_failures,primary_trigger,first_stage_has_no_25_player_warmup:policy.sequence==='50_to_100',
  capacity_claim:'Not promoted until private ingress removal and disposable branch deletion are separately verified. Five-network finite mixed-lifecycle evidence only; not universal backend capacity or indefinite endurance.'};
fs.mkdirSync('artifacts/launch-load',{recursive:true});fs.writeFileSync('artifacts/launch-load/distributed-acceptance.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,reasons,budget,passed_stages:stages.map(s=>s.target),
  failed_stages:summaries.filter(s=>!s.passed).map(stageFailureEvidence),
  primary_trigger,root_failures,
  cohort_failures:cohorts.filter(c=>c.failure).map(c=>({shard:c.shard,category:c.failure.category,reason:c.failure.reason}))}));
if(!report.passed)process.exitCode=1;
