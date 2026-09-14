import test from 'node:test';
import assert from 'node:assert/strict';
import {consensusFeedback} from '../draft-run-feedback.mjs';
import {draftRunShareText} from '../share-cards.mjs';
import {escapeHtml} from '../html.mjs';

test('locked feedback separates the trophy bonus from relative model support',()=>{
 const answer={consensusName:'Leader',consensusSupport:0.5,selectedSupport:0.05,selectedId:'trophy',historicalId:'trophy',historicalMatch:true,ranking:[{id:'trophy',name:'Trophy',support:0.05,score:100},{id:'leader',name:'Leader',support:0.5,score:95}]};
 const text=consensusFeedback(answer);
 assert.match(text,/10% of the leading/);assert.match(text,/earns 100 regardless/);
 assert.ok(text.indexOf('data-zoom="leader"')<text.indexOf('data-zoom="trophy"'));
 assert.match(text,/does not establish a correct pick/);
 assert.equal(consensusFeedback({}), '');
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
