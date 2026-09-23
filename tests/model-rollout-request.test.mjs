import test from 'node:test';
import assert from 'node:assert/strict';
import {rolloutDispatch} from '../scripts/model-rollout-request.mjs';

const common={request_id:'test-request',reason:'Exercise the reviewed rollout path'};
test('rollout requests can target only fixed workflows on main',()=>{
  assert.deepEqual(rolloutDispatch({...common,operation:'deploy',target:'development',commit:'a'.repeat(40)}),{
    workflow:'deploy-functions.yml',body:{ref:'main',inputs:{target:'development',commit:'a'.repeat(40)}},
  });
  assert.equal(rolloutDispatch({...common,operation:'import',target:'build-only',sets:'ktk,powered-cube'}).workflow,'import-all-trophies.yml');
  for(const request of [
    {...common,operation:'arbitrary-command'},
    {...common,operation:'browser',ref:'unreviewed'},
    {...common,operation:'deploy',target:'production',commit:'main'},
    {...common,operation:'import',target:'production',sets:'all; echo unexpected'},
    {...common,operation:'import',target:'another-database',sets:'all'},
  ])assert.throws(()=>rolloutDispatch(request));
});
test('the issue 164 v4 rebuild can only dispatch its fixed reviewed workflow',()=>{
  const request={...common,operation:'rebuild-v4'};
  assert.deepEqual(rolloutDispatch(request),{
    workflow:'rebuild-v4-draft-run-corpus.yml',
    body:{ref:'main',inputs:{}},
  });
  for(const extra of [{corpus_version:'other'},{target:'production'},{ref:'branch'},{workflow:'other.yml'}])
    assert.throws(()=>rolloutDispatch({...request,...extra}));
});
test('format research dispatch cannot select arbitrary sets, code refs or targets',()=>{
  const request={operation:'format-research',reason:'Predeclared protocol',request_id:'research-1'};
  assert.deepEqual(rolloutDispatch(request),{workflow:'format-research.yml',body:{ref:'main',inputs:{}}});
  for(const extra of [{sets:'all'},{target:'production'},{ref:'branch'}])assert.throws(()=>rolloutDispatch({...request,...extra}));
});
test('frozen scoring dispatch runs only the reviewed fixed protocol',()=>{
  assert.deepEqual(rolloutDispatch({operation:'frozen-scoring',reason:'Frozen model validation',request_id:'scoring-1'}),{workflow:'frozen-scoring.yml',body:{ref:'main',inputs:{}}});
});

test('Traditional inventory evaluation cannot publish or change training inputs',()=>{
  const request={operation:'traditional-puzzles',reason:'Fixed Premier v3 puzzle gates',request_id:'traditional-v3'};
  assert.deepEqual(rolloutDispatch(request),{workflow:'traditional-puzzles.yml',body:{ref:'main',inputs:{}}});
  for(const extra of [{sets:'all'},{target:'production'},{training_cap:10000}])assert.throws(()=>rolloutDispatch({...request,...extra}));
});

test('frozen outcome audit is read-only with fixed artifact and set coverage',()=>{
  const request={operation:'audit-frozen-outcomes',reason:'Verify actual trophy source outcomes',request_id:'source-audit'};
  assert.deepEqual(rolloutDispatch(request),{workflow:'audit-frozen-outcomes.yml',body:{ref:'main',inputs:{}}});
  assert.throws(()=>rolloutDispatch({...request,target:'production'}));
});


test('rebuild preparation is target-only and cannot request arbitrary artifacts or migrations',()=>{
  const base={operation:'prepare-rebuild',request_id:'stage-v7',reason:'Reviewed additive release staging',target:'development'};
  assert.deepEqual(rolloutDispatch(base),{workflow:'prepare-rebuild.yml',body:{ref:'main',inputs:{target:'development'}}});
  assert.throws(()=>rolloutDispatch({...base,target:'other'}));
  assert.throws(()=>rolloutDispatch({...base,run_id:123}));
  assert.throws(()=>rolloutDispatch({...base,migration:'0016'}));
});

test('source release requires an explicit action and a reviewed fixed artifact group',()=>{
 const r={operation:'puzzle-components',request_id:'cube-stage',reason:'Approved source admission',target:'development',action:'stage',source:'powered-cube'};
 assert.equal(rolloutDispatch(r).workflow,'publish-puzzle-components.yml');
 assert.equal(rolloutDispatch({...r,request_id:'phase2-stage',source:'regular-phase2'}).body.inputs.source,'regular-phase2');
 for(const extra of [{source:'all'},{action:'automatic'},{target:'arbitrary'},{artifact_id:123}])assert.throws(()=>rolloutDispatch({...r,...extra}));
});

test('corpus health allows only explicit known targets and no source mutations',()=>{
 const r={operation:'corpus-health',request_id:'health-1',reason:'Full current corpus verification',target:'production'};
 assert.equal(rolloutDispatch(r).workflow,'corpus-health.yml');
 assert.throws(()=>rolloutDispatch({...r,action:'publish'}));assert.throws(()=>rolloutDispatch({...r,target:'unknown'}));
});

test('Patreon discovery is read-only and cannot activate memberships',()=>{
 assert.equal(rolloutDispatch({...common,operation:'patreon-discovery'}).body.inputs.mode,'discover');
 assert.throws(()=>rolloutDispatch({...common,operation:'patreon-discovery',mode:'sync'}));
});

test('production browser verification accepts only fixed Daily measurement inputs',()=>{
 assert.equal(rolloutDispatch({...common,operation:'production-browser'}).workflow,'production-browser.yml');
 assert.deepEqual(rolloutDispatch({...common,operation:'production-browser',first_environment:'latest',measurement_mode:true}),{
   workflow:'production-browser.yml',body:{ref:'main',inputs:{first_environment:'latest',measurement_mode:'true'}},
 });
 for(const extra of [
   {origin:'https://example.com'},
   {ref:'unreviewed'},
   {first_environment:'other',measurement_mode:true},
   {first_environment:'mixed',measurement_mode:'true'},
   {first_environment:'mixed'},
 ])assert.throws(()=>rolloutDispatch({...common,operation:'production-browser',...extra}));
});

test('Daily generation dispatch is target-only and fixed to the reviewed workflow',()=>{
 const dev={...common,operation:'daily-generation',target:'development'};
 assert.deepEqual(rolloutDispatch(dev),{workflow:'daily-generation.yml',body:{ref:'main',inputs:{target:'development'}}});
 assert.equal(rolloutDispatch({...dev,target:'production'}).body.inputs.target,'production');
 for(const extra of [{target:'other'},{day:'2041-01-01'},{workflow:'other.yml'}])assert.throws(()=>rolloutDispatch({...dev,...extra}));
});

test('Patreon sync runs only the reviewed membership reconciliation workflow',()=>{
 const request={...common,operation:'patreon-sync'};
 assert.deepEqual(rolloutDispatch(request),{workflow:'patreon-reconcile.yml',body:{ref:'main',inputs:{mode:'sync'}}});
 for(const extra of [{campaign:'other'},{account:'other'},{ref:'branch'},{mode:'discover'}])assert.throws(()=>rolloutDispatch({...request,...extra}));
});
