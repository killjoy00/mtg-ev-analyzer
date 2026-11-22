import test from 'node:test';
import assert from 'node:assert/strict';
import {adminPath} from '../edge/gateway.mjs';
import {readSetLaunchDailies} from '../worker/set-launch-status.mjs';
import {setLaunchSummary,setLaunchMarkup} from '../admin/set-launch-status.mjs';

const daily={day:'2026-11-23',setId:'trk',schedules:[
 {environment:'latest',picks:8,resolved:8,setPicks:8,selectionRule:'latest'},
 {environment:'mixed',picks:8,resolved:8,setPicks:2,selectionRule:'mixed'},
 {environment:'powered-cube',picks:8,resolved:8,setPicks:0,selectionRule:'cube'}
]};
const live={set_id:'trk',set_name:'Star Trek',status:'Live',ready:true,health_current:true,
 serving_count:820,manifest:{full_import:{}},archive_available:true};
const corpus={sets:[live],serving_cache_current:true,readiness:{ready:true,current:true}};

test('new set launch is a read-only admin route, never public or mutable',()=>{
 assert.equal(adminPath('/v1/admin/corpus/launch-dailies','GET'),true);
 for(const method of ['POST','PATCH','DELETE'])assert.equal(adminPath('/v1/admin/corpus/launch-dailies',method),false);
 assert.equal(adminPath('/v1/admin/corpus/launch-dailies/anything','GET'),false);
});

test('daily status reads only three pinned Pacific schedules and checks actual puzzle membership',async()=>{
 const seen=[];
 const query=async(sql,params=[])=>{
  seen.push({sql,params});
  return {rows:seen.length===1?[{day:'2026-11-23'}]:[
   {environment:'latest',day:'2026-11-23',picks:8,resolved:8,set_picks:8,selection_rule:'latest'},
   {environment:'mixed',day:'2026-11-23',picks:8,resolved:8,set_picks:2,selection_rule:'mixed'},
   {environment:'powered-cube',day:'2026-11-23',picks:8,resolved:8,set_picks:0,selection_rule:'cube'}
  ]};
 };
 const result=await readSetLaunchDailies(query,'trk');
 assert.equal(result.day,'2026-11-23');
 assert.equal(result.schedules.length,3);
 assert.equal(result.schedules[0].setPicks,8);
 assert.deepEqual(seen[1].params,['2026-11-23','trk']);
 assert.match(seen[0].sql,/America\/Los_Angeles/);
 assert.match(seen[1].sql,/jsonb_array_elements_text\(s\.puzzle_ids\)/);
 assert.match(seen[1].sql,/count\(DISTINCT p\.puzzle_id\)/i);
 assert.match(seen[1].sql,/WHERE s\.day=\$1::date AND s\.environment IN/);
 assert.doesNotMatch(seen[1].sql,/INSERT |UPDATE |DELETE /i);
});

test('unknown and invalid set codes fail before touching SQL',async()=>{
 let queries=0;
 const query=()=>{queries++;return {rows:[]}};
 for(const bad of ['','TRK','x','trx;DROP',null]){
  await assert.rejects(readSetLaunchDailies(query,bad),/Choose a set code/);
 }
 assert.equal(queries,0);
});

test('not-yet-imported Star Trek is shown as waiting, not incorrectly marked live',()=>{
 const summary=setLaunchSummary({set:null,corpus:{sets:[]},daily:{day:'2026-11-22',schedules:[]}});
 assert.equal(summary.source[0],'Not confirmed');
 assert.equal(summary.published[0],'Not live');
 assert.equal(summary.firstPublicDayReady,false);
 const markup=setLaunchMarkup({setId:'trk',setName:'Star Trek',corpus:{sets:[]},daily:null});
 assert.match(markup,/No source import evidence/);
 assert.match(markup,/Not scheduled/);
});

test('Candidate without an imported manifest is not mistaken for loaded source data',()=>{
 const bare={set_id:'trk',set_name:'Star Trek',status:'Candidate',ready:false,health_current:false,manifest:null,
   import_status:'pending',archive_available:true};
 const result=setLaunchSummary({set:bare,corpus:{...corpus,sets:[bare]},daily:null});
 assert.equal(result.source[0],'Found','archive alone is not an imported corpus');
 assert.equal(result.firstPublicDayReady,false);
});

test('Candidate with verified source is not yet a completed launch',()=>{
 const candidate={...live,status:'Candidate',serving_count:0};
 const r=setLaunchSummary({set:candidate,corpus:{...corpus,sets:[candidate]},daily:{...daily,schedules:[]}});
 assert.equal(r.source[0],'Imported');
 assert.equal(r.verified[0],'Passed');
 assert.equal(r.published[0],'Candidate');
 assert.equal(r.firstPublicDayReady,false);
});

test('Live serving with exactly eight Latest picks, two Mixed picks and independent Cube passes',()=>{
 const r=setLaunchSummary({set:live,corpus,daily});
 assert.equal(r.firstPublicDayReady,true);
 assert.equal(r.results.latest.ok,true);
 assert.equal(r.results.mixed.ok,true);
 assert.equal(r.results['powered-cube'].ok,true);
 const html=setLaunchMarkup({setId:'trk',setName:'Star Trek',corpus,daily});
 assert.match(html,/First public Daily/);
 assert.match(html,/All eight pinned picks use this set/);
 assert.match(html,/Powered Cube Daily/);
 assert.match(html,/does not need to contain Star Trek/);
});

test('Missing Cube, stale readiness, or no new-set picks does not pass',()=>{
 assert.equal(setLaunchSummary({set:live,corpus,daily:{...daily,schedules:daily.schedules.slice(0,2)}}).firstPublicDayReady,false);
 assert.equal(setLaunchSummary({set:live,corpus:{...corpus,readiness:{ready:true,current:false}},daily}).firstPublicDayReady,false);
 const stale={...daily,schedules:daily.schedules.map(s=>s.environment==='latest'?{...s,setPicks:0}:s)};
 assert.equal(setLaunchSummary({set:live,corpus,daily:stale}).firstPublicDayReady,false);
 const missing={...daily,schedules:daily.schedules.map(s=>s.environment==='mixed'?{...s,resolved:7}:s)};
 assert.equal(setLaunchSummary({set:live,corpus,daily:missing}).firstPublicDayReady,false);
});

test('source descriptions and import errors are escaped in owner markup',()=>{
 const target={...live,set_name:'<img src=x>',last_error:'<script>alert(1)</script>'};
 const html=setLaunchMarkup({setId:'trk',setName:'<img src=x>',corpus:{...corpus,sets:[target]},daily});
 assert.doesNotMatch(html,/<img src=x>|<script>/);
 assert.match(html,/&lt;script&gt;/);
});
