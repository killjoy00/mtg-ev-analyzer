import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionClock} from '../decision-clock.mjs';
import {measurementInput} from '../worker/decision-measurements.mjs';
import {reportFilters,handleAdmin} from '../worker/measurement-admin.mjs';
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
  assert.equal(reportFilters(new URL('https://test/?from=2026-09-01&to=2026-09-12')).start,'2026-09-01');
});
test('admin reports never accept a guest player token and deny ordinary accounts',async()=>{
  let reads=0;
  await assert.rejects(handleAdmin(new Request('https://test/v1/admin/measurements',{headers:{authorization:'Bearer guest'}}),async()=>{reads++;},()=>{}),e=>e.status===401);
  assert.equal(reads,0);
  const query=async sql=>({rows:sql.includes('neon_auth.session')?[{id:'ordinary-account'}]:[]});
  await assert.rejects(handleAdmin(new Request('https://test/v1/admin/measurements',{headers:{'x-pack1-auth-session':'valid'}}),query,()=>{}),e=>e.status===403);
});
