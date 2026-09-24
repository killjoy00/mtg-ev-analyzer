import test from 'node:test';
import assert from 'node:assert/strict';
import {gateway} from '../edge/gateway.mjs';

const token='p1_123e4567-e89b-12d3-a456-426614174000.'+'A'.repeat(43);
const env=()=>({
  MODE:'production',
  NEON_BRANCH_ID:'br-orange-feather-ayps8kep',
  QUOTA_KEY:'e'.repeat(64),
  NETWORK_QUOTA:{idFromName:name=>name,get:()=>({fetch:async()=>new Response(null,{status:204})})},
});
const headers=extra=>({'cf-connecting-ip':'192.0.2.44',...extra});

test('native guest bridge rejects malformed tokens before upstream',async()=>{
  const request=new Request('https://api.packone.pro/draft/v1/runs',{method:'POST',headers:headers({'content-type':'application/json','x-pack1-mobile-session':'bad'}),body:'{}'});
  const response=await gateway(request,env(),async()=>{throw Error('must not reach upstream')});
  assert.equal(response.status,401);
});

test('native guest bridge cannot reach account routes',async()=>{
  const request=new Request('https://api.packone.pro/growth/v1/account/session',{headers:headers({'x-pack1-mobile-session':token})});
  const response=await gateway(request,env(),async()=>{throw Error('must not reach upstream')});
  assert.equal(response.status,403);
});

test('native guest bridge maps signed player token only on Draft Run player routes',async()=>{
  let authorization=null;
  const request=new Request('https://api.packone.pro/draft/v1/runs',{method:'POST',headers:headers({'content-type':'application/json','x-pack1-mobile-session':token}),body:'{}'});
  const response=await gateway(request,env(),async(_url,options)=>{
    authorization=new Headers(options.headers).get('authorization');
    return Response.json({ok:true});
  });
  assert.equal(response.status,200);
  assert.equal(authorization,'Bearer '+token);
});
