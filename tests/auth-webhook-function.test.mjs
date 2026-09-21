import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as signBytes} from 'node:crypto';
import {
  clearAuthWebhookKeyCache,
  handleAuthWebhook,
  recoveryEmail,
} from '../worker/auth-webhook-function.mjs';

const encoder=new TextEncoder();
const AUTH_BASE='https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth';
const ENV={
  PACK1_AUTH_ENV:'qa',
  PACK1_ALLOW_LOCALHOST:'1',
  PACK1_RESEND_API_KEY:'re_'+'x'.repeat(40),
};
const EVENT_ID='550e8400-e29b-41d4-a716-446655440000';
const TOKEN='fixture-reset-token-1234';

function fixture({eventId=EVENT_ID,token=TOKEN,eventType='send.magic_link',linkType='forget-password'}={}) {
  return {
    event_id:eventId,
    event_type:eventType,
    timestamp:'2026-09-21T19:56:19.250Z',
    context:{endpoint_id:'ep-fixture',project_name:'Pack One QA'},
    user:{
      id:'11111111-1111-4111-8111-111111111111',
      name:'QA',
      email:'qa@example.com',
      image:null,
      role:'user',
      banned:false,
      email_verified:true,
      created_at:'2026-09-21T19:00:00.000Z',
      updated_at:'2026-09-21T19:00:00.000Z',
      ban_reason:null,
      ban_expires:null,
    },
    event_data:{
      link_type:linkType,
      link_url:AUTH_BASE+'/callback?token=should-not-be-used',
      token,
      expires_at:'2026-09-21T20:56:19.250Z',
      ip_address:'192.0.2.1',
      user_agent:'qa',
    },
  };
}
function signer() {
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const jwk=publicKey.export({format:'jwk'});
  jwk.kid='qa-signing-key';
  return {jwk,privateKey};
}
function signedRequest(payload,{jwk,privateKey},now=Date.parse('2026-09-21T19:56:19.300Z'),rawOverride) {
  const raw=rawOverride??JSON.stringify(payload);
  const timestamp=String(now);
  const protectedB64=Buffer.from(JSON.stringify({alg:'EdDSA',typ:'JWS',kid:jwk.kid})).toString('base64url');
  const payloadB64=Buffer.from(raw).toString('base64url');
  const signaturePayloadB64=Buffer.from(timestamp+'.'+payloadB64).toString('base64url');
  const signingInput=Buffer.from(protectedB64+'.'+signaturePayloadB64);
  const signature=signBytes(null,signingInput,privateKey).toString('base64url');
  return new Request('https://example.test/webhook',{
    method:'POST',
    headers:{
      'content-type':'application/json',
      'x-neon-signature':protectedB64+'..'+signature,
      'x-neon-signature-kid':jwk.kid,
      'x-neon-timestamp':timestamp,
      'x-neon-event-type':payload.event_type,
      'x-neon-event-id':payload.event_id,
      'x-neon-delivery-attempt':'1',
    },
    body:raw,
  });
}

test('signed recovery webhook sends a Pack One fragment link with stable Resend idempotency',async()=>{
  clearAuthWebhookKeyCache();
  const keys=signer(),calls=[];
  const fetcher=async(url,options={})=>{
    calls.push({url,options});
    if(String(url).endsWith('/.well-known/jwks.json'))return Response.json({keys:[keys.jwk]});
    if(url==='https://api.resend.com/emails')return Response.json({id:'email-fixture'});
    throw Error('Unexpected fetch '+url);
  };
  const now=Date.parse('2026-09-21T19:56:19.300Z');
  const response=await handleAuthWebhook(signedRequest(fixture(),keys,now),ENV,{fetcher,now});
  assert.equal(response.status,204);

  const mail=calls.find(row=>row.url==='https://api.resend.com/emails');
  assert.ok(mail);
  assert.equal(mail.options.headers['idempotency-key'],'neon-auth/send.magic_link/'+EVENT_ID);
  const body=JSON.parse(mail.options.body);
  assert.equal(body.from,'Pack One <accounts@packone.pro>');
  assert.deepEqual(body.to,['qa@example.com']);
  assert.equal(body.subject,'Reset Your Password - Pack One QA');
  assert.match(body.text,/http:\/\/localhost:4173\/reset-password\/#token=fixture-reset-token-1234/);
  assert.doesNotMatch(body.text,/neon\.tech/i);
  assert.doesNotMatch(body.html,/neon\.tech/i);
  assert.equal(calls.filter(row=>String(row.url).endsWith('/.well-known/jwks.json')).length,1);

  const secondId='550e8400-e29b-41d4-a716-446655440001';
  const second=await handleAuthWebhook(signedRequest(fixture({eventId:secondId,token:'another-reset-token-1'}),keys,now),ENV,{fetcher,now});
  assert.equal(second.status,204);
  assert.equal(calls.filter(row=>String(row.url).endsWith('/.well-known/jwks.json')).length,1,'warm requests reuse the signing key');
});

test('verification covers the exact raw bytes and rejects altered content before email delivery',async()=>{
  clearAuthWebhookKeyCache();
  const keys=signer(),calls=[];
  const fetcher=async(url,options={})=>{
    calls.push({url,options});
    if(String(url).endsWith('/.well-known/jwks.json'))return Response.json({keys:[keys.jwk]});
    if(url==='https://api.resend.com/emails')return Response.json({id:'unexpected'});
    throw Error('Unexpected fetch');
  };
  const now=Date.parse('2026-09-21T19:56:19.300Z');
  const payload=fixture(),raw=JSON.stringify(payload,null,2);
  const good=signedRequest(payload,keys,now,raw);
  assert.equal((await handleAuthWebhook(good,ENV,{fetcher,now})).status,204);

  calls.length=0;
  const signed=signedRequest(payload,keys,now,raw);
  const changed=new Request(signed.url,{
    method:'POST',
    headers:signed.headers,
    body:raw.replace('"QA"','"QB"'),
  });
  assert.equal((await handleAuthWebhook(changed,ENV,{fetcher,now})).status,401);
  assert.equal(calls.filter(row=>row.url==='https://api.resend.com/emails').length,0);
});

test('valid signatures still reject non-recovery events and mismatched event identity',async()=>{
  clearAuthWebhookKeyCache();
  const keys=signer(),now=Date.parse('2026-09-21T19:56:19.300Z');
  let sent=0;
  const fetcher=async url=>{
    if(String(url).endsWith('/.well-known/jwks.json'))return Response.json({keys:[keys.jwk]});
    if(url==='https://api.resend.com/emails'){sent++;return Response.json({id:'unexpected'});}
    throw Error('Unexpected fetch');
  };
  const otp=fixture({eventType:'send.otp',linkType:'otp'});
  assert.equal((await handleAuthWebhook(signedRequest(otp,keys,now),ENV,{fetcher,now})).status,400);

  const payload=fixture();
  const request=signedRequest(payload,keys,now);
  request.headers.set('x-neon-event-id','550e8400-e29b-41d4-a716-446655440099');
  assert.equal((await handleAuthWebhook(request,ENV,{fetcher,now})).status,400);
  assert.equal(sent,0);
});

test('duplicate deliveries reuse the same Resend idempotency key',async()=>{
  clearAuthWebhookKeyCache();
  const keys=signer(),now=Date.parse('2026-09-21T19:56:19.300Z'),mail=[];
  const fetcher=async(url,options={})=>{
    if(String(url).endsWith('/.well-known/jwks.json'))return Response.json({keys:[keys.jwk]});
    if(url==='https://api.resend.com/emails'){mail.push(options.headers['idempotency-key']);return Response.json({id:'same-email'});}
    throw Error('Unexpected fetch');
  };
  for(let i=0;i<2;i++)assert.equal((await handleAuthWebhook(signedRequest(fixture(),keys,now),ENV,{fetcher,now})).status,204);
  assert.deepEqual(mail,['neon-auth/send.magic_link/'+EVENT_ID,'neon-auth/send.magic_link/'+EVENT_ID]);
});

test('production recovery template contains only the Pack One fragment reset destination',()=>{
  const message=recoveryEmail({
    mode:'production',
    email:'person@example.com',
    token:TOKEN,
    expiresAt:'2026-09-21T20:56:19.250Z',
    resetDestination:'https://packone.pro/reset-password/',
  });
  assert.equal(message.subject,'Reset Your Password - Pack One');
  assert.match(message.url,/^https:\/\/packone\.pro\/reset-password\/#token=/);
  assert.doesNotMatch(message.html,/neon\.tech/i);
  assert.doesNotMatch(message.text,/neon\.tech/i);
});
