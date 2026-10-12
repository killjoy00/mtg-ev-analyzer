import test from 'node:test';
import assert from 'node:assert/strict';
import {compactDraftRunFeedback,consensusFeedback,trophyDrafterDetails,trophyDrafterFacts,trophyDrafterSentences,trophyRevealSentence} from '../draft-run-feedback.mjs';
import {draftRunShareText} from '../share-cards.mjs';
import {escapeHtml} from '../html.mjs';

test('trophy reveal headlines name the pick only, regardless of source-drafter evidence',()=>{
 const match={historicalMatch:true,historicalName:'Lightning Bolt',trophyRecord:'has a 62% win rate'};
 assert.equal(trophyRevealSentence(match),'You matched the trophy drafter.');
 assert.equal(trophyRevealSentence({...match,trophyRecord:'went 7–1'}),'You matched the trophy drafter.');
 assert.equal(trophyRevealSentence({...match,trophyRecord:null}),'You matched the trophy drafter.');
 const different={...match,historicalMatch:false};
 assert.equal(trophyRevealSentence(different),'The trophy drafter took Lightning Bolt.');
 assert.equal(trophyRevealSentence({...different,trophyRecord:'went 7–2'}),'The trophy drafter took Lightning Bolt.');
 assert.equal(trophyRevealSentence({...different,trophyRecord:null}),'The trophy drafter took Lightning Bolt.');
 assert.equal(trophyRevealSentence({...different,historicalName:null}),'The trophy drafter took another card.');
 for(const state of [match,different])assert.doesNotMatch(trophyRevealSentence(state),/62%|7–1|7–2|win rate/);
});

test('source-drafter record and win rate are shown separately, only in expanded analysis',()=>{
 const both=trophyDrafterDetails({trophyDrafter:{record:'7–1',winRate:62,rank:null}});
 assert.equal(both,'<div class="run-trophy-record"><p>This trophy draft finished 7–1.</p><p>17Lands reports the trophy drafter’s overall game win rate as about 62%. It describes the drafter, not this draft or this card.</p></div>');
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
 assert.equal(record,'This trophy draft finished 7–2.');
 assert.match(rate,/^17Lands reports the trophy drafter\u2019s overall game win rate as about 60%\./);
 assert.match(rate,/not this draft or this card/);
 assert.doesNotMatch(rate,/Premier|format|this set/i);
 assert.deepEqual(trophyDrafterSentences(null),[]);
});

test('locked feedback separates the trophy bonus from relative model support',()=>{
 const answer={consensusName:'Leader',consensusSupport:0.5,selectedSupport:0.05,selectedId:'trophy',historicalId:'trophy',historicalName:'Trophy',historicalMatch:true,ranking:[{id:'trophy',name:'Trophy',support:0.05,score:100},{id:'leader',name:'Leader',support:0.5,score:95}]};
 const text=consensusFeedback(answer);
 assert.doesNotMatch(text,/10%/);assert.match(text,/earn 100 regardless/);
 assert.ok(text.indexOf('data-zoom="trophy"')<text.indexOf('data-zoom="leader"'));
 assert.match(text,/<td>N\/A<\/td><td>100<\/td>/);
 assert.match(text,/does not establish a correct pick/);
 assert.match(text,/Trophy drafter: Trophy: 100/);
 assert.match(text,/Model’s strongest alternative: Leader: 95/);
 assert.match(text,/Compare all 2 choices/);
 assert.doesNotMatch(text,/<details/);
 assert.doesNotMatch(text,/95 ×/);
 assert.equal(consensusFeedback({}), '');
});

test('compact feedback reserves target disagreement for the rare server flag',()=>{
 const rare={score:95,historicalMatch:false,modelTargetDisagreement:true,selectedName:'Player'};
 assert.equal(compactDraftRunFeedback(rare),'You chose Player. The trophy drafter made an unusual choice relative to the model.');
 const ordinary={score:95,historicalMatch:false,modelTargetDisagreement:false,consensusName:'Leader',consensusId:'leader',consensusSupport:.6,selectedSupport:.5,selectedId:'player',selectedName:'Player',historicalId:'trophy',historicalName:'Trophy',ranking:[{id:'leader',name:'Leader',support:.6,score:95},{id:'trophy',name:'Trophy',support:.1,score:100},{id:'player',name:'Player',support:.5,score:80}]};
 assert.equal(compactDraftRunFeedback(ordinary),'You chose Player. A strongly supported alternative.');
 assert.doesNotMatch(compactDraftRunFeedback(ordinary),/strongest|model leader|Trophy drafter: Trophy/i);
 assert.match(consensusFeedback(ordinary),/Model’s strongest alternative: Leader: 95/);
 assert.equal(compactDraftRunFeedback({...ordinary,score:70}),'You chose Player. A plausible alternative.');
 assert.equal(compactDraftRunFeedback({...ordinary,score:40}),'You chose Player. The model found less support for this choice.');
 assert.equal(compactDraftRunFeedback({...ordinary,historicalMatch:true}),'');
 assert.equal(compactDraftRunFeedback({score:95,historicalMatch:false}),'A strongly supported alternative.');
});

test('feedback and shared HTML escaping protect card names and attributes',()=>{
 assert.equal(escapeHtml(`<'"&>`),'&lt;&#039;&quot;&amp;&gt;');
 const text=consensusFeedback({consensusName:'<img src=x onerror=alert(1)>',consensusSupport:1,selectedSupport:0,ranking:[]});
 assert.doesNotMatch(text,/<img/);assert.match(text,/&lt;img/);assert.match(text,/0%/);
});

test('result text is spoiler-free, dated, and distinguishes Cube, practice and trophy matches',()=>{
 const run={day:'2026-09-14',score:65,answers:[{score:100,historicalMatch:true,selectedName:'Secret card'},{score:95},{score:60},{score:25},{score:0}]};
 const text=draftRunShareText(run);assert.match(text,/I scored 65\/100 on today’s Pack One Draft Run\. Can you beat it\?/);assert.match(text,/Daily 2026-09-14/);assert.match(text,/🟩🟦🟨🟧⬛/);assert.doesNotMatch(text,/Secret/);
 assert.match(draftRunShareText({...run,day:null,environment:'powered-cube'}),/Powered Cube · Practice/);
});
