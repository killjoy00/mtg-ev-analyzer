import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {decisionClock} from '../decision-clock.mjs';
import {measurementInput,observeDecisionForRequest} from '../worker/decision-measurements.mjs';
import {reportFilters,handleAdmin} from '../worker/measurement-admin.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
test('foreground timing excludes hidden time and resets only for a new decision',()=>{
  let time=0;const c=decisionClock(()=>time),id=c.show('run:0');
  time=1200;c.pause();time=40000;c.resume();time=41500;
  assert.deepEqual(c.sample(),{viewId:id,activeMs:2700});
  assert.equal(c.show('run:0'),id);c.clear();time=45000;
  assert.equal(c.sample().activeMs,0);assert.notEqual(c.show('run:1'),id);
});
test('invalid client time becomes missing rather than clamped into a useful-looking value',()=>{
  for(const activeMs of [-1,NaN,Infinity,1800001,'100',1.5])assert.equal(measurementInput({activeMs}).activeMs,null);
  assert.equal(measurementInput({activeMs:0}).activeMs,0);
  assert.equal(measurementInput({viewId:'not-uuid'}).viewId,null);
});
test('view request validation keeps ownership and revision errors ahead of view ID errors',async()=>{
  const id=crypto.randomUUID(),owner=crypto.randomUUID(),body={revision:0,puzzleId:'p',viewId:crypto.randomUUID()};
  for(const [row,status] of [[{found:false,matches:false,ok:false},404],[{found:true,matches:false,ok:false},409]]) {
    await assert.rejects(()=>observeDecisionForRequest(async()=>({rows:[row]}),id,owner,{...body,viewId:'bad'}),e=>e.status===status);
  }
  await assert.rejects(()=>observeDecisionForRequest(async()=>({rows:[{found:true,matches:true,ok:false}]}),id,owner,{...body,viewId:'bad'}),e=>e.status===400);
  let calls=0;
  assert.deepEqual(await observeDecisionForRequest(async(_sql,params)=>{
    calls++;assert.deepEqual(params,[id,owner,0,'p',body.viewId,true]);
    return {rows:[{found:'t',matches:'t',ok:'t'}]};
  },id,owner,body),{ok:true});
  assert.equal(calls,1);
});
test('reports reject malformed dates and filters and bound the query range',()=>{
  for(const qs of ['from=2026-02-30','from=2020-01-01&to=2026-01-01','from=2026-09-12&to=2026-09-11','environment=bad','set=%27'])
    assert.throws(()=>reportFilters(new URL('https://test/?'+qs)));
  const filters=reportFilters(new URL('https://test/?from=2026-09-01&to=2026-09-12'));
  assert.equal(filters.start,'2026-09-01');
  assert.equal(filters.corpus_version,DRAFT_RUN_CORPUS_VERSION);
  assert.equal(filters.params.at(-1),DRAFT_RUN_CORPUS_VERSION);
  const all=reportFilters(new URL('https://test/?from=2026-09-01&to=2026-09-12&corpus=all'));
  assert.equal(all.corpus_version,'all');
  assert.equal(all.params.length,filters.params.length,'corpus=all keeps the parameter positions');
  assert.equal(all.params.at(-1),'all');
  assert.throws(()=>reportFilters(new URL('https://test/?corpus=elite-trophy-colour-stage-v9')));
});
test('admin report defaults stay on the Pack One Pacific day across the UTC boundary',()=>{
  const filters=reportFilters(new URL('https://test/'),new Date('2026-10-07T01:30:00Z'));
  assert.equal(filters.end,'2026-10-06');
  assert.equal(filters.start,'2026-09-07');
});
test('admin reports never accept a guest player token and deny ordinary accounts',async()=>{
  let reads=0;
  await assert.rejects(handleAdmin(new Request('https://test/v1/admin/measurements',{headers:{authorization:'Bearer guest'}}),async()=>{reads++;},()=>{}),e=>e.status===401);
  assert.equal(reads,0);
  const query=async sql=>({rows:sql.includes('neon_auth.session')?[{id:'ordinary-account'}]:[]});
  await assert.rejects(handleAdmin(new Request('https://test/v1/admin/measurements',{headers:{'x-pack1-auth-session':'valid'}}),query,()=>{}),e=>e.status===403);
});


test('core admin measurements cannot regress to deferred habit or review aggregation',()=>{
  const source=fs.readFileSync('worker/measurement-admin.mjs','utf8');
  const start=source.indexOf("if(url.pathname==='/v1/admin/measurements') {");
  const end=source.indexOf("const match=url.pathname.match",start);
  assert.ok(start>0&&end>start);
  const core=source.slice(start,end);
  assert.doesNotMatch(core,/HABIT_METRICS_SQL/);
  assert.doesNotMatch(core,/chosen AS/);
  assert.match(source,/url\.pathname==='\/v1\/admin\/measurements\/habits'/);
  assert.match(source,/url\.pathname==='\/v1\/admin\/measurements\/reviews'/);
});


test('decision metrics default to the current corpus while player metrics span every corpus version',()=>{
  const source=fs.readFileSync('worker/measurement-admin.mjs','utf8');
  assert.match(source,/AND \(\$9='all' OR corpus_version=\$9\)/,'decision aggregates filter the session parent corpus unless corpus=all');
  assert.match(source,/puzzle_id=\$10/,'decision detail must keep its puzzle parameter after the corpus scope parameter');
  const habits=source.match(/const HABIT_METRICS_SQL=`([\s\S]*?)`;/)?.[1];
  assert.ok(habits,'the habit SQL must be defined');
  assert.doesNotMatch(habits,/corpus_version/,'Daily habit cohorts count every corpus version');
  const funnel=source.slice(source.indexOf("'share_funnel'"),source.indexOf('dated_arrivals'));
  assert.ok(funnel.length>0,'the share funnel SQL must be present');
  assert.doesNotMatch(funnel,/corpus_version|corpus_epoch/,'the share funnel counts every corpus version');
  assert.match(source,/Historical measurements remain stored\./);
});

// The core must compute the expensive first-encounter view once, not in
// multiple concurrent SQL calls. The shape still matches the existing UI.
test('Insights core reuses a single scoped scan and returns all report fields',async()=>{
  const statements=[];
  const query=async(sql,params=[])=>{
    statements.push(sql);
    if(sql.includes('FROM neon_auth.session s'))return {rows:[{user_id:'11111111-1111-4111-8111-111111111111'}]};
    if(sql.includes('SELECT role FROM pack1_admins'))return {rows:[{role:'owner'}]};
    if(sql.includes('WITH scoped AS MATERIALIZED'))return {rows:[{
      coverage:JSON.stringify({recorded:12,qa_excluded:1,repeats_excluded:2,unobserved_excluded:3}),
      summary:JSON.stringify({exposures:8,answers:6,players:4,runs:2,completed_runs:1}),
      groups:JSON.stringify([{dimension:'difficulty',label:'hard',answers:3}]),
    }]};
    if(sql.includes('SELECT set_id FROM draft_run_environment_policy'))return {rows:[{set_id:'blb'}]};
    if(sql.includes('WITH arrivals AS'))return {rows:[{arrivals:3,starts:2,completions:1}]};
    throw Error('Unexpected SQL in admin Insights mock: '+sql.slice(0,75));
  };
  const request=new Request('https://packone.pro/v1/admin/measurements?from=2026-10-01&to=2026-10-24',{
    headers:{'x-pack1-auth-session':'synthetic-admin-token'},
  });
  const data=await handleAdmin(request,query,async()=>({}));
  assert.equal(data.summary.answers,6);
  assert.equal(data.coverage.repeats_excluded,2);
  assert.deepEqual(data.groups,[{dimension:'difficulty',label:'hard',answers:3}]);
  assert.deepEqual(data.sets,['blb']);
  assert.equal(data.share_funnel.starts,2);
  const scans=statements.filter(sql=>sql.includes('draft_run_source_measurements'));
  assert.equal(scans.length,1,'shared report scans the decision measurement view exactly once');
  assert.match(scans[0],/WITH scoped AS MATERIALIZED/);
  assert.match(scans[0],/primary_data AS MATERIALIZED/);
  assert.match(scans[0],/first_encounter/);
});

test('Insights groups by model-implied trophy credit without re-scoring or changing serving rules',()=>{
  const source=fs.readFileSync('worker/measurement-admin.mjs','utf8');
  const core=source.slice(source.indexOf("if(url.pathname==='/v1/admin/measurements') {"),source.indexOf('const match=url.pathname.match'));
  assert.match(core,/LEFT JOIN draft_run_puzzle_ratings support/);
  assert.match(core,/support\.puzzle_id=primary_data\.puzzle_id AND support\.difficulty_version='support-ratio-v1'/);
  assert.match(core,/\('trophy_support',\$\{TROPHY_SUPPORT_BRACKET_SQL\}\)/);
  assert.doesNotMatch(core,/\('model_disagreement',model_disagreement::text\)/);
  const bracket=source.match(/const TROPHY_SUPPORT_BRACKET_SQL=\`([\s\S]*?)\`;/)?.[1];
  assert.ok(bracket,'the SQL must define the trophy support bracket');
  assert.match(bracket,/support\.target_support_ratio IS NULL THEN 'Unrated'/);
  for(const [cut,label] of [[20,'Below 20'],[40,'20–39'],[60,'40–59'],[80,'60–79']])
    assert.ok(bracket.includes(`floor(95*support.target_support_ratio+0.5) < ${cut} THEN '${label}'`));
  assert.match(bracket,/ELSE '80–100'/);
  assert.match(core,/WITH scoped AS MATERIALIZED/);
  assert.match(core,/primary_data AS MATERIALIZED/);
});
