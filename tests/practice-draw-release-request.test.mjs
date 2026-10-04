import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRequest,verifyAcceptance} from '../scripts/practice-draw-release-request.mjs';
const request={target:'development',source_sha:'a'.repeat(40),performance_run_id:101,load_run_id:102,request_id:'exact-pick-889-development'};
function fixture(overrides={}) {
 return async path=>{
  if(path==='/actions/runs/101')return{head_sha:request.source_sha,path:'.github/workflows/practice-performance.yml',status:'completed',conclusion:'success',...overrides.performance};
  if(path==='/actions/runs/102')return{head_sha:request.source_sha,path:'.github/workflows/launch-distributed.yml',status:'completed',conclusion:'success',...overrides.load};
  if(path.startsWith('/commits/'))return{check_runs:overrides.checks||['test','browser','backend-gate'].map(name=>({head_sha:request.source_sha,name,status:'completed',conclusion:'success',app:{slug:'github-actions'}}))};
  throw Error('Unexpected read');
 };
}
test('both fixed targets require exact validated request fields',()=>{
 for(const target of ['development','production'])assert.equal(validateRequest({...request,target}).target,target);
 for(const change of [{target:'default'},{source_sha:'main'},{source_sha:'a'.repeat(39)},{load_run_id:0},{performance_run_id:'101'},{request_id:'arbitrary'},{connection:'postgres://example'},{workflow:'other.yml'}])
  assert.throws(()=>validateRequest({...request,...change}));
});
test('promotion accepts successful matching performance, load and CI evidence',async()=>{await verifyAcceptance(request,fixture());});
test('failed or unfinished load cannot authorize schema promotion',async()=>{
 for(const change of [{conclusion:'failure'},{status:'in_progress'},{head_sha:'b'.repeat(40)},{path:'.github/workflows/production-browser.yml'}])
  await assert.rejects(verifyAcceptance(request,fixture({load:change})));
});
test('performance evidence must use the same accepted source',async()=>{await assert.rejects(verifyAcceptance(request,fixture({performance:{head_sha:'b'.repeat(40)}})));});
test('missing, failed or foreign CI cannot authorize schema writes',async()=>{
 const valid=['test','browser','backend-gate'].map(name=>({head_sha:request.source_sha,name,status:'completed',conclusion:'success',app:{slug:'github-actions'}}));
 for(const checks of [valid.slice(0,2),valid.map(c=>c.name==='backend-gate'?{...c,conclusion:'failure'}:c),valid.map(c=>({...c,app:{slug:'other'}}))])
  await assert.rejects(verifyAcceptance(request,fixture({checks})));
});
