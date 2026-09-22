import test from 'node:test';
import assert from 'node:assert/strict';
import {FROZEN_PREMIER_AUDIT_CORPUS_VERSION,validateAudit,applyAudit} from '../scripts/load-source-exclusions.mjs';

const blockedHash='c'.repeat(32);
const report=(withBlocked=false)=>{
 const sets=Array.from({length:32},(_,i)=>({
  set:'set-'+i,
  corpus_version:FROZEN_PREMIER_AUDIT_CORPUS_VERSION,
  input_signature:'a'.repeat(64),
  source_archive:{sha256:'b'.repeat(64)},
  included_sources:3,
  approved_sources:3,
  approved_outcomes:{'7-0':1,'7-1':1,'7-2':1},
  blocked_sources:[],
  excluded_decisions:0,
 }));
 if(withBlocked)Object.assign(sets[0],{
  included_sources:4,
  blocked_sources:[{source_draft_hash:blockedHash,reason:'invalid_premier_trophy_outcome',puzzles:8,wins:7,losses:3}],
  excluded_decisions:8,
 });
 return {production_changed:false,blocked_sources:withBlocked?1:0,sets};
};

test('audit loader requires the complete frozen v7 accounting and rejects transfer to a later corpus',()=>{
 assert.equal(validateAudit(report()).sets.length,32);
 for(const change of [
  r=>r.sets.pop(),
  r=>r.production_changed=true,
  r=>r.sets[0].approved_outcomes={'7-3':3},
  r=>r.sets[0].approved_sources=2,
  r=>r.sets[0].corpus_version='elite-trophy-colour-stage-v8',
 ]) {
  const r=report();change(r);assert.throws(()=>validateAudit(r));
 }
});

test('every source manifest is checked before any exclusion is inserted',async()=>{
 let writes=0;
 const query=async(sql)=>{if(!sql.startsWith('SELECT'))writes++;return {rows:[{manifest:{input_signature:'wrong'}}]};};
 await assert.rejects(()=>applyAudit(query,report(),'audit'),/manifest/);assert.equal(writes,0);
});

test('audit preflight and exclusions stay pinned to the audited v7 corpus',async()=>{
 const r=report(true),calls=[];
 const bySet=new Map(r.sets.map(s=>[s.set,s]));
 const query=async(sql,args=[])=>{
  calls.push({sql,args});
  if(sql.includes('FROM corpus_set_versions')) {
   const s=bySet.get(args[0]);
   return {rows:[{manifest:{input_signature:s.input_signature,source_archive:{sha256:s.source_archive.sha256},included_trophies:s.included_sources}}]};
  }
  if(sql.includes('FROM draft_run_verified_puzzles'))return {rows:[{source_draft_hash:blockedHash,n:8}]};
  if(sql.startsWith('INSERT INTO corpus_source_exclusions'))return {rows:[]};
  throw Error('Unexpected SQL');
 };
 const result=await applyAudit(query,r,'audit-hash');
 assert.equal(result.excluded_sources,1);
 assert.ok(calls.length>32);
 assert.ok(calls.every(({args})=>args[1]===FROZEN_PREMIER_AUDIT_CORPUS_VERSION));
});
