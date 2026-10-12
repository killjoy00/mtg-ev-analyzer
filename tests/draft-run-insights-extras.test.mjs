import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildDraftingDNA,buildDraftingJourney,selectInsightHighlights,publicLockedDecision,
} from '../worker/draft-run-insights-extras.mjs';
import {
  aggregateDraftRunInsights,INSIGHTS_SQL,INSIGHTS_PREVIEW_SQL,INSIGHTS_DECISION_SQL,loadDraftRunInsightDecision,
  loadDraftRunInsights,
} from '../worker/draft-run-insights.mjs';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const start=Date.UTC(2026,7,1);
function pick(n,{score=85,match=false,environment='mixed',band='medium',version='corpus-v1',sid=id,day,sourcePick}={}){
 return {session_id:sid,puzzle_id:'p'+n,round:n%8+1,selected_id:'mine',historical_id:'trophy',
   selected_name:'Chosen Card',historical_name:'Trophy Card',set_id:n%2?'neo':'ktk',
   environment,pick_number:sourcePick??n%8+1,
   score,trophy_match:match,difficulty_band:band,
   answered_at:new Date(start+(day??n)*86400000).toISOString(),
   scoring_version:'trophy-consensus-v3-linear-v2',selection_version:'eight-pick-v4',corpus_version:version};
}
function raw(p){
 return {...p,answer_round:p.round,score:p.score,trophy_match:p.trophy_match,
  pick_number:p.pick_number};
}
test('Journey groups earliest-first into original-scored 40-pick windows, with truthful gaps',()=>{
 const history=Array.from({length:97},(_,n)=>pick(n,{score:n<40?55:n<80?77:95}));
 const j=buildDraftingJourney(history);
 assert.equal(j.windows.length,3);
 assert.deepEqual(j.windows.map(w=>w.count),[40,40,17]);
 assert.deepEqual(j.windows.map(w=>w.complete),[true,true,false]);
 assert.deepEqual(j.windows.map(w=>w.average_score),[55,77,95]);
 assert.equal(j.best_window.average_score,77);
 assert.equal(j.milestones.filter(m=>m.id==='eighty').length,1);
 assert.equal(j.milestones.find(m=>m.id==='best-window').average_score,77);
 const mixed=buildDraftingJourney([...history.slice(0,40),...history.slice(40,80).map(p=>({...p,corpus_version:'old'}))]);
 assert.equal(mixed.versions_comparable,false);
 assert.equal(mixed.best_window,null);
 assert.match(mixed.note,/Historical scoring/);
 assert.equal(buildDraftingJourney([]).windows.length,0);
});
test('Drafting DNA is deterministic, one primary and two distinct justified slots',()=>{
 const history=Array.from({length:160},(_,n)=>pick(n,{score:n%5===0?55:88,match:n%3===0}));
 const a=buildDraftingDNA(history),b=buildDraftingDNA([...history].reverse());
 assert.deepEqual(a,b);
 assert.equal(a.scope,'all-eligible-history');
 assert.equal(a.primary.id,'independent-thinker');
 assert.equal(a.secondary.length,2);
 const present=[a.primary,...a.secondary.filter(x=>x.status==='qualified')];
 assert.equal(new Set(present.map(x=>x.id)).size,present.length);
 assert.equal(new Set(present.map(x=>x.evidence_family)).size,present.length);
 assert.ok(present.some(x=>x.evidence.some(y=>y.label==='Alternative selections')));
 const small=buildDraftingDNA(history.slice(0,7));
 assert.equal(small.primary,null);
 assert.deepEqual(small.secondary.map(x=>x.label),['Trait still developing','Trait still developing']);
 assert.equal(buildDraftingDNA([]).eligible_decisions,0);
});
test('Trophy matches are not low-scoring misses, and best/missed picks never duplicate',()=>{
 const all=Array.from({length:45},(_,n)=>pick(n,{score:n%5===0?100:n%5===1?95:n%5===2?10:85,
   match:n%5===0,band:n%5===0?'hard':'medium'}));
 const result=selectInsightHighlights(all);
 assert.ok(result.best.some(x=>x.trophy_match));
 assert.ok(result.best.some(x=>!x.trophy_match&&x.score>=80));
 assert.ok(result.misses.every(x=>!x.trophy_match));
 assert.ok(result.misses.some(x=>x.score===10));
 assert.equal(new Set([...result.best,...result.misses].map(x=>x.puzzle_id)).size,
   result.best.length+result.misses.length);
 assert.ok(result.best.length<=6&&result.misses.length<=6);
});
const source={puzzle_id:'p1',set_id:'neo',pick_number:3,
  candidates:[{id:'mine',name:'Aerial Responder',image_url:'https://cards.scryfall.io/p1.jpg'},
    {id:'trophy',name:'Ornery Companion',image_url:'https://cards.scryfall.io/p2.jpg'}],
  prior_picks:[{id:'prior',name:'First Pick'}]};
const answer={puzzle:source,score:83,selectedId:'mine',historicalId:'trophy',historicalMatch:false,
 trophyDrafter:{record:'7–1',winRate:62},ranking:[{id:'mine',name:'Aerial Responder',score:83,support:.4}]};
test('Locked decision preserves actual saved pack but strips unsanctioned data',()=>{
 const out=publicLockedDecision(answer);
 assert.equal(out.selected.name,'Aerial Responder');
 assert.equal(out.trophy.name,'Ornery Companion');
 assert.equal(out.score,83);
 assert.equal(out.prior_picks[0].name,'First Pick');
 assert.equal(out.trophy_drafter.record,'7–1');
 assert.equal(out.ranking[0].score,83);
 assert.equal(publicLockedDecision({...answer,puzzle:{candidates:[]}}),null);
 const bad=publicLockedDecision({...answer,puzzle:{...source,candidates:
   [{id:'mine',name:'A',image_url:'javascript:alert(1)'},source.candidates[1]]}});
 assert.equal(bad.selected.image_url,null);
});
test('Owner-scoped detail loader validates inputs, score history and session query',async()=>{
 let calls=0;const owner='ffffffff-ffff-4fff-8fff-ffffffffffff';
 for(const data of [{session_id:'bad',round:1,puzzle_id:'p1'},{session_id:id,round:0,puzzle_id:'p1'}]){
   await assert.rejects(loadDraftRunInsightDecision(async()=>{calls++;},owner,data),e=>e.status===400);
 }
 assert.equal(calls,0);
 const eligibleRow={...raw(pick(1,{sid:id,sourcePick:3,score:83})),puzzle_id:'p1',answer_round:3};
 const query=async(sql,args)=>{
   if(sql===INSIGHTS_SQL){assert.deepEqual(args,[owner]);return {rows:[eligibleRow]};}
   assert.equal(sql,INSIGHTS_DECISION_SQL);
   assert.deepEqual(args,[owner,id,3,'p1']);
   return {rows:[{answer,answered_at:'2026-09-01T00:00:00Z',scoring_version:'v1',corpus_version:'corpus-v1'}]};
 };
 const detail=await loadDraftRunInsightDecision(query,owner,{session_id:id,round:3,puzzle_id:'p1'});
 assert.equal(detail.selected.name,'Aerial Responder');
 assert.equal(detail.answered_at,'2026-09-01T00:00:00.000Z');
 await assert.rejects(loadDraftRunInsightDecision(async()=>({rows:[]}),owner,{session_id:id,round:3,puzzle_id:'p1'}),e=>e.status===404);
 await assert.rejects(loadDraftRunInsightDecision(async(sql)=>{
   if(sql===INSIGHTS_SQL)return {rows:[{...eligibleRow,session_id:id2,answered_at:'2026-08-01T00:00:00.000Z'},eligibleRow]};
   throw Error('Duplicate second answer must not be loaded');
 },owner,{session_id:id,round:3,puzzle_id:'p1'}),e=>e.status===404);
 for(const sql of [INSIGHTS_PREVIEW_SQL,INSIGHTS_DECISION_SQL]){
   assert.match(sql,/player_id=\$1::uuid/);
   assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
 }
});
test('Shortlist source preview reads only owner sessions and returns no unbounded history',async()=>{
 const owner='ffffffff-ffff-4fff-8fff-ffffffffffff',history=Array.from({length:12},(_,n)=>raw(pick(n,{score:n%2?12:91,sid:n<8?id:id2})));
 const calls=[];
 const query=async(sql,args)=>{
   calls.push({sql,args});
   if(calls.length===1)return {rows:history};
   assert.equal(sql,INSIGHTS_PREVIEW_SQL);
   assert.equal(args[0],owner);
   assert.match(args[1],/^\{[a-f0-9,-]+\}$/i);
   assert.ok(args[1].slice(1,-1).split(',').length<=12);
   return {rows:[{session_id:id,answers:Array.from({length:8},(_,i)=>({...answer,puzzle:{...source,puzzle_id:'p'+i}}))}]};
 };
 const out=await loadDraftRunInsights(query,owner,{environment:'mixed'});
 assert.equal(out.eligible_decisions,12);
 assert.ok(out.highlights.misses.length>0);
 assert.equal(calls.length,2);
 assert.equal(out.highlights.misses[0].session_id===id||out.highlights.misses[0].session_id===id2,true);
 assert.equal(Object.hasOwn(out,'raw_decisions'),false);
});
test('Mixed historical score versions suppress misleading 40/40 progress, while retaining a true Journey',()=>{
 const rawHistory=Array.from({length:80},(_,n)=>raw(pick(n,{version:n<40?'old-scoring':'new-scoring'})));
 const result=aggregateDraftRunInsights(rawHistory);
 assert.equal(result.eligible_decisions,80);
 assert.equal(result.progress,null);
 assert.equal(result.journey.progress_compatible,false);
 assert.equal(result.journey.eligible_decisions,80);
 assert.ok(result.journey.windows.length>=2);
 const uniform=aggregateDraftRunInsights(rawHistory.map(r=>({...r,corpus_version:'one-version'})));
 assert.equal(uniform.progress?.recent?.count,40);
 assert.equal(uniform.journey.progress_compatible,true);
});

test('Growth handlers keep highlight detail private and gateway explicitly allowlists reads',()=>{
 const g=fs.readFileSync('worker/growth-function.js','utf8'),gate=fs.readFileSync('edge/gateway.mjs','utf8');
 assert.match(g,/loadDraftRunInsightDecision\(query,owner/);
 assert.match(g,/authenticatedProfilePlayer\(request,\{mobile\}\)/);
 assert.match(g,/\/v1\/profile\/insights\/decision/);
 assert.match(g,/\/v1\/mobile\/profile\/insights\/decision/);
 assert.match(gate,/\/v1\/profile\/insights\/decision/);
 assert.match(gate,/\/v1\/mobile\/profile\/insights\/decision/);
});
