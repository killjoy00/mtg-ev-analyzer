import test from 'node:test';
import assert from 'node:assert/strict';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {probabilityMetrics,trajectoryHealth,matchesFrozenSourceAudit} from '../scripts/corpus-health-evidence.mjs';
const puzzle=(pick,prior,historical)=>({source_draft_hash:'source',source_fingerprint:'fingerprint',pick_number:pick,prior_picks:prior.map(id=>({id})),historical_pick_id:historical,candidates:[{id:'a',model_probability:.7},{id:'b',model_probability:.3}]});
test('health evaluates frozen calibrated probabilities separately from raw evidence',()=>{
 const metrics=probabilityMetrics(null,DRAFT_RUN_CORPUS_VERSION);metrics.add(puzzle(1,[],'a'));
 const r=metrics.report();assert.equal(r.supportExponent,1.75);assert.equal(r.top1,1);assert.equal(r.meanRank,1);assert.ok(r.logLoss<r.rawLogLoss);assert.equal(r.bins.reduce((n,b)=>n+b.n,0),1);
});
test('trajectory health checks ordered pool inheritance regardless of payload arrival order',()=>{
 const health=trajectoryHealth();health.add(puzzle(3,['a','b'],'c'));health.add(puzzle(1,[],'a'));health.add(puzzle(2,['a'],'b'));assert.equal(health.errors(),0);
 const broken=trajectoryHealth();broken.add(puzzle(1,[],'a'));broken.add(puzzle(2,['b'],'a'));assert.ok(broken.errors()>0);
 const inherited=trajectoryHealth();inherited.add(puzzle(2,['x'],'a'));inherited.add(puzzle(3,['x','a'],'b'));assert.equal(inherited.errors(),0);
});
test('source audit cannot certify a changed source or input signature',()=>{
 const m={input_signature:'input',source_archive:{sha256:'hash'},included_trophies:10,source_drafts:100};
 const a={production_changed:false,loss_field_available:true,input_signature:'input',source_archive:{sha256:'hash'},included_sources:10,archive_drafts:100};
 assert.ok(matchesFrozenSourceAudit(m,a));assert.ok(!matchesFrozenSourceAudit(m,{...a,input_signature:'changed'}));assert.ok(!matchesFrozenSourceAudit({...m,source_archive:{sha256:'other'}},a));
});

test('historical fingerprint recipe differences are visible separately from broken pick inheritance',()=>{
 const h=trajectoryHealth();h.add(puzzle(1,[],'a'));h.add({...puzzle(2,['a'],'b'),source_fingerprint:'legacy-recipe'});assert.equal(h.errors(),0);assert.equal(h.fingerprintVariations(),1);
});
