import test from 'node:test';
import assert from 'node:assert/strict';
import {impliedTrophyScore,meetsServingQuality,MINIMUM_TROPHY_SUPPORT_RATIO} from '../serving-quality.mjs';
import {gradeDraftRunPick,selectDraftRunReroll} from '../draft-run.mjs';
const puzzle=ratio=>({historical_pick_id:'trophy',candidates:[{id:'leader',name:'Leader',model_probability:.5},{id:'trophy',name:'Trophy',model_probability:.5*ratio},{id:'other',name:'Other',model_probability:.1}]});
test('floor uses the same rounded raw-support partial-credit formula while trophy awards remain 100',()=>{
 for(const [points,accepted] of [[0,false],[19,false],[19.49,false],[19.51,true],[20,true],[95,true]]){const p=puzzle(points/95);assert.equal(impliedTrophyScore(p),Math.round(points));assert.equal(meetsServingQuality(p),accepted);assert.equal(gradeDraftRunPick(p,'trophy').score,100);assert.equal(gradeDraftRunPick(p,'leader').score,95);}
 for(const p of [{},{target_support_ratio:null},{target_support_ratio:NaN},{target_support_ratio:-1}])assert.equal(meetsServingQuality(p),false);
});
test('metadata and full payload eligibility agree, and unsupported rerolls are excluded',()=>{
 for(const ratio of [0,.1,.2,.2052,.2053,.5,1])assert.equal(impliedTrophyScore({target_support_ratio:ratio}),impliedTrophyScore(puzzle(ratio)));
 const base={set_id:'blb',pick_number:1,candidate_count:14,consensus_top_gap:.1,support_entropy:.8,difficulty_version:'support-ratio-v1',top_two_ratio:.65};
 const source={...base,puzzle_id:'source',source_draft_hash:'source',target_support_ratio:1},bad={...base,puzzle_id:'bad',source_draft_hash:'bad',target_support_ratio:.1};
 assert.equal(selectDraftRunReroll([bad],source,{type:'pack',round:0,seed:'floor'}),null);
});
test('indexable ratio boundary agrees with integer scoring at adjacent float64 values',()=>{
 const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,MINIMUM_TROPHY_SUPPORT_RATIO);
 const bits=view.getBigUint64(0);
 for(let offset=-4n;offset<=4n;offset++){
  view.setBigUint64(0,bits+offset);const ratio=view.getFloat64(0);
  assert.equal(ratio>=MINIMUM_TROPHY_SUPPORT_RATIO,meetsServingQuality({target_support_ratio:ratio}));
 }
});
