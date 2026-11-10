import test from 'node:test';
import assert from 'node:assert/strict';

const SECRET='qa-test-secret-kept-off-network';
const SQL_URL='postgresql://qa:unused@ep-qa.us-east-2.aws.neon.tech/qa';

function mockNeon({existingSecret=true,failFirstRead=false}={}) {
  const calls=[];let storedSecret=existingSecret?SECRET:null, failed=false;
  const fetcher=async(url,options={})=>{
    assert.equal(String(url),'https://api.us-east-2.aws.neon.tech/sql','all database traffic must use the stub');
    assert.equal(options.method,'POST');
    const {query,params}=JSON.parse(options.body);
    calls.push({query,params});
    if(query.includes("SELECT value FROM settings WHERE key='player_secret'")) {
      if(failFirstRead&&!failed) {
        failed=true;
        return Response.json({error:'simulated timeout'},{status:503});
      }
      return Response.json({
        fields:[{name:'value'}],rows:storedSecret?[[storedSecret]]:[],rowCount:storedSecret?1:0,
      });
    }
    if(query.includes('INSERT INTO settings')) {
      assert.equal(storedSecret,null,'a warm worker must not reinsert existing signing keys');
      storedSecret=params[0];
      return Response.json({fields:[],rows:[],rowCount:1});
    }
    if(query.includes('INSERT INTO players')) {
      return Response.json({fields:[{name:'display_name'}],rows:[[params[1]]],rowCount:1});
    }
    assert.fail('Unexpected database query: '+query);
  };
  return {calls,fetcher};
}

async function withStubbedWorker({caseName,...dbOptions},fn) {
  const prior={
    fetch:globalThis.fetch,database:process.env.DATABASE_URL,
    required:process.env.PACK1_REQUIRE_INGRESS,secret:process.env.PACK1_INGRESS_SECRET,
  };
  const stub=mockNeon(dbOptions);
  try {
    globalThis.fetch=stub.fetcher;
    process.env.DATABASE_URL=SQL_URL;
    delete process.env.PACK1_REQUIRE_INGRESS;
    delete process.env.PACK1_INGRESS_SECRET;
    // An independent module instance gives each scenario a fresh signing-key
    // cache without exporting private production methods for tests.
    const {default:worker}=await import('../worker/index.js?legacy-behavior='+caseName);
    await fn(worker,stub.calls);
  } finally {
    globalThis.fetch=prior.fetch;
    for(const [name,value] of [
      ['DATABASE_URL',prior.database],
      ['PACK1_REQUIRE_INGRESS',prior.required],
      ['PACK1_INGRESS_SECRET',prior.secret],
    ])if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
}

const request=(path,method,token,body={displayName:'QA Player'})=>
  new Request('https://packone.pro'+path,{method,headers:{
    'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{}),
  },body:JSON.stringify(body)});
const sqlCount=(calls,fragment)=>calls.filter(call=>call.query.includes(fragment)).length;

test('real legacy HTTP session verifies HMAC, rejects tampering, and does not requery its signing secret',async()=>{
  await withStubbedWorker({caseName:'existing',existingSecret:true},async(worker,calls)=>{
    const created=await worker.fetch(request('/v1/session','POST'));
    assert.equal(created.status,200);
    const {token,playerId}=await created.json();
    assert.match(token,/^p1_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/);
    assert.equal(token.split('.')[0],'p1_'+playerId);
    assert.equal(sqlCount(calls,'SELECT value FROM settings'),1);
    assert.equal(sqlCount(calls,'INSERT INTO settings'),0);

    const updated=await worker.fetch(request('/v1/player','PATCH',token,{displayName:'Updated QA'}));
    assert.equal(updated.status,200);
    assert.deepEqual(await updated.json(),{ok:true,displayName:'Updated QA'});
    assert.equal(sqlCount(calls,'SELECT value FROM settings'),1,'cached HMAC key avoids another Neon lookup');

    const sig=token.split('.')[1],invalid=token.split('.')[0]+'.'+(sig[0]==='A'?'B':'A')+sig.slice(1);
    for(const bad of [invalid,'p1_'+playerId+'.short','random',undefined]) {
      const result=await worker.fetch(request('/v1/player','PATCH',bad));
      assert.equal(result.status,401,'tampered or absent tokens must not authorize writes');
      assert.match((await result.json()).error,/session required/i);
    }
    assert.equal(sqlCount(calls,'INSERT INTO players'),2,'only signed requests write the player row');
    assert.equal(sqlCount(calls,'SELECT value FROM settings'),1);
    assert.equal(calls.length,3,'no extra SQL after bad auth attempts');
  });
});

test('first-time legacy signing creates one secret and reuses it for additional sessions',async()=>{
  await withStubbedWorker({caseName:'new-secret',existingSecret:false},async(worker,calls)=>{
    const first=await worker.fetch(request('/v1/session','POST'));
    assert.equal(first.status,200);
    const firstBody=await first.json();
    const second=await worker.fetch(request('/v1/session','POST'));
    assert.equal(second.status,200);
    const secondBody=await second.json();
    assert.notEqual(firstBody.token,secondBody.token);
    assert.equal(sqlCount(calls,'INSERT INTO settings'),1);
    assert.equal(sqlCount(calls,'SELECT value FROM settings'),2,
      'cold creation reads, initializes and re-reads the saved secret only once');
    assert.equal(sqlCount(calls,'INSERT INTO players'),2);
    assert.equal(calls.length,5);
    assert.equal((await worker.fetch(request('/v1/player','PATCH',firstBody.token))).status,200);
    assert.equal(sqlCount(calls,'SELECT value FROM settings'),2);
  });
});

test('a temporary Neon failure is 500, then a later request reloads the key successfully',async()=>{
  await withStubbedWorker({caseName:'retry-read',existingSecret:true,failFirstRead:true},async(worker,calls)=>{
    const first=await worker.fetch(request('/v1/session','POST'));
    assert.equal(first.status,500);
    const second=await worker.fetch(request('/v1/session','POST'));
    assert.equal(second.status,200);
    assert.ok((await second.json()).token);
    assert.equal(sqlCount(calls,'SELECT value FROM settings'),2,
      'a rejected cache promise must be discarded and the key fetched again');
    assert.equal(sqlCount(calls,'INSERT INTO players'),1);
  });
});
