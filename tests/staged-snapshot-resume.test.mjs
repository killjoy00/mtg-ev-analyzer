import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyStagedSnapshot} from '../scripts/verify-staged-snapshot.mjs';

const set={id:'blb',source_snapshot_id:'a'.repeat(64),total_puzzles:251,source_trophies:1001};
const puzzles=Array.from({length:251},(_,i)=>({puzzle_id:String(i)}));
const ledger=Array.from({length:1001},(_,i)=>({source_draft_hash:String(i)}));
function database({badPuzzle=false,badLedger=false,extra=false,active=false}={}) {
  const calls=[];
  const query=async(sql,params)=>{
    calls.push(sql);
    assert.ok(sql.startsWith('SELECT'));
    assert.match(sql,/lifecycle_status='Candidate'/);
    assert.match(sql,/NOT EXISTS\(SELECT 1 FROM draft_run_environment_policy/);
    assert.equal(params[0],set.source_snapshot_id);
    if(params.length===1)return {rows:active?[]:[{puzzles:251+Number(extra),ledger:1001}]};
    const batch=JSON.parse(params[1]);
    const mismatch=sql.includes('jsonb_array_elements')?badPuzzle:badLedger;
    return {rows:[{matched:active?0:batch.length-Number(mismatch)}]};
  };
  return {query,calls};
}
test('stage retry verifies every payload and ledger page without reopening or writing',async()=>{
  const db=database();
  assert.deepEqual(await verifyStagedSnapshot(db.query,set,puzzles,ledger),{puzzles:251,ledger:1001});
  assert.equal(db.calls.length,5);
});
test('missing or changed Candidate payload and ledger rows fail closed',async()=>{
  for(const options of [{badPuzzle:true},{badLedger:true}])await assert.rejects(verifyStagedSnapshot(database(options).query,set,puzzles,ledger),/verification failed/);
});
test('extra stored rows and concurrently activated Candidates cannot pass resume',async()=>{
  for(const options of [{extra:true},{active:true}])await assert.rejects(verifyStagedSnapshot(database(options).query,set,puzzles,ledger),/verification failed|counts differ/);
});
