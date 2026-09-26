import test from 'node:test';
import assert from 'node:assert/strict';
import {readinessFailure,changedReadinessSets,advanceServingReadiness} from '../worker/corpus-readiness.mjs';
import {readinessMessage,readinessMarkup} from '../admin/corpus-readiness.mjs';

test('transient failures retry, verification failures stop, and secrets are not persisted',()=>{
 for(const cause of [Object.assign(Error('private SQL connection'),{pgCode:'40001'}),Object.assign(Error('private upstream'),{status:503}),new DOMException('private timeout','TimeoutError')]) {
  const result=readinessFailure(cause);assert.equal(result.retryable,true);assert.doesNotMatch(JSON.stringify(result),/private/);
 }
 const failure=readinessFailure(Object.assign(Error('Current cache contains obsolete inventory'),{code:'ERR_ASSERTION'}));
 assert.equal(failure.retryable,false);assert.equal(failure.detail.code,'verification_failed');
 assert.match(failure.detail.message,/obsolete inventory/);
 assert.equal(readinessFailure(Error('postgres://secret@host')).retryable,false);
 assert.doesNotMatch(JSON.stringify(readinessFailure(Error('postgres://secret@host'))),/secret@host/);
});

test('active source, reactivation and component changes select their affected Live environments',()=>{
 const before={environments:[{set_id:'a',status:'Live',active_snapshot_id:'old'},{set_id:'b',status:'Paused',active_snapshot_id:'b'}],components:[{set_id:'a',status:'Paused'}]};
 const after={environments:[{set_id:'a',status:'Live',active_snapshot_id:'new'},{set_id:'b',status:'Live',active_snapshot_id:'b'}],components:[{set_id:'a',status:'Live'}]};
 assert.deepEqual(changedReadinessSets(after,before),['a','b']);
 assert.deepEqual(changedReadinessSets(before,before),[]);
 assert.deepEqual(changedReadinessSets(after,null),[]);
});

test('only a current verified boolean can produce the Ready label',()=>{
 for(const status of [{state:'warming'},{state:'verifying'},{state:'retry_wait'},{state:'failed'},{state:'ready',ready:true,current:false},{state:'ready',ready:'t',current:true}])
  assert.doesNotMatch(readinessMessage(status),/^Ready:/);
 assert.match(readinessMessage({state:'ready',ready:true,current:true,revision:'8'}),/^Ready: revision 8/);
 assert.match(readinessMessage({state:'failed'}),/do not repeat activation/);
});

test('actionable readiness errors are escaped and retries cannot target an obsolete operation',()=>{
 const html=readinessMarkup({state:'failed',ready:false,current:true,operation_id:'12',last_error:{code:'test',message:'<script>bad</script>'}});
 assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/data-readiness-retry="12"/);
 assert.doesNotMatch(readinessMarkup({state:'failed',current:false,operation_id:'12'}),/data-readiness-retry/);
});

test('an operation superseded before execution never invokes the builder',async()=>{
 const query=async()=>({rows:[{operation_id:'1',revision:'4',current_revision:'5',key_id:'1',state:'superseded',current:false,ready:false}]});
 const result=await advanceServingReadiness(query,{operationId:'1',build:()=>{throw Error('obsolete work must not build');}});
 assert.equal(result.state,'superseded');assert.equal(result.ready,false);
});

test('a held database lease returns warming without invoking a second builder',async()=>{
 const query=async sql=>sql.includes('pack1_claim_readiness')?{rows:[{job:null}]}:{rows:[{operation_id:'1',revision:'4',current_revision:'4',key_id:'1',state:'warming',current:true,ready:false}]};
 const result=await advanceServingReadiness(query,{build:()=>{throw Error('duplicate work must not build');}});
 assert.equal(result.state,'warming');assert.equal(result.ready,false);
});

test('the real executor persists a timeout result rather than claiming activation rollback',async()=>{
 let state='queued',stored;
 const query=async(sql,params)=>{
  if(sql.includes('pack1_claim_readiness'))return {rows:[{job:{id:'1',key_id:'1',revision:'4',lease_token:'token'}}]};
  if(sql.includes('pack1_fail_readiness')){state='retry_wait';stored=JSON.parse(params[3]);return {rows:[]};}
  return {rows:[{operation_id:'1',revision:'4',current_revision:'4',key_id:'1',state,current:true,ready:false,last_error:stored}]};
 };
 const result=await advanceServingReadiness(query,{build:async()=>{throw new DOMException('deadline','TimeoutError');}});
 assert.equal(result.state,'retry_wait');assert.equal(result.last_error.code,'transient_failure');assert.equal(result.ready,false);
});
