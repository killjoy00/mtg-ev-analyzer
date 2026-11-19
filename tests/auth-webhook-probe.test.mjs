import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyNeonWebhook} from '../edge/auth-webhook-probe.mjs';

const encoder=new TextEncoder();
function b64url(bytes) {
  const view=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  return Buffer.from(view).toString('base64url');
}

test('temporary Auth probe verifies the documented detached Ed25519 JWS over exact raw bytes',async()=>{
  const keys=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);
  jwk.kid='probe-kid';
  const raw=encoder.encode('{"event_type":"send.magic_link","event_data":{"token":"fixture"}}');
  const timestamp=String(Date.now());
  const protectedB64=b64url(encoder.encode(JSON.stringify({alg:'EdDSA',kid:jwk.kid})));
  const payloadB64=b64url(raw);
  const signedPayloadB64=b64url(encoder.encode(timestamp+'.'+payloadB64));
  const signingInput=encoder.encode(protectedB64+'.'+signedPayloadB64);
  const signature=b64url(new Uint8Array(await crypto.subtle.sign({name:'Ed25519'},keys.privateKey,signingInput)));
  const headers=new Headers({
    'x-neon-signature':protectedB64+'..'+signature,
    'x-neon-signature-kid':jwk.kid,
    'x-neon-timestamp':timestamp,
  });
  const fetcher=async()=>Response.json({keys:[jwk]});

  assert.equal(await verifyNeonWebhook(raw,headers,'https://auth.example',fetcher,Number(timestamp)),true);
  const changed=encoder.encode('{"event_type":"send.magic_link","event_data":{"token":"different"}}');
  assert.equal(await verifyNeonWebhook(changed,headers,'https://auth.example',fetcher,Number(timestamp)),false);
});

test('temporary Auth probe rejects stale timestamps and malformed detached signatures before trust',async()=>{
  const raw=encoder.encode('{}');
  const now=Date.now();
  const stale=new Headers({
    'x-neon-signature':'abc..def',
    'x-neon-signature-kid':'kid',
    'x-neon-timestamp':String(now-6*60*1000),
  });
  let fetched=false;
  assert.equal(await verifyNeonWebhook(raw,stale,'https://auth.example',async()=>{fetched=true;return Response.json({keys:[]});},now),false);
  assert.equal(fetched,false);

  const malformed=new Headers({
    'x-neon-signature':'abc.payload.def',
    'x-neon-signature-kid':'kid',
    'x-neon-timestamp':String(now),
  });
  assert.equal(await verifyNeonWebhook(raw,malformed,'https://auth.example',async()=>Response.json({keys:[]}),now),false);
});
