import test from 'node:test';
import assert from 'node:assert/strict';
import {authWebhook} from '../edge/auth-webhook.mjs';

const encoder=new TextEncoder();
function b64url(value) {
  return Buffer.from(value instanceof Uint8Array?value:new Uint8Array(value)).toString('base64url');
}
async function fixture({linkType='verify-email'}={}) {
  const timestamp=Date.now();
  const kid='rejected-event-kid';
  const keys=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid=kid;
  const payload={
    event_id:'evt_rejected_12345678',
    event_type:'send.magic_link',
    user:{email:'person@example.com'},
    event_data:{link_type:linkType,token:'never-log-this-token',expires_at:new Date(timestamp+3600000).toISOString()},
  };
  const raw=encoder.encode(JSON.stringify(payload));
  const protectedB64=b64url(encoder.encode(JSON.stringify({alg:'EdDSA',kid})));
  const payloadB64=b64url(raw);
  const signedPayloadB64=b64url(encoder.encode(String(timestamp)+'.'+payloadB64));
  const signingInput=encoder.encode(protectedB64+'.'+signedPayloadB64);
  const signature=b64url(new Uint8Array(await crypto.subtle.sign({name:'Ed25519'},keys.privateKey,signingInput)));
  return {jwk,raw,headers:new Headers({
    'content-type':'application/json',
    'x-neon-signature':protectedB64+'..'+signature,
    'x-neon-signature-kid':kid,
    'x-neon-timestamp':String(timestamp),
    'x-neon-event-type':'send.magic_link',
    'x-neon-event-id':'evt_rejected_12345678',
    'x-neon-delivery-attempt':'1',
  })};
}

test('verified unsupported link types emit bounded rejected_event log and QA telemetry without credentials',async()=>{
  const value=await fixture();
  const originalFetch=globalThis.fetch;
  const originalLog=console.log;
  const logs=[];const telemetry=[];
  globalThis.fetch=async url=>{
    if(String(url)==='https://auth.rejected.example/.well-known/jwks.json')return Response.json({keys:[value.jwk]});
    throw Error('unexpected network call');
  };
  console.log=line=>logs.push(String(line));
  const env={
    PACK1_AUTH_ENV:'qa',
    AUTH_BASE:'https://auth.rejected.example',
    RECOVERY_DEDUPE:{
      idFromName:value=>value,
      get:id=>({fetch:async(_url,init)=>{
        assert.equal(id,'__qa_telemetry__');
        telemetry.push(JSON.parse(init.body));
        return Response.json({ok:true});
      }}),
    },
  };
  try {
    const response=await authWebhook(new Request('https://hook.example/webhook',{method:'POST',headers:value.headers,body:value.raw}),env);
    assert.equal(response.status,400);
    assert.equal(logs.length,1);
    const logged=JSON.parse(logs[0]);
    assert.equal(logged.status,'rejected_event');
    assert.equal(logged.event_type,'send.magic_link');
    assert.equal(logged.link_type,'verify-email');
    assert.equal(telemetry.length,1);
    assert.equal(telemetry[0].status,'rejected_event');
    assert.equal(telemetry[0].event_type,'send.magic_link');
    assert.equal(telemetry[0].link_type,'verify-email');
    for(const record of [logged,telemetry[0]]) {
      assert.equal('token' in record,false);
      assert.equal('email' in record,false);
    }
  } finally {
    globalThis.fetch=originalFetch;
    console.log=originalLog;
  }
});

test('rejected event metadata is bounded before logging',async()=>{
  const value=await fixture({linkType:'x'.repeat(65)});
  const originalFetch=globalThis.fetch;
  const originalLog=console.log;
  const logs=[];
  globalThis.fetch=async()=>Response.json({keys:[value.jwk]});
  console.log=line=>logs.push(String(line));
  try {
    const response=await authWebhook(new Request('https://hook.example/webhook',{method:'POST',headers:value.headers,body:value.raw}),{
      PACK1_AUTH_ENV:'production',AUTH_BASE:'https://auth.rejected-bounded.example',RECOVERY_DEDUPE:{},
    });
    assert.equal(response.status,400);
    const logged=JSON.parse(logs[0]);
    assert.equal(logged.link_type,null);
  } finally {
    globalThis.fetch=originalFetch;
    console.log=originalLog;
  }
});
