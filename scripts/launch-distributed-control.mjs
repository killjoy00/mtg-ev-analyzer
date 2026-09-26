// The only coordinator is a tiny CAS row in the verified disposable branch.
// Credentials stay inside the authenticated encrypted fixture bundle.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {verifyTarget} from './practice-performance.mjs';
import {PROJECT,projectSnapshot,compareSnapshots} from './neon-egress-evidence.mjs';
import {fingerprint,initialControl,transition,validatePolicy} from './launch-distributed-core.mjs';
export const policy=validatePolicy(JSON.parse(fs.readFileSync(new URL('./launch-distributed-policy.json',import.meta.url),'utf8')));
const api='https://console.neon.tech/api/v2/projects/'+PROJECT;
export async function metadata(suffix='',{key=process.env.NEON_API_KEY,fetcher=fetch}={}) {
  assert.ok(key,'missing_metadata_credential');
  const r=await fetcher(api+suffix,{headers:{authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Object.assign(Error('metadata_http_'+r.status),{category:'cost'});
  return r.json();
}
export async function verifyFixture(fixture,{fetcher=fetch}={}) {
  assert.equal(fixture.branch,process.env.PREVIEW_BRANCH,'branch_context');
  assert.equal(fixture.sha,process.env.GITHUB_SHA,'sha_context');
  const [b,e]=await Promise.all([metadata('/branches/'+fixture.branch,{fetcher}),metadata('/branches/'+fixture.branch+'/endpoints',{fetcher})]);
  const endpoint=verifyTarget({branch:fixture.branch,connection:fixture.connection,branchRecord:b.branch,endpoints:e.endpoints||[]});
  assert.ok(Number(endpoint.autoscaling_limit_min_cu)>=.25&&Number(endpoint.autoscaling_limit_max_cu)<=policy.maximum_compute_cu&&Number(endpoint.autoscaling_limit_min_cu)<=Number(endpoint.autoscaling_limit_max_cu),'compute_limit');
  assert.equal(Number(endpoint.suspend_timeout_seconds??endpoint.suspend_timeout),300,'suspend_timeout');
  const expires=Date.parse(b.branch.expires_at),created=Date.parse(b.branch.created_at);
  assert.ok(Number.isFinite(expires)&&expires>Date.now()&&expires-created<=policy.maximum_branch_lifetime_minutes*60000+1000,'bounded_branch_expiry');
  return {branch:fixture.branch,created_at:b.branch.created_at,expires_at:b.branch.expires_at,
    compute:{min_cu:Number(endpoint.autoscaling_limit_min_cu),max_cu:Number(endpoint.autoscaling_limit_max_cu),suspend_seconds:endpoint.suspend_timeout_seconds??endpoint.suspend_timeout??null}};
}
export function coordinatorSQL(connection,{fetcher=fetch,onQuery=()=>{}}={}) {
  const url=new URL(connection);assert.ok(url.hostname.endsWith('.neon.tech')&&url.pathname==='/pack1','isolated_database');
  const parts=url.hostname.split('.');parts[0]='api';const endpoint='https://'+parts.join('.')+'/sql';
  return async(query,params=[])=>{
    // No arbitrary application SQL through this transport.
    assert.ok(/pack1_load_control_v2|pack1_load_reports_v2/.test(query),'coordinator_tables_only');
    onQuery();const response=await fetcher(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{'content-type':'application/json','Neon-Connection-String':connection,'Neon-Raw-Text-Output':'true','Neon-Array-Mode':'true'},
      body:JSON.stringify({query,params:params.map(v=>v==null?null:String(v))})});
    if(!response.ok)throw Error('coordinator_transport_failed');
    const data=await response.json();assert.ok(Array.isArray(data.fields)&&Array.isArray(data.rows),'coordinator_schema');
    const names=data.fields.map(f=>f.name);return data.rows.map(r=>Object.fromEntries(r.map((v,i)=>[names[i],v])));
  };
}
export async function readControl(sql) {
  const [row]=await sql('SELECT revision,state,(extract(epoch FROM clock_timestamp())*1000)::bigint AS now_ms FROM pack1_load_control_v2 WHERE id=1');
  assert.ok(row&&Number.isSafeInteger(Number(row.revision)),'missing_coordinator');
  return {revision:Number(row.revision),state:JSON.parse(row.state),now:Number(row.now_ms)};
}
export async function heartbeat(sql,message,{onClock=()=>{}}={}) {
  for(let attempt=0;attempt<25;attempt++) {
    const before=Date.now(),row=await readControl(sql),after=Date.now();
    onClock({server:row.now,before,after});
    const next=transition(row.state,message,row.now,policy);
    if(['complete','aborted'].includes(row.state.phase))return row.state;
    const updated=await sql('UPDATE pack1_load_control_v2 SET state=$1::jsonb,revision=revision+1 WHERE id=1 AND revision=$2::bigint RETURNING revision',[JSON.stringify(next),row.revision]);
    if(updated.length===1)return next;
    await new Promise(resolve=>setTimeout(resolve,25+Math.floor(Math.random()*50)));
  }
  throw Error('coordinator_contention');
}
export async function storeReport(sql,report) {
  const rows=await sql('INSERT INTO pack1_load_reports_v2(stage,shard,report) VALUES ($1::integer,$2::integer,$3::jsonb) ON CONFLICT(stage,shard) DO NOTHING RETURNING shard',[report.stage,report.shard,JSON.stringify(report)]);
  assert.equal(rows.length,1,'duplicate_stage_report');
}
export async function readReports(sql,stage) {
  return (await sql('SELECT report FROM pack1_load_reports_v2 WHERE stage=$1::integer ORDER BY shard',[stage])).map(row=>JSON.parse(row.report));
}
export async function usageGate(baseline,{fetcher=fetch}={}) {
  const current=projectSnapshot((await metadata('',{fetcher})).project,new Date().toISOString()),comparison=compareSnapshots(baseline,current);
  return {current,comparison,ceiling_bytes:policy.maximum_project_reported_egress_delta_bytes,
    passed:comparison.status==='reported_counter_delta'&&comparison.delta_bytes<=policy.maximum_project_reported_egress_delta_bytes,
    attribution:'Entire project, all branches, unwatermarked provider counter. Not attributable to this test and not a hard provider-egress cap.'};
}
async function initialize() {
  assert.equal(process.env.PREVIEW_CREATED,'true','fresh_branch_required');
  const file=process.env.LOAD_FIXTURE_FILE,fixture=JSON.parse(fs.readFileSync(file,'utf8'));
  fixture.connection=process.env.DATABASE_URL;
  const verified=await verifyFixture(fixture),sql=coordinatorSQL(fixture.connection);
  const scope={sha:fixture.sha,branch:fixture.branch,run_id:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,policy_hash:fingerprint(policy)};
  await sql('CREATE TABLE pack1_load_control_v2(id integer PRIMARY KEY CHECK(id=1),revision bigint NOT NULL DEFAULT 0,state jsonb NOT NULL)');
  await sql('CREATE TABLE pack1_load_reports_v2(stage integer NOT NULL,shard integer NOT NULL,report jsonb NOT NULL,PRIMARY KEY(stage,shard))');
  await sql("INSERT INTO pack1_load_control_v2(id,state) VALUES (1,jsonb_set(jsonb_set($1::jsonb,'{created_at}',to_jsonb((extract(epoch FROM clock_timestamp())*1000)::bigint)),'{forming_deadline}',to_jsonb((extract(epoch FROM clock_timestamp())*1000)::bigint+480000)))",[JSON.stringify(initialControl(scope,Date.now(),policy))]);
  fixture.scope=scope;fixture.verified=verified;fixture.usage_baseline=JSON.parse(fs.readFileSync('artifacts/launch-load/usage-before-provisioning.json','utf8'));
  const usage=await usageGate(fixture.usage_baseline);assert.ok(usage.passed,'preparation_usage_gate');
  fs.writeFileSync(file,JSON.stringify(fixture),{mode:0o600});
  fs.mkdirSync('artifacts/launch-load',{recursive:true});
  fs.writeFileSync('artifacts/launch-load/experiment-declaration.json',JSON.stringify({scope,policy,verified,usage_baseline:fixture.usage_baseline},null,2));
  console.log('Exact disposable branch, bounded compute/expiry, policy and coordinator verified.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)initialize().catch(error=>{console.error(JSON.stringify({error:'disposable_coordinator_initialization_failed',code:error.code||null,line:String(error.stack).match(/launch-distributed-[a-z]+\.mjs:(\d+)/)?.[0]||null}));process.exitCode=1;});
