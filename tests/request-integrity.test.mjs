import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson} from '../worker/request-json.mjs';
import growth from '../worker/growth-function.js';
import legacy from '../worker/index.js';
import {gameDateKey} from '../game-date.mjs';
import {gameDateKey as engagementDate} from '../engagement.mjs';
import {gameDateKey as workerDate} from '../worker/core.mjs';
import {gameDateKey as growthDate} from '../worker/growth-function.js';
import {gameDateKey as todayDateKey} from '../today-status.mjs';

const request=body=>new Request('https://packone.pro/v1/session',{method:'POST',headers:{'content-type':'application/json'},body});
test('session endpoints reject malformed or non-object JSON before any database work',async()=>{
  for(const service of [growth,legacy])for(const body of ['null','[]','"text"','{']) {
    const result=await service.fetch(request(body));assert.equal(result.status,400);
  }
  await assert.rejects(readJson(request('{}'.repeat(70000))),e=>e.status===413);
});
test('JSON limits count bytes and stop reading an oversized stream',async()=>{
  await assert.rejects(readJson(request('{"name":"ééé"}'),12),e=>e.status===413);
  let cancelled=false;
  const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(20));},cancel(){cancelled=true;}});
  await assert.rejects(readJson(new Request('https://test/',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'}),10),e=>e.status===413);
  assert.ok(cancelled);assert.deepEqual(await readJson(request('{"ok":true}')),{ok:true});
});
test('every Daily surface uses the same Pacific clock through midnight and DST',()=>{
  for(const fn of [engagementDate,workerDate,growthDate,todayDateKey])assert.equal(fn,gameDateKey);
  for(const [time,day] of [
    ['2026-03-08T07:59:59Z','2026-03-07'],['2026-03-08T08:00:00Z','2026-03-08'],
    ['2026-03-08T10:00:00Z','2026-03-08'],['2026-03-09T06:59:59Z','2026-03-08'],['2026-03-09T07:00:00Z','2026-03-09'],
    ['2026-11-01T06:59:59Z','2026-10-31'],['2026-11-01T07:00:00Z','2026-11-01'],
    ['2026-11-01T09:00:00Z','2026-11-01'],['2026-11-02T07:59:59Z','2026-11-01'],['2026-11-02T08:00:00Z','2026-11-02'],
  ])assert.equal(gameDateKey(time),day);
});
