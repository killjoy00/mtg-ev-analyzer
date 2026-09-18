import test from 'node:test';
import assert from 'node:assert/strict';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {validateAudit,applyAudit} from '../scripts/load-source-exclusions.mjs';
const report=()=>({production_changed:false,blocked_sources:0,sets:Array.from({length:32},(_,i)=>({set:'set-'+i,corpus_version:DRAFT_RUN_CORPUS_VERSION,input_signature:'a'.repeat(64),source_archive:{sha256:'b'.repeat(64)},included_sources:3,approved_sources:3,approved_outcomes:{'7-0':1,'7-1':1,'7-2':1},blocked_sources:[],excluded_decisions:0}))});
test('audit loader requires all legal outcome counts and rejects incomplete/corrupt accounting',()=>{
 assert.equal(validateAudit(report()).sets.length,32);
 for(const change of [r=>r.sets.pop(),r=>r.production_changed=true,r=>r.sets[0].approved_outcomes={'7-3':3},r=>r.sets[0].approved_sources=2]){const r=report();change(r);assert.throws(()=>validateAudit(r));}
});
test('every source manifest is checked before any exclusion is inserted',async()=>{
 let writes=0;
 const query=async(sql)=>{if(!sql.startsWith('SELECT'))writes++;return {rows:[{manifest:{input_signature:'wrong'}}]};};
 await assert.rejects(()=>applyAudit(query,report(),'audit'),/manifest/);assert.equal(writes,0);
});
