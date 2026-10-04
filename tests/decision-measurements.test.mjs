import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {decisionClock} from '../decision-clock.mjs';
import {measurementInput} from '../worker/decision-measurements.mjs';
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
test('reports reject malformed dates and filters and bound the query range',()=>{
  for(const qs of ['from=2026-02-30','from=2020-01-01&to=2026-01-01','from=2026-09-12&to=2026-09-11','environment=bad','set=%27'])
    assert.throws(()=>reportFilters(new URL('https://test/?'+qs)));
  const filters=reportFilters(new URL('https://test/?from=2026-09-01&to=2026-09-12'));
  assert.equal(filters.start,'2026-09-01');
  assert.equal(filters.corpus_version,DRAFT_RUN_CORPUS_VERSION);
  assert.equal(filters.params.at(-1),DRAFT_RUN_CORPUS_VERSION);
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


test('admin measurement baseline is pinned to the current parent corpus without deleting history',()=>{
  const source=fs.readFileSync('worker/measurement-admin.mjs','utf8');
  assert.match(source,/AND corpus_version=\$9/,'decision aggregates must filter the session parent corpus');
  assert.match(source,/s\.corpus_version=\$3/,'Daily habit sessions must be current-corpus only');
  assert.match(source,/s\.corpus_version=\$4/,'share starts and completions must be current-corpus sessions');
  assert.match(source,/SELECT min\(created_at\) started_at FROM draft_run_sessions WHERE corpus_version=\$4/,'best-effort share arrivals must not predate the current-corpus epoch');
  assert.match(source,/puzzle_id=\$10/,'decision detail must keep its puzzle parameter after the corpus scope parameter');
  assert.match(source,/Historical measurements remain stored but are excluded from this dashboard baseline/);
});
