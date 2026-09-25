import test from 'node:test';
import assert from 'node:assert/strict';
import {dailySetPlan,latestSetPlan,liveRegularSets,recencyWeight,balancedSetPlan} from '../daily-selection.mjs';
import {seededRandom} from '../gameplay.mjs';
const sets=Array.from({length:20},(_,i)=>({set_id:`set-${i}`,set_name:`Set ${i}`,release_date:`${2026-i}-01-01`,status:'Live',regular_run:true}));
test('every Daily has two newest and four from the previous-three pool',()=>{
 const totals=new Map();let missingPrevious=false;
 for(let i=0;i<10000;i++){
  const plan=dailySetPlan(sets,'2026-09-18',seededRandom('daily:'+i));
  assert.equal(plan.length,8);assert.ok(plan.filter(s=>s==='set-0').length>=2);
  assert.ok(plan.filter(s=>['set-1','set-2','set-3'].includes(s)).length>=4);
  missingPrevious ||= ['set-1','set-2','set-3'].some(s=>!plan.includes(s));
  for(const s of plan)totals.set(s,(totals.get(s)||0)+1);
 }
 assert.ok(missingPrevious,'Does not force a pick from every previous release');
 assert.ok(totals.get('set-1')>totals.get('set-2')&&totals.get('set-2')>totals.get('set-3'));
 assert.ok(totals.get('set-19')>0,'Historical sets remain possible');
 assert.equal(recencyWeight(4),recencyWeight(0)/2);
});
test('only Live released regular metadata determines chronology',()=>{
 const metadata=[...sets,{set_id:'future',release_date:'2027-01-01',status:'Live',regular_run:true},...['Candidate','Paused','Retired'].map(status=>({set_id:status,release_date:'2026-08-01',status,regular_run:true})),{set_id:'cube',status:'Live',regular_run:false,release_date:'2026-09-01'}];
 assert.deepEqual(liveRegularSets(metadata,'2026-09-18').map(s=>s.set_id),sets.map(s=>s.set_id));
 assert.throws(()=>dailySetPlan(sets.slice(0,3),'2026-09-18',Math.random),/four Live/);
 const a=dailySetPlan(metadata,'2026-09-18',seededRandom('fixed'));
 assert.deepEqual(a,dailySetPlan([...metadata].reverse(),'2026-09-18',seededRandom('fixed')));
});
test('custom corpus gives balanced counts without archive-size weights',()=>{
 for(const n of [1,2,3,4,8,12,20]){
  const ids=sets.slice(0,n).map(s=>s.set_id),plan=balancedSetPlan(ids,seededRandom('custom'));
  const counts=ids.map(id=>plan.filter(s=>s===id).length);
  assert.equal(plan.length,8);assert.ok(Math.max(...counts)-Math.min(...counts)<=1);
 }
});

test('latest Daily uses only the newest Live released regular set',()=>{
 assert.deepEqual(latestSetPlan([...sets].reverse(),'2026-09-19'),Array(8).fill('set-0'));
 const future={set_id:'future',set_name:'Future',release_date:'2026-10-01',status:'Live',regular_run:true};
 assert.deepEqual(latestSetPlan([...sets,future],'2026-09-19'),Array(8).fill('set-0'));
 assert.deepEqual(latestSetPlan([...sets,future],'2026-10-01'),Array(8).fill('future'));
 assert.throws(()=>latestSetPlan([],'2026-09-19'),/not available/);
 assert.throws(()=>latestSetPlan([{...sets[0],set_name:null}],'2026-09-19'),/metadata is incomplete/);
});
