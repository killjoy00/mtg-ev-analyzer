import test from 'node:test';
import assert from 'node:assert/strict';
import {seal,unseal} from '../scripts/launch-distributed-bundle.mjs';
import {gateway} from '../edge/gateway.mjs';

test('fixture bundles are authenticated and bound to the current workflow run',()=>{
  const key=process.env.NEON_API_KEY,run=process.env.GITHUB_RUN_ID;
  try {
    process.env.NEON_API_KEY='fixture-key';process.env.GITHUB_RUN_ID='123';
    const sealed=seal({token:'private-fixture'});
    assert.deepEqual(unseal(sealed),{token:'private-fixture'});
    assert.ok(!sealed.includes('private-fixture'));
    const tampered=Buffer.from(sealed,'base64');tampered[30]^=1;
    assert.throws(()=>unseal(tampered.toString('base64')));
    process.env.GITHUB_RUN_ID='124';assert.throws(()=>unseal(sealed));
  } finally {
    for(const [name,value] of [['NEON_API_KEY',key],['GITHUB_RUN_ID',run]])if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
});
test('real-network attestation is private-preview health only, never a production response',async()=>{
  for(const mode of ['preview','production']) {
    const env={MODE:mode,NEON_BRANCH_ID:mode==='preview'?'br-fixture-preview':'br-orange-feather-ayps8kep',QUOTA_KEY:'a'.repeat(64),
      ...(mode==='preview'?{PREVIEW_KEY:'b'.repeat(64),ORIGIN_SECRET:'c'.repeat(64)}:{}),
      NETWORK_QUOTA:{idFromName:x=>x,get:()=>({fetch:async()=>new Response(null,{status:204})})}};
    const url=(mode==='preview'?'https://api-preview.packone.pro':'https://api.packone.pro')+'/draft/health?quick=1';
    const r=await gateway(new Request(url,{headers:{'cf-connecting-ip':'192.0.2.12','x-pack1-preview-key':'b'.repeat(64)}}),env,async()=>Response.json({ok:true}));
    assert.equal(r.status,200);
    if(mode==='preview')assert.match(r.headers.get('x-pack1-preview-network'),/^[a-f0-9]{64}$/);
    else assert.equal(r.headers.get('x-pack1-preview-network'),null);
  }
});
