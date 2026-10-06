import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchCanaryHttp} from '../scripts/creator-canary-http.mjs';

for(const failure of [500,503,429,'network','timeout']){
  test(`canary GET ${failure} recovers with the same authenticated request`,async()=>{
    let reads=0;const pauses=[];
    const fetcher=async(url,options)=>{
      assert.equal(url,'https://example.invalid/status');
      assert.equal(options.headers.cookie,'owned-canary-session');
      if(++reads===1){
        if(failure==='network')throw new TypeError('fetch failed');
        if(failure==='timeout')throw new DOMException('read timeout','TimeoutError');
        return new Response('Temporary failure',{status:failure,headers:failure===429?{'retry-after':'2'}:{}});
      }
      return Response.json({state:'published'});
    };
    const result=await fetchCanaryHttp('https://example.invalid/status',{headers:{cookie:'owned-canary-session'}},
      {fetcher,sleep:async ms=>{pauses.push(ms);}});
    assert.deepEqual(await result.json(),{state:'published'});assert.equal(reads,2);
    assert.deepEqual(pauses,[failure===429?2000:1000]);
  });
}

test('persistent reads are bounded; permission failures remain visible',async()=>{
  for(const status of [503,403]){
    let reads=0;const pauses=[];
    const result=await fetchCanaryHttp('https://example.invalid/status',{},
      {fetcher:async()=>{reads++;return new Response('Failure',{status});},sleep:async ms=>{pauses.push(ms);}});
    assert.equal(result.status,status);assert.equal(await result.text(),'Failure');
    assert.equal(reads,status===503?3:1);assert.deepEqual(pauses,status===503?[1000,2000]:[]);
  }
});

test('canary mutations are attempted only once even on server or network failure',async()=>{
  for(const failure of [500,'network']){
    let writes=0;
    const operation=()=>fetchCanaryHttp('https://example.invalid/publish',{method:'POST',body:'owned-operation'},
      {fetcher:async(url,options)=>{writes++;assert.equal(options.body,'owned-operation');
        if(failure==='network')throw new TypeError('fetch failed');return new Response('Failure',{status:500});},
      sleep:async()=>{throw Error('Never retry mutations');}});
    if(failure==='network')await assert.rejects(operation(),/fetch failed/);
    else assert.equal((await operation()).status,500);
    assert.equal(writes,1);
  }
});

test('a caller cancellation stops reads before any transport attempt',async()=>{
  const controller=new AbortController();controller.abort(new Error('Caller cancelled'));let reads=0;
  await assert.rejects(fetchCanaryHttp('https://example.invalid/status',{signal:controller.signal},
    {fetcher:async()=>{reads++;}}),/Caller cancelled/);
  assert.equal(reads,0);
});
