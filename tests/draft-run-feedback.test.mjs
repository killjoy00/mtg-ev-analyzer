import test from 'node:test';
import assert from 'node:assert/strict';
import {compactDraftRunFeedback,consensusFeedback,trophyDrafterDetails,trophyDrafterFacts,trophyDrafterSentences,trophyRevealSentence} from '../draft-run-feedback.mjs';
import {draftRunShareText,draftRunNativeShareData,dailyShareUrl,dailySetRunIds,dailySetShareRuns,dailySetShareText,pickGrades} from '../share-cards.mjs';
import {escapeHtml} from '../html.mjs';

test('trophy reveal headlines name the pick only, regardless of source-drafter evidence',()=>{
 const match={historicalMatch:true,historicalName:'Lightning Bolt',trophyRecord:'has a 62% win rate'};
 assert.equal(trophyRevealSentence(match),'You matched the trophy pick.');
 assert.equal(trophyRevealSentence({...match,trophyRecord:'went 7–1'}),'You matched the trophy pick.');
 assert.equal(trophyRevealSentence({...match,trophyRecord:null}),'You matched the trophy pick.');
 const different={...match,historicalMatch:false};
 assert.equal(trophyRevealSentence(different),'The trophy drafter took Lightning Bolt.');
 assert.equal(trophyRevealSentence({...different,trophyRecord:'went 7–2'}),'The trophy drafter took Lightning Bolt.');
 assert.equal(trophyRevealSentence({...different,trophyRecord:null}),'The trophy drafter took Lightning Bolt.');
 assert.equal(trophyRevealSentence({...different,historicalName:null}),'The trophy drafter took another card.');
 for(const state of [match,different])assert.doesNotMatch(trophyRevealSentence(state),/62%|7–1|7–2|win rate/);
});

test('source-drafter record and win rate are shown separately in post-pick analysis',()=>{
 const both=trophyDrafterDetails({trophyDrafter:{record:'7–1',winRate:62,rank:null}});
 assert.equal(both,'<div class="run-trophy-record"><p>This trophy draft finished 7-1.</p><p>The drafter wins about 62% of their games on 17Lands.</p></div>');
 assert.equal(trophyDrafterDetails({trophyDrafter:{record:null,winRate:null,rank:'Mythic'}}),'<div class="run-trophy-record"><p>The trophy drafter reached Mythic rank.</p></div>');
 assert.equal(trophyDrafterDetails({trophyDrafter:null}),'');
 assert.equal(trophyDrafterDetails({}),'');
 assert.doesNotMatch(trophyDrafterDetails({trophyDrafter:{record:'<script>',winRate:'<b>',rank:'<i>'}}),/<script|<b>|<i>/,'only known shapes render');
});

test('older answers keep their saved drafter context without a new lookup',()=>{
 assert.deepEqual(trophyDrafterFacts({trophyRecord:'has a 62% win rate'}),{record:null,winRate:62,rank:null});
 assert.deepEqual(trophyDrafterFacts({trophyRecord:'went 7–2'}),{record:'7–2',winRate:null,rank:null});
 assert.deepEqual(trophyDrafterFacts({trophyRecord:'reached Diamond rank'}),{record:null,winRate:null,rank:'Diamond'});
 for(const legacy of ['won 7 matches','went 7–3','has a 140% win rate','<script>alert(1)</script>',null,''])
  assert.equal(trophyDrafterFacts({trophyRecord:legacy}),null,String(legacy));
 assert.deepEqual(trophyDrafterFacts({trophyDrafter:{record:'7–0',winRate:64},trophyRecord:'went 7–2'}),{record:'7–0',winRate:64,rank:null},'structured evidence wins');
});

test('the win rate is labeled as 17Lands\u2019 overall figure, never this format, draft or card',()=>{
 const [record,rate]=trophyDrafterSentences({record:'7–2',winRate:60,rank:null});
 assert.equal(record,'This trophy draft finished 7-2.');
 assert.equal(rate,'The drafter wins about 60% of their games on 17Lands.');
 assert.doesNotMatch(rate,/Premier|format|this set/i);
 assert.deepEqual(trophyDrafterSentences(null),[]);
});

test('trophy model support stays a dash for matches and non-matches',()=>{
 const answer={consensusName:'Leader',consensusSupport:.5,selectedId:'trophy',historicalId:'trophy',ranking:[{id:'trophy',name:'Trophy',support:.05,score:100},{id:'leader',name:'Leader',support:.5,score:95}]};
 for(const selectedId of ['trophy','leader']) {
 const text=consensusFeedback({...answer,selectedId});
 assert.match(text,/<td>-<\/td><td>100<\/td>/);
 assert.doesNotMatch(text,/<td>10%<\/td>/);
 assert.match(text,/<td>100%<\/td><td>95<\/td>/);
 assert.match(text,/Matching the trophy pick earns 100 points/);
 assert.match(text,/It isn’t a win rate/);assert.match(text,/<details class="run-consensus-all">/);
 assert.match(text,/data-peer-col hidden>Players’ picks/);
 assert.equal(consensusFeedback({}),'');
 }
});

test('compact feedback names the player’s pick without grading adjectives or filler',()=>{
 assert.equal(compactDraftRunFeedback({historicalMatch:false,selectedName:'Player',modelTargetDisagreement:true,score:95}),'You picked Player.');
 assert.equal(compactDraftRunFeedback({historicalMatch:false,selectedName:'Player',score:10}),'You picked Player.');
 assert.equal(compactDraftRunFeedback({historicalMatch:true,selectedName:'Player'}),'');
 assert.equal(compactDraftRunFeedback({historicalMatch:false}),'');
});

test('deck links require availability and do not invent a missing event record',()=>{
 assert.doesNotMatch(trophyDrafterDetails({trophyDrafter:{record:'7–1'}}),/data-trophy-deck/);
 const text=trophyDrafterDetails({deckAvailable:true,trophyDrafter:{record:'7–1'}});
 assert.match(text,/finished 7-1\. <button/);assert.match(text,/See the trophy drafter’s deck/);
 assert.doesNotMatch(trophyDrafterDetails({deckAvailable:true}),/finished/);
});

test('feedback escapes names and attributes in the full comparison',()=>{
 assert.equal(escapeHtml(`<'"&>`),'&lt;&#039;&quot;&amp;&gt;');
 const text=consensusFeedback({consensusName:'Leader',consensusSupport:1,ranking:[{id:'unsafe"',name:'<img src=x onerror=alert(1)>',support:.5,score:67}]});
 assert.doesNotMatch(text,/<img/);assert.match(text,/&lt;img/);assert.match(text,/50%/);
});

test('result text is spoiler-free, dated, and distinguishes Cube, practice and trophy matches',()=>{
 const run={day:'2026-09-14',score:65,answers:[{score:100,historicalMatch:true,selectedName:'Secret card'},{score:95},{score:60},{score:25},{score:0}]};
 const text=draftRunShareText(run);assert.match(text,/I scored 65\/100 on the Pack One Draft Run Daily \(Sep 14\)\./);assert.match(text,/🟩🟦🟨🟧⬛/);assert.doesNotMatch(text,/Secret/);
 assert.match(text,/Try Pack One's Daily\. No account needed:$/,'recipients learn they can play their own Daily');
 assert.doesNotMatch(text,/beat|same picks|same 8/i,'a link opened on another day plays different decisions');
 assert.match(draftRunShareText({...run,environment:'latest'}),/Pack One Latest Set Daily/);
 assert.match(draftRunShareText({...run,day:null,environment:'powered-cube'}),/Powered Cube · Practice/);
});

test('Daily share links use the short per-mode route with only the sharer\'s date and never a replay',()=>{
 assert.equal(dailyShareUrl({day:'2026-10-27',environment:'mixed'}),'https://packone.pro/d/?d=2026-10-27');
 assert.equal(dailyShareUrl({day:'2026-10-27',environment:'powered-cube'}),'https://packone.pro/d/c/?d=2026-10-27');
 assert.equal(dailyShareUrl({day:'2026-10-27',environment:'latest'}),'https://packone.pro/d/l/?d=2026-10-27');
 assert.equal(dailyShareUrl({day:'2026-10-27',environment:'unknown'}),'https://packone.pro/d/?d=2026-10-27');
 assert.equal(dailyShareUrl({day:'2026-10-27',environment:'latest'},'http://127.0.0.1:4173'),'http://127.0.0.1:4173/d/l/?d=2026-10-27');
 for(const environment of ['mixed','powered-cube','latest'])
  assert.ok(dailyShareUrl({day:'2026-10-27',environment}).length<=40,'the link stays short in a chat');
 assert.throws(()=>dailyShareUrl({day:null,environment:'mixed'}),/Daily date/);
 assert.deepEqual(pickGrades([{historicalMatch:true,score:100},{score:85},{score:60},{score:25},{score:24}]),
  ['match','strong','good','fair','miss']);
});

test('Draft Run native shares keep summary, squares and link together on iPhone and iPad',()=>{
 const run={day:'2026-10-13',environment:'mixed',score:65,answers:[{historicalMatch:true,score:100},{historicalMatch:false,score:95},{historicalMatch:false,score:60}]};
 const text=draftRunShareText(run),url='https://packone.pro/d/?d=2026-10-13';
 for(const browser of ['Version/27.0 Mobile/15E148 Safari/604.1','CriOS/151.0.7922.25 Mobile/15E148 Safari/604.1','EdgiOS/151.0 Mobile/15E148 Safari/604.1']){
   const data=draftRunNativeShareData(text,url,{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0_1 like Mac OS X) '+browser});
   assert.deepEqual(data,{text:`${text}\n${url}`});
   assert.match(data.text,/🟩🟦🟨/);
   assert.equal('url' in data,false,'iOS must not receive a competing URL share item');
 }
 assert.deepEqual(draftRunNativeShareData(text,url,{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X)',platform:'MacIntel',maxTouchPoints:5}),{text:`${text}\n${url}`},'desktop-UA iPad also uses one share text item');
 for(const agent of ['Mozilla/5.0 (Linux; Android 16)', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)']){
   assert.deepEqual(draftRunNativeShareData(text,url,{userAgent:agent}),{title:'Pack One',text,url},'non-iOS targets keep the existing structured share contract');
 }
});

const dailyRun=(environment,score,grades,{day='2026-11-07',...rest}={})=>({id:environment+'-id',day,environment,complete:true,run_length:8,score,
 answers:grades.map((grade,i)=>({selectedName:'Secret '+environment+i,historicalMatch:grade==='match',score:{match:100,strong:90,good:70,fair:30,miss:0}[grade]})),...rest});
const eight=(...grades)=>Array.from({length:8},(_,i)=>grades[i%grades.length]);

test('the day share lists all three Dailies in a fixed order with squares and no card names',()=>{
 const cube=dailyRun('powered-cube',90,eight('match','strong')),latest=dailyRun('latest',74,eight('good','miss')),mixed=dailyRun('mixed',82,eight('match','fair'));
 const set=dailySetShareRuns([latest,mixed,cube]);
 assert.deepEqual(set.map(r=>r.environment),['mixed','powered-cube','latest'],'rows never depend on completion order');
 assert.equal(dailySetShareText(set),[
  'Pack One · Nov 7',
  'Draft Run 82 🟩🟧🟩🟧🟩🟧🟩🟧',
  'Powered Cube 90 🟩🟦🟩🟦🟩🟦🟩🟦',
  'Latest Set 74 🟨⬛🟨⬛🟨⬛🟨⬛',
 ].join('\n'));
 assert.doesNotMatch(dailySetShareText(set),/Secret|beat|same picks/i,'spoiler-free and never a challenge to the same picks');
});

test('the day share needs exactly one complete Daily per mode from the same day',()=>{
 const full=['mixed','powered-cube','latest'].map(env=>dailyRun(env,80,eight('good')));
 assert.ok(dailySetShareRuns(full));
 assert.equal(dailySetShareRuns(full.slice(0,2)),null,'two Dailies are not a set');
 assert.equal(dailySetShareRuns([full[0],full[1],dailyRun('mixed',80,eight('good'))]),null,'a repeated mode is not a set');
 assert.equal(dailySetShareRuns([full[0],full[1],dailyRun('latest',80,eight('good'),{day:'2026-11-06'})]),null,'yesterday never joins today');
 assert.equal(dailySetShareRuns([full[0],full[1],{...full[2],complete:false}]),null,'an unfinished run is not shared');
 assert.equal(dailySetShareRuns([full[0],full[1],{...full[2],answers:full[2].answers.slice(0,5)}]),null,'a partial answer list is not shared');
 assert.equal(dailySetShareRuns([full[0],full[1],{error:'not found'}]),null,'a failed read is not shared');
 assert.equal(dailySetShareRuns(null),null);
});

test('the day share reads the other two run IDs only from today\'s status for the same day',()=>{
 const id=n=>`${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111`;
 const row=(set_id,run_id,date='2026-11-07')=>({date,mode:'draft_run',set_id,score:80,run_id});
 const current={day:'2026-11-07',environment:'latest'};
 assert.deepEqual(dailySetRunIds([row('latest',id(3)),row('powered-cube',id(2)),row('mixed',id(1))],current),[id(1),id(2)]);
 assert.deepEqual(dailySetRunIds([row('mixed',id(1)),row('powered-cube',id(2))],current),[id(1),id(2)],'the result on screen may be missing from a lagging history read');
 assert.equal(dailySetRunIds([row('mixed',id(1))],current),null,'a missing Daily leaves the single share');
 assert.equal(dailySetRunIds([row('mixed',id(1),'2026-11-06'),row('powered-cube',id(2))],current),null,'yesterday never joins today');
 assert.equal(dailySetRunIds([row('mixed','../admin'),row('powered-cube',id(2))],current),null,'only run IDs the run route accepts are requested');
 assert.equal(dailySetRunIds([row('mixed',undefined),row('powered-cube',id(2))],current),null,'older status without run IDs leaves the single share');
 assert.equal(dailySetRunIds(undefined,current),null);
 assert.equal(dailySetRunIds([row('mixed',id(1)),row('powered-cube',id(2))],{day:null,environment:'latest'}),null,'practice runs never get a day share');
});
