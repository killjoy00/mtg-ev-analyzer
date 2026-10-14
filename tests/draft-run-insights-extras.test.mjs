import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {safeCardImageUrl,CARD_IMAGE_HOSTS} from '../card-image-policy.mjs';
import {
  buildDraftingDNA,buildDraftingJourney,buildCardChoiceContext,selectInsightHighlights,publicLockedDecision,
  DNA_QUALIFICATION,DNA_VERSION,JOURNEY_VERSION,HIGHLIGHTS_VERSION,CHOICE_CONTEXT_RULE,HIGHLIGHT_REASON_VERSION,
} from '../worker/draft-run-insights-extras.mjs';
import {
  aggregateDraftRunInsights,INSIGHTS_SQL,INSIGHTS_PREVIEW_SQL,INSIGHTS_DECISION_SQL,
  INSIGHTS_DECISION_ELIGIBILITY_SQL,normaliseInsightsRows,loadDraftRunInsightDecision,
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
test('Owner-scoped detail uses a targeted first-encounter eligibility read',async()=>{
 let calls=0;const owner='ffffffff-ffff-4fff-8fff-ffffffffffff';
 for(const data of [{session_id:'bad',round:1,puzzle_id:'p1'},{session_id:id,round:0,puzzle_id:'p1'}]){
   await assert.rejects(loadDraftRunInsightDecision(async()=>{calls++;},owner,data),e=>e.status===400);
 }
 assert.equal(calls,0);
 const query=async(sql,args)=>{
   if(sql===INSIGHTS_DECISION_ELIGIBILITY_SQL){
     assert.deepEqual(args,[owner,'p1']);return {rows:[{session_id:id,answer_round:3,puzzle_id:'p1'}]};
   }
   assert.equal(sql,INSIGHTS_DECISION_SQL);
   assert.deepEqual(args,[owner,id,3,'p1']);
   return {rows:[{answer,answered_at:'2026-09-01T00:00:00Z',scoring_version:'v1',corpus_version:'corpus-v1'}]};
 };
 const detail=await loadDraftRunInsightDecision(query,owner,{session_id:id,round:3,puzzle_id:'p1'});
 assert.equal(detail.selected.name,'Aerial Responder');
 assert.equal(detail.answered_at,'2026-09-01T00:00:00.000Z');
 await assert.rejects(loadDraftRunInsightDecision(async()=>({rows:[]}),owner,{session_id:id,round:3,puzzle_id:'p1'}),e=>e.status===404);
 await assert.rejects(loadDraftRunInsightDecision(async()=>({rows:[{session_id:id2,answer_round:3,puzzle_id:'p1'}]}),
   owner,{session_id:id,round:3,puzzle_id:'p1'}),e=>e.status===404);
 for(const sql of [INSIGHTS_PREVIEW_SQL,INSIGHTS_DECISION_SQL,INSIGHTS_DECISION_ELIGIBILITY_SQL]){
   assert.ok(sql.includes('player_id=$1::uuid'));
   assert.ok(!['INSERT','UPDATE','DELETE','TRUNCATE'].some(word=>sql.includes(word+' ')));
 }
 assert.match(INSIGHTS_DECISION_ELIGIBILITY_SQL,/LIMIT 1000/);
 assert.ok(INSIGHTS_DECISION_ELIGIBILITY_SQL.includes("puzzle_id'=$2"));
 assert.ok(INSIGHTS_DECISION_ELIGIBILITY_SQL.includes('p.display_name !~*'));
 assert.ok(INSIGHTS_DECISION_ELIGIBILITY_SQL.includes('ORDER BY o.answered_at ASC,s.id,picked.ordinality'));
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

test('All DNA threshold gates are declared provisionally and deferrals stay explicit',()=>{
 assert.equal(DNA_QUALIFICATION.version,DNA_VERSION);
 assert.equal(DNA_QUALIFICATION.minimum_decisions,80);
 assert.equal(DNA_QUALIFICATION.stability_recent_run,8);
 assert.deepEqual([...DNA_QUALIFICATION.deferred],['trophy-twin','puzzle-solver','specialist']);
 assert.equal(buildDraftingDNA([]).picks_needed,88);
 const emerging=buildDraftingDNA(Array.from({length:7},(_,n)=>pick(n)));
 assert.equal(emerging.picks_needed,81);
 assert.equal(emerging.primary_emerging.picks_needed,81);
 assert.deepEqual(emerging.secondary.map(x=>x.picks_needed),[81,81]);
 const grown=buildDraftingDNA(Array.from({length:88},(_,n)=>pick(n,{score:50,match:true})));
 assert.equal(grown.picks_needed,null);
 assert.equal(grown.primary,null,'No raw match rate may qualify Trophy Twin');
 assert.ok(grown.secondary.every(x=>x.picks_needed===null&&x.reason));
});
test('DNA shows the effective 88-decision stability floor at 80, 84, 87 and 88',()=>{
 const history=Array.from({length:88},(_,n)=>pick(n,{score:95,match:true}));
 for(const [size,needed] of [[0,88],[7,81],[80,8],[84,4],[87,1]]){
  const dna=buildDraftingDNA(history.slice(0,size));
  assert.equal(dna.status,'emerging','no trait before both 80-pick checks can run');
  assert.equal(dna.primary,null);
  assert.equal(dna.picks_needed,needed);
  assert.equal(dna.primary_emerging.picks_needed,needed);
  assert.deepEqual(dna.secondary.map(x=>x.picks_needed),[needed,needed]);
  assert.match(dna.reason,/88-decision stability sample floor/);
 }
 const ready=buildDraftingDNA(history);
 assert.equal(ready.status,'ready');
 assert.equal(ready.primary.id,'sharpshooter');
 assert.equal(ready.picks_needed,null);
});
test('Rising Star describes a 10-point higher recent average, not just any difference',()=>{
 const history=Array.from({length:96},(_,n)=>pick(n,{score:n<48?50:90,match:true}));
 const dna=buildDraftingDNA(history);
 const rising=[dna.primary,...dna.secondary].find(x=>x?.id==='rising-star');
 assert.ok(rising,'the increase must be stable in both comparable 40-pick windows');
 assert.match(rising.summary,/at least 10 points higher/);
 assert.doesNotMatch(rising.summary,/different averages/);
});
test('Sharpshooter and Steady Hand cannot share slots on 70 high and 30 moderate scores',()=>{
 const dna=buildDraftingDNA(Array.from({length:100},(_,n)=>pick(n,{score:n<70?95:70})));
 const ids=[dna.primary,...dna.secondary].filter(x=>x?.status==='qualified').map(x=>x.id);
 assert.ok(ids.some(id=>id==='sharpshooter'||id==='steady-hand'));
 assert.ok(!(ids.includes('sharpshooter')&&ids.includes('steady-hand')));
});
test('Steady Hand is measured within every known difficulty/version/format cohort',()=>{
 const good=Array.from({length:112},(_,n)=>pick(n,{score:85,band:n<56?'hard':'medium'}));
 const labels=rows=>[buildDraftingDNA(rows).primary,...buildDraftingDNA(rows).secondary]
   .filter(x=>x?.status==='qualified').map(x=>x.id);
 assert.ok(labels(good).includes('steady-hand'),'two compatible sampled cohorts should pass');
 const bad=good.map((r,i)=>i>=56&&i<64?{...r,score:0}:r);
 assert.ok(!labels(bad).includes('steady-hand'),'a sampled cohort below the gate must veto the trait');
 const scattered=Array.from({length:96},(_,n)=>pick(n,{
   score:85,band:n%3===0?'easy':n%3===1?'medium':'hard',
   version:n<48?'old':'new'}));
 assert.ok(!labels(scattered).includes('steady-hand'),'no cohort of 40 means no stable claim');
});
test('An eight-decision run cannot instantly turn a borderline score gate into a trait',()=>{
 const borderline=Array.from({length:100},(_,n)=>pick(n,{score:n<64?95:60}));
 const add=Array.from({length:8},(_,i)=>pick(100+i,{score:95}));
 const ids=history=>[buildDraftingDNA(history).primary,...buildDraftingDNA(history).secondary]
   .filter(x=>x?.status==='qualified').map(x=>x.id);
 assert.ok(!ids(borderline).includes('sharpshooter'));
 assert.ok(!ids([...borderline,...add]).includes('sharpshooter'),
   'even though the full 108-pick sample now passes, the prior 100 do not');
 assert.ok(ids([...borderline,...add,...Array.from({length:8},(_,i)=>pick(108+i,{score:95}))])
   .includes('sharpshooter'),'a subsequent stable qualified period can earn it');
});
test('Journey v2 uses a second irregular 96-pick history, a dip, recovery, and version boundary',()=>{
 const picks=Array.from({length:96},(_,n)=>pick(n,{
   score:n<32?90:n<64?40:75,
   band:n>=48&&n<60?'hard':'medium',
   version:n<48?'older':'newer',
   day:n+Math.floor(n/9)*2,
 }));
 const journey=buildDraftingJourney(picks);
 assert.equal(journey.version,JOURNEY_VERSION);
 assert.equal(journey.eligible_decisions,96);
 assert.deepEqual(journey.windows.map(w=>w.count),[40,8,40,8]);
 assert.deepEqual(journey.windows.map(w=>w.average_score),[80,40,61,75]);
 assert.deepEqual(journey.windows.map(w=>w.complete),[true,false,true,false]);
 assert.deepEqual(journey.windows.map(w=>[w.from,w.to]),[
   ['2026-08-01','2026-09-17'],['2026-09-18','2026-09-27'],
   ['2026-09-28','2026-11-14'],['2026-11-15','2026-11-24'],
 ]);
 assert.equal(journey.windows[2].from_at,'2026-09-28T00:00:00.000Z');
 assert.equal(journey.windows[2].to_at,'2026-11-14T00:00:00.000Z');
 assert.equal(journey.versions_comparable,false);
 assert.equal(journey.best_window,null);
 assert.deepEqual(journey.milestones.map(m=>m.id),['first-forty','eighty','hard-coverage']);
 assert.deepEqual(journey.milestones.map(m=>m.date),[
   '2026-09-17','2026-11-14','2026-11-14',
 ]);
 assert.equal(journey.milestones.find(m=>m.id==='hard-coverage').hard_decisions,12);
 assert.equal(journey.milestones.find(m=>m.id==='hard-coverage').from_at,'2026-09-28T00:00:00.000Z');
 assert.equal(journey.milestones.find(m=>m.id==='eighty').to_at,'2026-11-14T00:00:00.000Z');
 assert.doesNotMatch(journey.milestones.map(m=>m.text).join(' '),/improved|better/i);
});
test('Journey keeps UTC timestamps across midnight instead of collapsing two local-time decisions',()=>{
 const picks=[{...pick(1),answered_at:'2026-10-31T23:55:00.000Z'},
   {...pick(2),answered_at:'2026-11-01T00:05:00.000Z'}];
 const journey=buildDraftingJourney(picks);
 assert.deepEqual([journey.windows[0].from,journey.windows[0].to],['2026-10-31','2026-11-01']);
 assert.equal(journey.windows[0].from_at,'2026-10-31T23:55:00.000Z');
 assert.equal(journey.windows[0].to_at,'2026-11-01T00:05:00.000Z');
 assert.equal(new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric'})
   .format(new Date(journey.windows[0].to_at)),'Oct 31');
});
test('Saved images enforce a single audited HTTPS Scryfall host on server and shared clients',()=>{
 assert.deepEqual(CARD_IMAGE_HOSTS,['cards.scryfall.io']);
 for(const [url,allowed] of [
   ['http://cards.scryfall.io/card.jpg',false],
   ['javascript:alert(1)',false],
   ['https://evil.example/card.jpg',false],
   ['https://cards.scryfall.io/normal/front/card.jpg',true],
 ]) {
   const locked=publicLockedDecision({...answer,puzzle:{...source,candidates:[
     {...source.candidates[0],image_url:url},source.candidates[1]]}});
   assert.equal(Boolean(locked.selected.image_url),allowed,url);
   assert.equal(Boolean(safeCardImageUrl(url)),allowed,url);
 }
 assert.equal(safeCardImageUrl('https://cards.scryfall.io.evil.example/card.jpg'),null);
 assert.equal(safeCardImageUrl('https://evil.example@cards.scryfall.io/card.jpg'),null);
});
test('Highlights v2 paginates no more than twice and is unique across all four sets',()=>{
 const all=Array.from({length:100},(_,n)=>pick(n,{score:n%5===0?100:n%5===1?95:n%5===2?10:85,
   match:n%5===0,band:n%5===0?'hard':'medium'}));
 const one=selectInsightHighlights(all),two=selectInsightHighlights(all,{page:2});
 assert.equal(one.schema_version,HIGHLIGHTS_VERSION);
 assert.equal(one.page,1);assert.equal(two.page,2);
 assert.deepEqual(one.has_more,{best:true,misses:true});
 assert.deepEqual(two.has_more,{best:false,misses:false});
 assert.deepEqual([one.best.length,one.misses.length,two.best.length,two.misses.length],[6,6,6,6]);
 const combined=[...one.best,...one.misses,...two.best,...two.misses];
 assert.equal(new Set(combined.map(x=>x.puzzle_id)).size,24);
 assert.deepEqual(selectInsightHighlights([...all],{page:2}),two);
 for(const invalid of [0,3,1.5,NaN])assert.throws(()=>selectInsightHighlights(all,{page:invalid}),e=>e.status===400);
});
test('Targeted winner matches full normalise() over synthetic reruns, ties and invalids',async()=>{
 const owner='ffffffff-ffff-4fff-8fff-ffffffffffff';
 const input=[
   {...raw(pick(1,{sid:id2,score:80})),puzzle_id:'shared',answer_round:6,answered_at:'2026-08-02T00:00:00Z'},
   {...raw(pick(2,{sid:id,score:90})),puzzle_id:'shared',answer_round:3,answered_at:'2026-08-02T00:00:00Z'},
   {...raw(pick(3,{sid:id,score:99})),puzzle_id:'shared',answer_round:4,answered_at:'2026-08-03T00:00:00Z'},
   {...raw(pick(4,{sid:id2,score:45})),puzzle_id:'another',answer_round:2},
   {...raw(pick(5,{sid:id,score:200})),puzzle_id:'invalid-score',answer_round:1},
   {...raw(pick(6,{sid:id,score:55})),puzzle_id:'invalid-pick',answer_round:5,pick_number:0},
   {...raw(pick(7,{sid:id,score:55})),puzzle_id:'invalid-match',answer_round:1,trophy_match:null},
   {...raw(pick(8,{sid:id,score:70})),puzzle_id:'no-time',answer_round:3,answered_at:null},
   {...raw(pick(9,{sid:id,score:70})),puzzle_id:'shared',answer_round:2,answered_at:'2026-08-01T00:00:00Z',environment:'unknown'},
 ];
 const normal=normaliseInsightsRows(input),expected=normal.find(r=>r.puzzle_id==='shared');
 assert.equal(expected.session_id,id);
 assert.equal(expected.round,3);
 const sql=INSIGHTS_DECISION_ELIGIBILITY_SQL;
 // As a synthetic query stand-in, apply the SQL's own validity gates and
 // timestamp/session/round ordering to the same rows, independent of normalise.
 const selected=(puzzle)=>input.filter(r=>r.puzzle_id===puzzle&&
   Number.isInteger(r.score)&&r.score>=0&&r.score<=100&&
   Number.isInteger(r.pick_number)&&r.pick_number>=1&&r.pick_number<=11&&
   ['mixed','latest','powered-cube'].includes(r.environment)&&
   [true,false].includes(r.trophy_match)&&r.answered_at!=null)
   .sort((a,b)=>new Date(a.answered_at)-new Date(b.answered_at)||
     a.session_id.localeCompare(b.session_id)||a.answer_round-b.answer_round)[0];
 for(const puzzle of ['shared','another','invalid-score','invalid-pick','invalid-match','no-time']) {
   const targeted=selected(puzzle);
   assert.equal(targeted?.session_id,normal.find(r=>r.puzzle_id===puzzle)?.session_id,
     'First accepted session for '+puzzle);
   const req=targeted||input.find(r=>r.puzzle_id===puzzle);
   const mock=async(q,args)=>{
     if(q===sql){assert.deepEqual(args,[owner,puzzle]);return {rows:targeted?[targeted]:[]};}
     if(q===INSIGHTS_DECISION_SQL)return {rows:[{answer:{...answer,puzzle:{...source,puzzle_id:puzzle}},
       answered_at:targeted.answered_at,scoring_version:'v1',corpus_version:'v1'}]};
     throw Error('Unexpected full query');
   };
   if(targeted)await loadDraftRunInsightDecision(mock,owner,{
     session_id:targeted.session_id,round:targeted.answer_round,puzzle_id:puzzle});
   else await assert.rejects(loadDraftRunInsightDecision(mock,owner,{
     session_id:req.session_id,round:req.answer_round,puzzle_id:puzzle}),e=>e.status===404);
 }
 assert.match(sql,/jsonb_array_elements\(s.answers\) WITH ORDINALITY/);
 assert.match(sql,/picked.answer->>'score' ~/);
 assert.match(sql,/picked.answer->>'historicalMatch' IN/);
 assert.ok(!sql.includes('LIMIT 8000'),'puzzle filter is inside the same 1000-session CTE');
});

test('Saved type and rarity choices require competitive cross-category options, not raw counts',()=>{
 const row=(n,extra={})=>({
   ...pick(n),selected_id:n%4===0?'spell':'creature',
   selected_name:n%4===0?'Synthetic Spell':'Synthetic Creature',
   choice_candidates:[
     {id:'creature',type_line:'Artifact Creature — Golem',rarity:'common'},
     {id:'spell',type_line:'Instant',rarity:'rare'},
     {id:'filler',type_line:'Creature — Beast',rarity:'uncommon'},
   ],
   choice_ranking:[{id:'creature',name:'Synthetic Creature',support:.52},
     {id:'spell',name:'Synthetic Spell',support:.48},
     {id:'filler',name:'Synthetic Filler',support:.01}],...extra,
 });
 const base=Array.from({length:32},(_,i)=>row(i));
 const result=buildCardChoiceContext(base);
 assert.equal(result.schema_version,CHOICE_CONTEXT_RULE.version);
 assert.equal(result.scope.startsWith('all-eligible-history'),true);
 const cardType=result.choices.find(c=>c.id==='card-type'),rarity=result.choices.find(c=>c.id==='rarity');
 for(const group of [cardType,rarity]){
   assert.equal(group.status,'ready');
   assert.equal(group.opportunities,32);
   assert.equal(group.examples.length,2);
   assert.ok(group.summary.includes('32 picks'));
   assert.equal(group.availability['creature']??group.availability['common-uncommon'],32);
 }
 assert.deepEqual(cardType.selected,{creature:24,noncreature:8});
 assert.deepEqual(rarity.selected,{'rare-mythic':8,'common-uncommon':24});
 assert.deepEqual(cardType.availability,{creature:32,noncreature:32},
   'Low-support second creature is filler, not an additional competitive alternative');
 const invalid=row(100,{choice_candidates:[{id:'creature',type_line:'',rarity:''},
   {id:'spell',type_line:'Instant',rarity:'rare'}],choice_ranking:[
     {id:'creature',support:.5},{id:'spell',support:.5}]});
 const oneCategory=row(101,{choice_candidates:[
   {id:'creature',type_line:'Creature',rarity:'common'},
   {id:'spell',type_line:'Creature',rarity:'common'}]});
 const lowSupport=row(102,{choice_ranking:[{id:'creature',support:.95},
   {id:'spell',support:.01},{id:'filler',support:.01}]});
 const malformed=row(103,{choice_ranking:[{id:'creature',support:null},{id:'spell',support:.5}]});
 const partialRanking=row(104,{choice_ranking:[{id:'creature',support:.51},
   {id:'spell',support:.49}]});
 const duplicateCard=row(105,{choice_candidates:[
   {id:'creature',type_line:'Creature',rarity:'common'},
   {id:'creature',type_line:'Creature',rarity:'common'},
   {id:'spell',type_line:'Instant',rarity:'rare'}]});
 const withBad=buildCardChoiceContext([...base,invalid,oneCategory,lowSupport,malformed,
   partialRanking,duplicateCard]);
 assert.equal(withBad.choices[0].opportunities,32);
 assert.equal(withBad.choices[1].opportunities,32);
 const splitType=row(106,{choice_candidates:[
   {id:'creature',type_line:'Creature — Golem // Instant',rarity:'common'},
   {id:'spell',type_line:'Sorcery',rarity:'rare'},
   {id:'filler',type_line:'Creature',rarity:'uncommon'}]});
 const split=buildCardChoiceContext([...base,splitType]);
 assert.equal(split.choices[0].opportunities,32,
   'mixed creature/noncreature faces must not imply a single card-type choice');
 assert.equal(split.choices[1].opportunities,33,
   'a supported card with known rarity can still count for rarity context');
});
test('Availability counts vary with competitive cards; small version cohorts stay developing',()=>{
 const sample=(n,version='v1')=>({...pick(n,{version}),
   selected_id:'creature',
   choice_candidates:[
     {id:'creature',type_line:'Creature',rarity:'uncommon'},
     {id:'other',type_line:'Creature',rarity:'common'},
     {id:'spell',type_line:'Sorcery',rarity:'rare'},
   ],
   choice_ranking:[{id:'creature',support:.9},{id:'other',support:.81},{id:'spell',support:.7}],
 });
 const first=Array.from({length:18},(_,i)=>sample(i));
 const merged=buildCardChoiceContext([...first,...Array.from({length:17},(_,i)=>sample(100+i,'v2'))]);
 const type=merged.choices[0];
 assert.equal(type.status,'developing','35 rows across incompatible cohorts cannot meet the floor');
 assert.equal(type.opportunities,18);
 assert.equal(type.other_version_opportunities,17);
 assert.deepEqual(type.availability,{creature:36,noncreature:18});
 assert.deepEqual(type.selected,{creature:18,noncreature:0});
 assert.equal(type.examples.length,0,'Do not expose detail refs for under-sampled cohorts');
});
test('Highlight v3 reasons are factual, deterministic, disjoint and scoped',()=>{
 const source=Array.from({length:90},(_,i)=>{
   const hard=i%6===0,miss=i%6===1;
   return {...pick(i,{score:hard?100:miss?15:89,match:hard,band:hard?'hard':'medium'}),
     selected_id:'synthetic-'+(i%5),historical_id:'historical-'+i,
     choice_ranking:miss?[{id:'model',name:'Better Supported Choice',support:.8},
       {id:'synthetic-'+(i%5),name:'Picked Card',support:.16}]:[],
   };
 });
 const first=selectInsightHighlights(source),reverse=selectInsightHighlights([...source].reverse());
 assert.deepEqual(first,reverse);
 assert.equal(first.schema_version,HIGHLIGHTS_VERSION);
 const next=selectInsightHighlights(source,{page:2});
 const total=[...first.best,...first.misses,...next.best,...next.misses];
 assert.equal(new Set(total.map(r=>r.puzzle_id)).size,total.length);
 assert.ok(total.every(item=>item.reason_version===HIGHLIGHT_REASON_VERSION));
 assert.ok(total.every(item=>typeof item.reason_text==='string'&&item.reason_text.length>20));
 assert.ok(first.best.some(item=>item.reason_code==='hard-trophy-match'));
 assert.ok(first.misses.some(item=>item.reason_code==='saved-support-gap'));
 assert.ok(first.misses.every(item=>!item.trophy_match));
 assert.ok(first.best.length<=6&&first.misses.length<=6);
 const short=selectInsightHighlights(source.filter(row=>row.environment==='mixed'&&row.pick_number<3));
 assert.ok(short.best.every(item=>item.pick_number<3));
 assert.ok(short.misses.every(item=>item.pick_number<3));
});

test('leading difficulty finding features a relevant hard match before unrelated easy alternatives',()=>{
  const rows=[
    ...Array.from({length:10},(_,n)=>pick(n,{score:94,band:'easy',day:1900+n})),
    pick(101,{score:100,match:true,band:'hard',day:1911}),
    pick(102,{score:90,band:'hard',day:1906}),
    pick(103,{score:91,band:'easy',day:1907}),
  ];
  const finding={id:'difficulty',groups:[
    {band:'easy',label:'easy-rated decisions',relation:'higher'},
    {band:'hard',label:'hard-rated decisions',relation:'lower'},
  ]};
  const highlights=selectInsightHighlights(rows,{finding});
  assert.equal(highlights.best[0].puzzle_id,'p101',
    'hard source match competes for the featured position, not after three strong alternatives');
  assert.ok(highlights.best.slice(0,3).some(r=>r.finding_context?.includes('hard-rated')));
  assert.ok(highlights.best.slice(0,3).every(r=>r.finding_context),
    'when actual compared-group examples exist, the visible report should explain its finding');
  assert.deepEqual(selectInsightHighlights([...rows].reverse(),{finding}),highlights);
});
test('pick-position finding uses the compared positions, not a blanket early-pick boost',()=>{
  const rows=[
    ...Array.from({length:12},(_,n)=>pick(n,{score:98,sourcePick:1,day:1900+n})),
    ...Array.from({length:6},(_,n)=>pick(100+n,{score:85,sourcePick:n%2?8:6,day:1900+n})),
  ];
  const finding={id:'pick-depth',groups:[
    {pick_number:6,label:'P1P6 decisions',relation:'higher'},
    {pick_number:8,label:'P1P8 decisions',relation:'lower'},
  ]};
  const best=selectInsightHighlights(rows,{finding}).best;
  assert.equal(best.length,6);
  assert.ok(best.slice(0,3).every(row=>[6,8].includes(row.pick_number)));
  assert.ok(best[0].finding_context?.includes('P1P6'));
  const wrong=selectInsightHighlights(rows,{finding:{id:'pick-depth',groups:[
    {pick_number:11,label:'P1P11 decisions',relation:'higher'}]}}).best;
  assert.equal(wrong[0].finding_context,undefined,'unsupported positions cannot imply evidence');
});
test('recent useful misses beat three-year-old extremes without changing saved scores',()=>{
  const old=pick(900,{score:0,day:1,sourcePick:5}),
    recent=pick(901,{score:34,day:1096,sourcePick:5});
  old.set_id='neo';recent.set_id='neo';
  const result=selectInsightHighlights([old,recent]);
  assert.equal(result.misses[0].puzzle_id,'p901');
  assert.deepEqual(selectInsightHighlights([recent,old]),result);
  assert.equal(result.misses[1].score,0,'old extreme is retained as an additional true example');
});
test('aggregate passes exact compared 6/8 groups to highlights but returns no raw puzzle IDs',()=>{
  const rows=Array.from({length:80},(_,n)=>raw(pick(n,{
    score:n%2?42:95,sourcePick:n%2?8:6,day:Math.floor(n/2),band:'medium',
  })));
  const result=aggregateDraftRunInsights(rows,{now:new Date('2027-12-01T00:00:00Z')});
  assert.equal(result.leading_finding?.id,'pick-depth');
  assert.deepEqual(result.leading_finding.compared_groups.map(g=>g.label),
    ['P1P6 source picks','P1P8 source picks']);
  assert.ok(result.highlights.best.slice(0,3).every(r=>[6,8].includes(r.pick_number)));
  assert.ok([...result.highlights.best.slice(0,3),...result.highlights.misses.slice(0,3)].every(r=>r.finding_context),
    'the headline is only shown when all visible examples belong to its comparison');
  assert.ok(result.highlights.misses.slice(0,3).every(r=>[6,8].includes(r.pick_number)));
  assert.doesNotMatch(JSON.stringify(result.leading_finding),/puzzle_ids|puzzle_id/);
});

test('Pick-position headline examples come from the same scoring cohort',()=>{
 const old=Array.from({length:80},(_,n)=>raw(pick(n,{score:n%2?25:98,sourcePick:n%2?8:6,
   version:'old-source'})));
 const newer=Array.from({length:25},(_,n)=>raw(pick(200+n,{score:12,sourcePick:6,
   version:'new-source',day:100+n})));
 const result=aggregateDraftRunInsights([...old,...newer],{now:new Date('2027-12-01T00:00:00Z')});
 assert.equal(result.leading_finding?.id,'pick-depth');
 // The only eligible comparison is the old compatible scoring cohort.
 assert.ok(result.highlights.best.filter(r=>r.finding_context).every(r=>r.puzzle_id.startsWith('p')&&
   Number(r.puzzle_id.slice(1))<200));
 assert.ok(result.highlights.misses.filter(r=>r.finding_context).every(r=>Number(r.puzzle_id.slice(1))<200));
});
test('Saved model alternative must distinguish the trophy from a third card',()=>{
 const a=pick(1100,{score:30});
 a.selected_id='mine';a.historical_id='trophy';a.choice_ranking=[
   {id:'mine',name:'Your Card',support:.12},
   {id:'third',name:'Model Leader',support:.9},
   {id:'trophy',name:'Trophy Card',support:.55},
 ];
 const out=selectInsightHighlights([a]).misses[0];
 assert.equal(out.reason_code,'saved-support-gap');
 assert.equal(out.reason_evidence.leader_id,'third');
 assert.equal(out.reason_evidence.leader_is_trophy,0);
 assert.match(out.reason_text,/different card from the trophy pick/);
 const same={...a,choice_ranking:[
   {id:'mine',name:'Your Card',support:.12},
   {id:'third',name:'Model Leader',support:.55},
   {id:'trophy',name:'Trophy Card',support:.9},
 ]};
 const trophy=selectInsightHighlights([same]).misses[0];
 assert.equal(trophy.reason_evidence.leader_is_trophy,1);
 assert.match(trophy.reason_text,/the trophy pick/);
});
test('Format and raw model-difficulty differences never become headline advice',()=>{
 const rows=[...Array.from({length:40},(_,n)=>raw(pick(n,{score:20,
   band:'easy',sourcePick:n%2?3:5}))),
   ...Array.from({length:40},(_,n)=>raw(pick(n+100,{score:95,
     band:'hard',sourcePick:n%2?3:5}))),
   ...Array.from({length:40},(_,n)=>raw(pick(n+300,{score:90,
     environment:'latest',band:'easy',sourcePick:3})))];
 const agg=aggregateDraftRunInsights(rows,{now:new Date('2027-12-01T00:00:00Z')});
 assert.ok(!['difficulty','format-latest'].includes(agg.leading_finding?.id));
 assert.ok(agg.observations.every(o=>o.id!=='difficulty'&&!o.id.startsWith('format-')));
});
