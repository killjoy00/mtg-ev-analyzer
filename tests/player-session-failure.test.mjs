import test from 'node:test';
import assert from 'node:assert/strict';

function browser() {
  const values=new Map();
  globalThis.localStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
  globalThis.document={cookie:''};
  globalThis.window={PACK1_API:{firstParty:true,growthUrl:'https://fixture.invalid/growth',draftRunUrl:'https://fixture.invalid/draft'}};
}

for(const failure of [503,520,'transport'])test(`background callers do not repeat session creation after ${failure}`,async()=>{
  browser();let creations=0,otherCalls=0;
  const original=globalThis.fetch;
  globalThis.fetch=async url=>{
    if(new URL(url).pathname==='/growth/v1/player/session') {
      creations++;
      if(creations===1) {
        if(failure==='transport')throw new TypeError('Synthetic lost response');
        return new Response('Synthetic unavailable response',{status:failure});
      }
      return Response.json({ok:true,playerId:'fixture'},{status:201});
    }
    otherCalls++;return Response.json({ok:true});
  };
  try {
    const api=await import(`../growth-api.mjs?session-failure=${failure}`);
    assert.equal(await api.sendEvents([{name:'page_view',props:{}}]),null);
    assert.equal(await api.loadRemoteStats(),null);
    for(let n=0;n<3;n++)assert.equal(await api.saveGameResult({fixture:n}),null);
    await assert.rejects(api.ensurePackSession());
    assert.equal(creations,1,'a lost response may hide a committed creation');
    assert.equal(otherCalls,0,'dependent calls stop at the unresolved identity');

    // The existing explicit Try again action reloads the page. A fresh module
    // has a new page-scoped promise and can establish a session normally.
    const reloaded=await import(`../growth-api.mjs?session-reload=${failure}`);
    assert.equal((await reloaded.ensurePackSession()).ok,true);
    assert.equal(creations,2);
  } finally {globalThis.fetch=original;}
});

test('concurrent first-party session callers still share one creation',async()=>{
  browser();let creations=0,resolve;
  const original=globalThis.fetch;
  globalThis.fetch=()=>{creations++;return new Promise(done=>{resolve=done;});};
  try {
    const api=await import('../growth-api.mjs?session-coalescing');
    const first=api.ensurePackSession(),second=api.ensurePackSession();
    await new Promise(done=>setImmediate(done));
    assert.equal(creations,1);
    resolve(Response.json({ok:true,playerId:'fixture'},{status:201}));
    assert.deepEqual(await first,await second);
    assert.equal(creations,1);
  } finally {globalThis.fetch=original;}
});
