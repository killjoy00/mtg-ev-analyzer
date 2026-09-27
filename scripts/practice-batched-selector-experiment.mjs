import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {verifyTarget,summarize} from './practice-performance.mjs';

const PROJECT='patient-shadow-91417882';
const PRODUCTION='br-orange-feather-ayps8kep';
const branch=process.env.PACK1_BENCHMARK_BRANCH;
const connection=process.env.DATABASE_URL;
const key=process.env.NEON_API_KEY;
if(!branch||!connection||!key)throw Error('Experiment credentials are missing.');
process.env.PACK1_CAPACITY_DIAGNOSTICS='1';

const control=async suffix=>{
  const response=await fetch('https://console.neon.tech/api/v2/projects/'+PROJECT+'/branches/'+branch+suffix,{
    headers:{authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(30000),
  });
  if(!response.ok)throw Error('Experiment target verification failed.');
  return response.json();
};
const [branchData,endpointData]=await Promise.all([control(''),control('/endpoints')]);
const endpoint=verifyTarget({branch,connection,branchRecord:branchData.branch,endpoints:endpointData.endpoints||[]});
assert.equal(branchData.branch.parent_id,PRODUCTION);
assert.equal(Number(endpoint.autoscaling_limit_min_cu),0.25);
assert.equal(Number(endpoint.autoscaling_limit_max_cu),8);

const {query}=await import('../worker/growth-function.js');
const {
  selectDatabaseRun,selectBatchedDatabaseRun,currentPracticeBatchPlan,
  loadServingSnapshot,loadCachedCustomSetMetadata,
}=await import('../worker/draft-run-selection.mjs');
const {default:runApi}=await import('../worker/draft-run-function.mjs');
const {DRAFT_RUN_CORPUS_VERSION}=await import('../draft-run.mjs');
const {DRAFT_RUN_SELECTION_VERSION}=await import('../draft-run-policy.mjs');
const {DRAFT_RUN_DIFFICULTY_VERSION}=await import('../draft-run-difficulty.mjs');
const {SERVING_POLICY_VERSION}=await import('../serving-quality.mjs');
const {gameDateKey}=await import('../game-date.mjs');

const root=path.resolve('artifacts/practice-batched-selector');fs.mkdirSync(root,{recursive:true});
const report={
  schema:1,head_sha:process.env.GITHUB_SHA||null,branch,source_branch:PRODUCTION,
  scope:'bounded current-practice selector parity + synchronized direct full-start A/B; no gateway capacity claim',
  criterion:{maximum_candidate_full_start_p95_ms:2400,minimum_full_start_p95_improvement_fraction:0.20,maximum_candidate_full_start_p99_ms:8000},
  decision:{minimum_full_start_p95_improvement_fraction:0.15,rationale:'The original 20% predeclared bar remains recorded; after observing a clean 15.64% A/B improvement, the user explicitly approved 15% plus unchanged-gate headroom as sufficient to proceed.'},
  compute:{min_cu:Number(endpoint.autoscaling_limit_min_cu),max_cu:Number(endpoint.autoscaling_limit_max_cu),suspend_timeout_seconds:endpoint.suspend_timeout_seconds??null},
  parity:{cases:[],targeted:{}},benchmark:{waves:[],variants:{}},passed:false,started_at:new Date().toISOString(),
};
const save=()=>fs.writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2)+'\n');
const errorShape=e=>({message:String(e?.message||'error').slice(0,120),status:Number.isInteger(e?.status)?e.status:null});
const resource=async()=>{
  const row=(await control('')).branch;
  return {cpu_used_sec:Number(row.cpu_used_sec||0),compute_time_seconds:Number(row.compute_time_seconds||0),active_time_seconds:Number(row.active_time_seconds||0),data_transfer_bytes:Number(row.data_transfer_bytes||0),written_data_bytes:Number(row.written_data_bytes||0)};
};
const delta=(a,b)=>Object.fromEntries(Object.keys(a).map(k=>[k,Math.max(0,(b[k]||0)-(a[k]||0))]));

try {
  const day=gameDateKey();
  const snapshot=await loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION);
  const custom=await loadCachedCustomSetMetadata(query,DRAFT_RUN_CORPUS_VERSION,day);
  assert.ok(custom.length>=3,'Need three custom-practice sets.');
  report.snapshot={id:String(snapshot.id),revision:String(snapshot.revision),groups:snapshot.groups.length,day};
  report.custom_sets=custom.slice(0,3).map(s=>s.set_id);

  // Fixed reproducible parity corpus: five modes, four seeds each, same snapshot.
  const cases=[
    {name:'mixed',environment:'mixed',setIds:[]},
    {name:'powered-cube',environment:'powered-cube',setIds:[]},
    {name:'latest',environment:'latest',setIds:[]},
    {name:'custom-single',environment:'mixed',setIds:[custom[0].set_id]},
    {name:'custom-multi',environment:'mixed',setIds:custom.slice(0,3).map(s=>s.set_id)},
  ];
  for(const configuration of cases) {
    const item={...configuration,seeds:[]};report.parity.cases.push(item);
    for(let i=0;i<4;i++) {
      const seed='issue629-batched-parity-v1:'+configuration.name+':'+i;
      const baseline=await selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,seed,configuration.environment,{day,setIds:configuration.setIds,snapshot});
      const candidate=await selectBatchedDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,seed,configuration.environment,{day,setIds:configuration.setIds,snapshot});
      try { assert.deepEqual(candidate,baseline,configuration.name+' parity mismatch for '+seed); }
      catch(error) { report.parity.first_mismatch={name:configuration.name,seed,baseline,candidate};save();throw error; }
      item.seeds.push({seed,puzzle_ids:candidate.map(p=>p.puzzle_id),fingerprint:createHash('sha256').update(JSON.stringify(candidate)).digest('hex')});
    }
  }

  // Invalid custom sets retain the existing 400 outcome.
  for(const fn of [selectDatabaseRun,selectBatchedDatabaseRun]) {
    await assert.rejects(
      fn(query,DRAFT_RUN_CORPUS_VERSION,'issue629-invalid-custom','mixed',{day,setIds:['not-a-live-set'],snapshot}),
      e=>e.status===400,
    );
  }
  report.parity.targeted.invalid_custom_400=true;

  // Synthetic snapshot view of the same immutable inventory exercises easy->medium.
  const fallbackSet=custom[0].set_id;
  // Exercise the round-level fallback without forced custom slots: required-set
  // assignment itself intentionally rejects a missing planned band before the
  // round loop, so a custom-only fixture would never reach easy->medium.
  const fallbackSnapshot={...snapshot,groups:snapshot.groups.filter(g=>Number(g.pick_number)<=8&&['medium','hard'].includes(g.band))};
  const fallbackSeed='issue629-easy-fallback-v1';
  const fallbackPlan=currentPracticeBatchPlan(fallbackSnapshot,fallbackSeed,'mixed',{day});
  const easyRound=fallbackPlan.plan.bands.findIndex(b=>b==='easy');
  assert.ok(easyRound>=0);
  const fallbackBaseline=await selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,fallbackSeed,'mixed',{day,snapshot:fallbackSnapshot});
  const fallbackCandidate=await selectBatchedDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,fallbackSeed,'mixed',{day,snapshot:fallbackSnapshot});
  assert.deepEqual(fallbackCandidate,fallbackBaseline);
  assert.equal(fallbackCandidate[easyRound].band,'medium');
  report.parity.targeted.easy_to_medium={round:easyRound,puzzle_id:fallbackCandidate[easyRound].puzzle_id};

  // A plan with only medium groups must fail at the first hard slot, preserving 503.
  const insufficientSnapshot={...snapshot,groups:snapshot.groups.filter(g=>g.set_id===fallbackSet&&Number(g.pick_number)<=8&&g.band==='medium')};
  const insufficientSeed='issue629-insufficient-v1';
  for(const fn of [selectDatabaseRun,selectBatchedDatabaseRun]) {
    await assert.rejects(fn(query,DRAFT_RUN_CORPUS_VERSION,insufficientSeed,'mixed',{day,snapshot:insufficientSnapshot}),e=>e.status===503);
  }
  report.parity.targeted.insufficient_corpus_503=true;

  // Snapshot identity/revision is pinned inside the one-call function itself.
  const validPlan=currentPracticeBatchPlan(snapshot,'issue629-revision-v1','mixed',{day}).plan;
  const badRevision=String(BigInt(snapshot.revision)+1n);
  const revisionResult=(await query(
    'SELECT pack1_select_serving_run_v1($1::bigint,$2::bigint,$3,$4,$5,$6::jsonb) selection',
    [snapshot.id,badRevision,DRAFT_RUN_CORPUS_VERSION,DRAFT_RUN_DIFFICULTY_VERSION,SERVING_POLICY_VERSION,JSON.stringify(validPlan)],
  )).rows[0].selection;
  const revisionPayload=typeof revisionResult==='string'?JSON.parse(revisionResult):revisionResult;
  assert.equal(revisionPayload.ok,false);assert.equal(revisionPayload.error,'snapshot_unavailable');assert.equal(Number(revisionPayload.draws_used),0);
  report.parity.targeted.revision_pin={error:revisionPayload.error,draws_used:Number(revisionPayload.draws_used)};

  // Audit random-draw accounting on successful plans.
  for(const configuration of cases) {
    const planned=currentPracticeBatchPlan(snapshot,'issue629-draw-audit:'+configuration.name,configuration.environment,{day,setIds:configuration.setIds});
    assert.ok(Number.isInteger(planned.planningDraws)&&planned.planningDraws>=6);
    assert.equal(planned.plan.round_randoms.length,8);
  }
  report.parity.targeted.random_draw_paths='planning counted in JS; SQL success requires draws_used=16; pre-choice failures return 2*round and post-choice failures are bounded by returned draws_used';

  // Build isolated signed-in practice actors. No provider calls and no production writes.
  const tag=randomBytes(4).toString('hex'),digest=x=>createHash('sha256').update(x).digest('hex');
  const secret=(await query("SELECT value FROM settings WHERE key='player_secret'")).rows[0].value;
  const users=Array.from({length:100},(_,i)=>{
    const player=randomUUID(),auth=randomUUID(),account=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
    return {player,auth,account,csrf,account_hash:digest(account),csrf_hash:digest(csrf),name:'Batch'+tag+'x'+i,
      token:'p1_'+player+'.'+createHmac('sha256',secret).update(player).digest('base64url')};
  });
  const stored=JSON.stringify(users.map(({account,csrf,token,...row})=>row));
  await query(`INSERT INTO neon_auth."user"(id,name,email,"emailVerified")
    SELECT (u->>'auth')::uuid,u->>'name',(u->>'auth')||'@example.invalid',true FROM jsonb_array_elements($1::jsonb) u`,[stored]);
  await query(`INSERT INTO players(id,display_name,username_owned,profile_public)
    SELECT (u->>'player')::uuid,u->>'name',true,true FROM jsonb_array_elements($1::jsonb) u`,[stored]);
  await query(`INSERT INTO account_links(auth_user_id,player_id)
    SELECT (u->>'auth')::uuid,(u->>'player')::uuid FROM jsonb_array_elements($1::jsonb) u`,[stored]);
  await query(`INSERT INTO account_sessions(session_hash,auth_user_id,csrf_hash,expires_at)
    SELECT u->>'account_hash',(u->>'auth')::uuid,u->>'csrf_hash',now()+interval '2 hours' FROM jsonb_array_elements($1::jsonb) u`,[stored]);
  await query(`INSERT INTO entitlement_grants(auth_user_id,capability,provider,provider_reference)
    SELECT (u->>'auth')::uuid,c,'patreon',$2 FROM jsonb_array_elements($1::jsonb) u
    CROSS JOIN unnest(ARRAY['unlimited_cube_practice','custom_corpus']) c`,[stored,tag]);

  let cursor=0;
  const measurements={baseline:[],candidate:[]};
  const bodies=[
    {environment:'mixed'},
    {environment:'powered-cube'},
    {environment:'mixed',setIds:[custom[0].set_id]},
    {environment:'mixed',setIds:custom.slice(0,3).map(s=>s.set_id)},
  ];
  const startOne=async(variant,user,index)=>{
    const body=bodies[index%bodies.length];
    const headers={
      origin:'https://packone.pro','content-type':'application/json',
      authorization:'Bearer '+user.token,
      cookie:`__Host-pack1_player=${user.token}; __Host-pack1_account=${user.account}; __Secure-pack1_csrf=${user.csrf}`,
      'x-pack1-csrf':user.csrf,'x-idempotency-key':randomBytes(18).toString('base64url'),
    };
    const started=performance.now();
    const response=await runApi.fetch(new Request('https://api-preview.packone.pro/v1/runs',{method:'POST',headers,body:JSON.stringify(body)}));
    const full_ms=Math.round((performance.now()-started)*100)/100;
    let diagnostic=null;try{diagnostic=JSON.parse(response.headers.get('x-pack1-start-timing')||'null');}catch{}
    const data=await response.json();
    return {variant,mode:index%bodies.length,status:response.status,full_ms,selection_ms:Number(diagnostic?.phases?.selection??NaN),
      selector:diagnostic?.selector||null,error:response.ok?null:String(data?.error||'http_'+response.status).slice(0,120)};
  };
  const wave=async(variant,count,warmup=false)=>{
    process.env.PACK1_BATCHED_SELECTION_EXPERIMENT=variant==='candidate'?'1':'0';
    const slice=users.slice(cursor,cursor+count);cursor+=count;
    const before=await resource();
    const rows=await Promise.all(slice.map((user,i)=>startOne(variant,user,i)));
    const after=await resource();
    if(warmup) {
      (report.benchmark.warmups||=[]).push({variant,rows});
      save();
    } else {
      measurements[variant].push(...rows);
      report.benchmark.waves.push({variant,count,resource_delta:delta(before,after),
        full_start:summarize(rows.map(r=>r.full_ms)),selection:summarize(rows.map(r=>r.selection_ms).filter(Number.isFinite)),
        errors:rows.filter(r=>r.status<200||r.status>=300).length});
    }
    assert.equal(rows.filter(r=>r.status<200||r.status>=300).length,0,variant+' start errors');
  };

  // Equal warm-up, then alternating paired 10-way waves to avoid order/autoscale bias.
  await wave('baseline',4,true);await wave('candidate',4,true);
  for(let i=0;i<4;i++) {
    const order=i%2===0?['baseline','candidate']:['candidate','baseline'];
    for(const variant of order)await wave(variant,10,false);
  }
  for(const variant of ['baseline','candidate']) {
    const rows=measurements[variant];
    report.benchmark.variants[variant]={
      samples:rows.length,errors:rows.filter(r=>r.status<200||r.status>=300).length,
      full_start:summarize(rows.map(r=>r.full_ms)),
      selection:summarize(rows.map(r=>r.selection_ms).filter(Number.isFinite)),
      statuses:Object.fromEntries([...new Set(rows.map(r=>r.status))].map(s=>[s,rows.filter(r=>r.status===s).length])),
    };
  }
  const base=report.benchmark.variants.baseline,cand=report.benchmark.variants.candidate;
  report.benchmark.improvement_fraction=1-cand.full_start.p95_ms/base.full_start.p95_ms;
  report.benchmark.criterion_passed=cand.errors===0&&cand.full_start.p95_ms<=report.criterion.maximum_candidate_full_start_p95_ms&&
    cand.full_start.p99_ms<=report.criterion.maximum_candidate_full_start_p99_ms&&
    report.benchmark.improvement_fraction>=report.criterion.minimum_full_start_p95_improvement_fraction;
  report.benchmark.approved_decision_passed=cand.errors===0&&cand.full_start.p95_ms<=report.criterion.maximum_candidate_full_start_p95_ms&&
    cand.full_start.p99_ms<=report.criterion.maximum_candidate_full_start_p99_ms&&
    report.benchmark.improvement_fraction>=report.decision.minimum_full_start_p95_improvement_fraction;

  // Target source-overlap + trajectory/inventory divergence on this disposable snapshot.
  const overlapSeed='issue629-trajectory-divergence-v1';
  const overlapBefore=await selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,overlapSeed,'mixed',{day,setIds:[fallbackSet],snapshot});
  const chosenSource=overlapBefore[0].source_draft_hash;
  const later=(await query(`SELECT snapshot_id,puzzle_id,set_id,pick_number,band,source_draft_hash
    FROM draft_run_serving_inventory WHERE snapshot_id=$1::bigint AND source_draft_hash=$2 AND pick_number BETWEEN 2 AND 8
    ORDER BY pick_number,puzzle_id COLLATE "C" LIMIT 1`,[snapshot.id,chosenSource])).rows[0];
  assert.ok(later,'Selected source must overlap a later inventory round.');
  const originalGroups=JSON.stringify(snapshot.groups);
  await query('DELETE FROM draft_run_serving_inventory WHERE snapshot_id=$1::bigint AND puzzle_id=$2',[snapshot.id,later.puzzle_id]);
  await query(`UPDATE draft_run_serving_snapshots SET groups=(
    SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY g.set_id,g.pick_number,g.band),'[]'::jsonb)
    FROM (SELECT set_id,pick_number,band,count(*)::int n,count(DISTINCT source_draft_hash)::int sources
      FROM draft_run_serving_inventory WHERE snapshot_id=$1::bigint GROUP BY set_id,pick_number,band) g
  ) WHERE id=$1::bigint`,[snapshot.id]);
  const divergent=await loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION);
  const trajectoryRows=Number((await query(`SELECT count(*)::int n FROM draft_run_verified_puzzles p
    JOIN draft_run_puzzle_ratings r ON r.puzzle_id=p.puzzle_id AND r.difficulty_version='support-ratio-v1'
    WHERE p.source_draft_hash=$1 AND p.interesting AND p.pack_number=1
      AND r.target_support_ratio>=0.20526315789473684::float8`,[chosenSource])).rows[0].n);
  const inventoryRows=Number((await query('SELECT count(*)::int n FROM draft_run_serving_inventory WHERE snapshot_id=$1::bigint AND source_draft_hash=$2',[snapshot.id,chosenSource])).rows[0].n);
  assert.ok(trajectoryRows>inventoryRows,'Synthetic divergence was not created.');
  const overlapBaseline=await selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,overlapSeed,'mixed',{day,setIds:[fallbackSet],snapshot:divergent});
  const overlapCandidate=await selectBatchedDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,overlapSeed,'mixed',{day,setIds:[fallbackSet],snapshot:divergent});
  assert.deepEqual(overlapCandidate,overlapBaseline);
  report.parity.targeted.source_overlap_trajectory_divergence={source_rows:{trajectory:trajectoryRows,inventory:inventoryRows},removed_inventory_puzzle:later.puzzle_id,exact_parity:true};

  // Restore before the depletion fixture.
  await query('INSERT INTO draft_run_serving_inventory(snapshot_id,puzzle_id,set_id,pick_number,band,source_draft_hash) VALUES($1::bigint,$2,$3,$4::int,$5,$6)',[later.snapshot_id,later.puzzle_id,later.set_id,later.pick_number,later.band,later.source_draft_hash]);
  await query('UPDATE draft_run_serving_snapshots SET groups=$2::jsonb WHERE id=$1::bigint',[snapshot.id,originalGroups]);

  // Deplete one later group in the compact snapshot counts without invalidating
  // custom-set eligibility or changing inventory membership. Setting n=1 while
  // retaining the original sources count makes the first selected source's
  // broader trajectory decrement drive this later medium/hard group to zero.
  const depletionSeed='issue629-depletion-v1';
  const depletionPlan=currentPracticeBatchPlan(snapshot,depletionSeed,'mixed',{day,setIds:[fallbackSet]});
  const depletionBefore=await selectDatabaseRun(query,DRAFT_RUN_CORPUS_VERSION,depletionSeed,'mixed',{day,setIds:[fallbackSet],snapshot});
  const firstSource=depletionBefore[0].source_draft_hash;
  const sourceRows=(await query(`SELECT puzzle_id,set_id,pick_number,band,source_draft_hash FROM draft_run_serving_inventory
    WHERE snapshot_id=$1::bigint AND source_draft_hash=$2 AND pick_number BETWEEN 2 AND 8 ORDER BY pick_number`,[snapshot.id,firstSource])).rows;
  const target=sourceRows.find(r=>r.band===depletionPlan.plan.bands[Number(r.pick_number)-1]&&r.band!=='easy');
  assert.ok(target,'Need a later medium/hard source row for depletion.');
  const depletedGroups=snapshot.groups.map(g=>
    g.set_id===target.set_id&&Number(g.pick_number)===Number(target.pick_number)&&g.band===target.band
      ?{...g,n:1}:g
  );
  assert.equal(Number(depletedGroups.find(g=>g.set_id===target.set_id&&Number(g.pick_number)===Number(target.pick_number)&&g.band===target.band)?.n),1);
  const originalGroups=JSON.stringify(snapshot.groups);
  await query('UPDATE draft_run_serving_snapshots SET groups=$2::jsonb WHERE id=$1::bigint',[snapshot.id,JSON.stringify(depletedGroups)]);
  const depleted=await loadServingSnapshot(query,DRAFT_RUN_CORPUS_VERSION);
  const failures=[];
  for(const fn of [selectDatabaseRun,selectBatchedDatabaseRun]) {
    try {await fn(query,DRAFT_RUN_CORPUS_VERSION,depletionSeed,'mixed',{day,setIds:[fallbackSet],snapshot:depleted});failures.push(null);}
    catch(e){failures.push(errorShape(e));}
  }
  await query('UPDATE draft_run_serving_snapshots SET groups=$2::jsonb WHERE id=$1::bigint',[snapshot.id,originalGroups]);
  assert.deepEqual(failures.map(x=>x?.status),[503,503]);
  report.parity.targeted.depleted_group={pick:Number(target.pick_number),band:target.band,baseline:failures[0],candidate:failures[1],synthetic_group_n:1,custom_eligibility_preserved:true};

  report.parity.passed=true;
  report.passed=report.parity.passed&&report.benchmark.approved_decision_passed;
} catch(error) {
  report.error=errorShape(error);
} finally {
  delete process.env.PACK1_BATCHED_SELECTION_EXPERIMENT;
  report.finished_at=new Date().toISOString();save();
}
console.log(JSON.stringify({passed:report.passed,parity:report.parity.passed===true,predeclared_benchmark:report.benchmark.criterion_passed===true,approved_benchmark:report.benchmark.approved_decision_passed===true,
  baseline:report.benchmark.variants.baseline||null,candidate:report.benchmark.variants.candidate||null,
  improvement_fraction:report.benchmark.improvement_fraction??null,error:report.error||null}));
if(!report.passed)process.exitCode=1;
