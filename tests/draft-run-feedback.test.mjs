import test from 'node:test';
import assert from 'node:assert/strict';
import {compactDraftRunFeedback,consensusFeedback} from '../draft-run-feedback.mjs';
import {draftRunShareText} from '../share-cards.mjs';
import {escapeHtml} from '../html.mjs';

test('locked feedback separates the trophy bonus from relative model support',()=>{
 const answer={consensusName:'Leader',consensusSupport:0.5,selectedSupport:0.05,selectedId:'trophy',historicalId:'trophy',historicalName:'Trophy',historicalMatch:true,ranking:[{id:'trophy',name:'Trophy',support:0.05,score:100},{id:'leader',name:'Leader',support:0.5,score:95}]};
 const text=consensusFeedback(answer);
 assert.doesNotMatch(text,/10%/);assert.match(text,/earn 100 regardless/);
 assert.ok(text.indexOf('data-zoom="trophy"')<text.indexOf('data-zoom="leader"'));
 assert.match(text,/<td>—<\/td><td>100<\/td>/);
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
 const text=draftRunShareText(run);assert.match(text,/Draft Run · Daily 2026-09-14/);assert.match(text,/🟩🟦🟨🟧⬛/);assert.doesNotMatch(text,/Secret/);
 assert.match(draftRunShareText({...run,day:null,environment:'powered-cube'}),/Powered Cube · Practice/);
});
