import test from 'node:test';
import assert from 'node:assert/strict';
import {draftStartTiming} from '../worker/draft-start-timing.mjs';

test('isolated start timings retain only phase and query-family durations',async()=>{
  let now=0;const timing=draftStartTiming(true,{clock:()=>now});
  const query=timing.selectionQuery(async(sql,params)=>{
    assert.deepEqual(params,['private-parameter']);now+=sql.includes('WITH chosen')?70:20;return {rows:[]};
  });
  await timing.step('selection',async()=>{
    await query('SELECT pack1_serving_snapshot($1)',['private-parameter']);
    await query('WITH chosen AS (SELECT 1) SELECT * FROM chosen',['private-parameter']);
  });
  const response=timing.finish(Response.json({ok:true}));
  const parsed=JSON.parse(response.headers.get('x-pack1-start-timing'));
  assert.deepEqual(parsed,{v:1,total_ms:90,phases:{selection:90},selector:{
    snapshot:{count:1,sum_ms:20,max_ms:20},candidate:{count:1,sum_ms:70,max_ms:70},
  }});
  assert.doesNotMatch(JSON.stringify(parsed),/private-parameter|SELECT/);
});
test('production start timing adds no response header',async()=>{
  const timing=draftStartTiming(false,{clock:()=>{throw Error('disabled clock');}});
  await timing.step('selection',async()=>timing.selectionQuery(async()=>({rows:[]}))('SELECT 1',[]));
  assert.equal(timing.finish(Response.json({ok:true})).headers.get('x-pack1-start-timing'),null);
});
test('isolated reroll timings classify its two read families without payloads',async()=>{
  let now=0;const timing=draftStartTiming(true,{clock:()=>now,header:'x-pack1-reroll-timing'});
  const query=timing.selectionQuery(async()=>{now+=25;return {rows:[]};});
  await timing.step('metadata',()=>query('SELECT p.puzzle_id FROM puzzles p WHERE p.puzzle_id=ANY($1)',['private']));
  await timing.step('selection',()=>query('SELECT p.distance FROM puzzles p ORDER BY p.distance',['private']));
  const response=timing.finish(Response.json({ok:true}));
  assert.equal(response.headers.get('x-pack1-start-timing'),null);
  assert.deepEqual(JSON.parse(response.headers.get('x-pack1-reroll-timing')),{v:1,total_ms:50,phases:{metadata:25,selection:25},selector:{metadata:{count:1,sum_ms:25,max_ms:25},reroll:{count:1,sum_ms:25,max_ms:25}}});
});
