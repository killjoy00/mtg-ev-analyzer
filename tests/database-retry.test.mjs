import test from 'node:test';
import assert from 'node:assert/strict';
import {retryRolledBackQuery} from '../worker/database-retry.mjs';

test('only confirmed transaction rollbacks retry, with a bounded delay',async()=>{
  let calls=0;const delays=[];
  const value=await retryRolledBackQuery(async()=>{
    if(++calls<3)throw Object.assign(Error('rolled back'),{pgCode:calls===1?'40001':'40P01'});
    return 'committed';
  },{sleep:async ms=>delays.push(ms)});
  assert.equal(value,'committed');assert.equal(calls,3);assert.deepEqual(delays,[25,50]);
});

test('ambiguous transport failures, isolation rejection, and constraints never retry',async()=>{
  for(const pgCode of [null,'25001','23505']) {
    let calls=0;const error=Object.assign(Error('failed'),{pgCode});
    await assert.rejects(retryRolledBackQuery(async()=>{calls++;throw error;}),actual=>actual===error);
    assert.equal(calls,1);
  }
});

test('persistent rollback contention stops after five attempts',async()=>{
  let calls=0;const error=Object.assign(Error('contended'),{pgCode:'40001'});
  await assert.rejects(retryRolledBackQuery(async()=>{calls++;throw error;},{sleep:async()=>{}}),actual=>actual===error);
  assert.equal(calls,5);
});

test('the Neon query boundary retries the same SQL and parameters after rollback',async()=>{
  process.env.DATABASE_URL='postgresql://fixture:fixture@ep-fixture.neon.tech/fixture';
  const {query}=await import('../worker/growth-function.js');
  const originalFetch=globalThis.fetch,calls=[];
  globalThis.fetch=async(_url,options)=>{
    calls.push(JSON.parse(options.body));
    return calls.length===1
      ? Response.json({code:'40001',message:'rolled back'},{status:409})
      : Response.json({fields:[{name:'n'}],rows:[['1']],rowCount:1});
  };
  try {
    assert.deepEqual(await query('SELECT $1::int n',[1]),{rows:[{n:'1'}],rowCount:1});
    assert.deepEqual(calls,[{query:'SELECT $1::int n',params:['1']},{query:'SELECT $1::int n',params:['1']}]);
  } finally {globalThis.fetch=originalFetch;}
});
