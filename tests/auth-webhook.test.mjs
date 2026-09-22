import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authWebhook,
  renderRecoveryEmail,
  renderVerificationEmail,
  sendRecoveryEmail,
  sendVerificationEmail,
  RecoveryEventDedupe,
  validateRecoveryEvent,
  validateVerificationEvent,
  verifyNeonWebhook,
} from '../edge/auth-webhook.mjs';

const encoder=new TextEncoder();

function b64url(value) {
  return Buffer.from(value instanceof Uint8Array?value:new Uint8Array(value)).toString('base64url');
}
async function signedFixture({
  eventId='evt_test_12345678',
  eventType='send.magic_link',
  linkType='forget-password',
  token='fixture-token-1234567890',
  email='person@example.com',
  linkUrl=null,
  timestamp=Date.now(),
  kid='test-kid',
}={}) {
  const keys=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);
  jwk.kid=kid;
  const payload={
    event_id:eventId,
    event_type:eventType,
    timestamp:new Date(timestamp).toISOString(),
    context:{endpoint_id:'fixture',project_name:'Pack One QA'},
    user:{id:'u1',name:'Fixture',email,image:null,role:'user',banned:false,email_verified:true,created_at:new Date(timestamp).toISOString(),updated_at:new Date(timestamp).toISOString(),ban_reason:null,ban_expires:null},
    event_data:{link_type:linkType,link_url:linkUrl||('https://vendor.invalid/reset/'+token),token,expires_at:new Date(timestamp+60*60*1000).toISOString(),ip_address:'127.0.0.1',user_agent:'test'},
  };
  const raw=encoder.encode(JSON.stringify(payload));
  const protectedB64=b64url(encoder.encode(JSON.stringify({alg:'EdDSA',kid})));
  const payloadB64=b64url(raw);
  const signedPayloadB64=b64url(encoder.encode(String(timestamp)+'.'+payloadB64));
  const signingInput=encoder.encode(protectedB64+'.'+signedPayloadB64);
  const signature=b64url(new Uint8Array(await crypto.subtle.sign({name:'Ed25519'},keys.privateKey,signingInput)));
  const headers=new Headers({
    'content-type':'application/json',
    'x-neon-signature':protectedB64+'..'+signature,
    'x-neon-signature-kid':kid,
    'x-neon-timestamp':String(timestamp),
    'x-neon-event-type':eventType,
    'x-neon-event-id':eventId,
    'x-neon-delivery-attempt':'1',
  });
  return {jwk,payload,raw,headers,timestamp};
}

test('production Auth webhook verifies the exact raw request bytes and rejects changed bytes',async()=>{
  const fixture=await signedFixture({kid:'raw-byte-kid'});
  const fetcher=async()=>Response.json({keys:[fixture.jwk]});
  assert.equal(await verifyNeonWebhook(fixture.raw,fixture.headers,'https://auth.raw.example',fetcher,fixture.timestamp),true);
  const changed=encoder.encode(JSON.stringify({...fixture.payload,event_data:{...fixture.payload.event_data,token:'changed-token'}}));
  assert.equal(await verifyNeonWebhook(changed,fixture.headers,'https://auth.raw.example',fetcher,fixture.timestamp),false);
});

test('production Auth webhook rejects protected-header algorithm or kid mismatches',async()=>{
  const fixture=await signedFixture({kid:'protected-kid'});
  const fetcher=async()=>Response.json({keys:[fixture.jwk]});

  const [protectedB64,,signatureB64]=fixture.headers.get('x-neon-signature').split('.');
  const wrongAlg=b64url(encoder.encode(JSON.stringify({alg:'HS256',kid:'protected-kid'})));
  const algHeaders=new Headers(fixture.headers);
  algHeaders.set('x-neon-signature',wrongAlg+'..'+signatureB64);
  assert.equal(await verifyNeonWebhook(fixture.raw,algHeaders,'https://auth.protected.example',fetcher,fixture.timestamp),false);

  const wrongKid=b64url(encoder.encode(JSON.stringify({alg:'EdDSA',kid:'other-kid'})));
  const kidHeaders=new Headers(fixture.headers);
  kidHeaders.set('x-neon-signature',wrongKid+'..'+signatureB64);
  assert.equal(await verifyNeonWebhook(fixture.raw,kidHeaders,'https://auth.protected.example',fetcher,fixture.timestamp),false);

  assert.ok(protectedB64);
});

test('production Auth webhook rejects stale timestamps, malformed detached JWS and wrong key ids',async()=>{
  const now=Date.now();
  const stale=await signedFixture({timestamp:now-6*60*1000,kid:'stale-kid'});
  let fetched=false;
  assert.equal(await verifyNeonWebhook(stale.raw,stale.headers,'https://auth.stale.example',async()=>{fetched=true;return Response.json({keys:[stale.jwk]});},now),false);
  assert.equal(fetched,false);

  const malformed=new Headers(stale.headers);
  malformed.set('x-neon-timestamp',String(now));
  malformed.set('x-neon-signature','abc.payload.def');
  assert.equal(await verifyNeonWebhook(stale.raw,malformed,'https://auth.malformed.example',async()=>Response.json({keys:[stale.jwk]}),now),false);

  const fresh=await signedFixture({timestamp:now,kid:'expected-kid'});
  const wrong={...fresh.jwk,kid:'different-kid'};
  assert.equal(await verifyNeonWebhook(fresh.raw,fresh.headers,'https://auth.wrong-kid.example',async()=>Response.json({keys:[wrong]}),now),false);
});

test('recovery event validation accepts only the proven send.magic_link forget-password shape',async()=>{
  const fixture=await signedFixture();
  assert.deepEqual(validateRecoveryEvent(fixture.payload,fixture.headers),{
    eventId:'evt_test_12345678',
    email:'person@example.com',
    token:'fixture-token-1234567890',
    expiresAt:fixture.payload.event_data.expires_at,
    eventType:'send.magic_link',
    linkType:'forget-password',
  });
  assert.equal(validateRecoveryEvent({...fixture.payload,event_type:'send.otp'},fixture.headers),null);
  assert.equal(validateRecoveryEvent({...fixture.payload,event_data:{...fixture.payload.event_data,link_type:'email-verification'}},fixture.headers),null);
  const mismatched=new Headers(fixture.headers);
  mismatched.set('x-neon-event-id','evt_other_12345678');
  assert.equal(validateRecoveryEvent(fixture.payload,mismatched),null);
});

test('verification event validation accepts only the measured send.magic_link email-verification shape on the configured Auth origin',async()=>{
  const authBase='https://auth.verify.example/pack1/auth';
  const linkUrl=authBase+'/verify-email?token=fixture-token-1234567890&callbackURL=https%3A%2F%2Fpackone.pro%2F';
  const fixture=await signedFixture({linkType:'email-verification',linkUrl});
  assert.deepEqual(validateVerificationEvent(fixture.payload,fixture.headers,authBase),{
    eventId:'evt_test_12345678',
    email:'person@example.com',
    linkUrl,
    expiresAt:fixture.payload.event_data.expires_at,
    eventType:'send.magic_link',
    linkType:'email-verification',
  });

  assert.equal(validateRecoveryEvent(fixture.payload,fixture.headers),null);
  assert.equal(validateVerificationEvent({...fixture.payload,event_data:{...fixture.payload.event_data,link_type:'forget-password'}},fixture.headers,authBase),null);
  assert.equal(validateVerificationEvent({...fixture.payload,event_data:{...fixture.payload.event_data,link_url:'https://evil.example/verify?token=stolen'}},fixture.headers,authBase),null);
  assert.equal(validateVerificationEvent({...fixture.payload,event_data:{...fixture.payload.event_data,link_url:'http://auth.verify.example/pack1/auth/verify-email?token=x'}},fixture.headers,authBase),null);
  assert.equal(validateVerificationEvent({...fixture.payload,event_data:{...fixture.payload.event_data,link_url:'https://auth.verify.example/other/verify-email?token=x'}},fixture.headers,authBase),null);
});

test('Pack One recovery template uses only a fragment reset URL and contains no visible vendor host',()=>{
  const token='fixture-token-1234567890';
  const rendered=renderRecoveryEmail({
    resetOrigin:'https://packone.pro',
    token,
    expiresAt:'2026-09-21T21:00:00.000Z',
  });
  assert.equal(rendered.url,'https://packone.pro/reset-password/#token='+token);
  assert.match(rendered.html,/bgcolor="#171918"/);
  assert.match(rendered.html,/>P<sup[^>]*>1<\/sup><\/td>/);
  assert.match(rendered.html,/padding-left:11px[^>]*>Pack One<\/td>/);
  assert.doesNotMatch(rendered.html,/<img\b/i);
  for(const body of [rendered.text,rendered.html]) {
    assert.match(body,/Pack One/);
    assert.match(body,/https:\/\/packone\.pro\/reset-password\/#token=/);
    assert.doesNotMatch(body,/neon\.tech/i);
    assert.doesNotMatch(body,/Neon Auth/i);
    assert.doesNotMatch(body,/\?token=/);
  }
});

test('Pack One verification template uses the exact validated Neon link with Pack One branding',()=>{
  const linkUrl='https://auth.verify.example/pack1/auth/verify-email?token=fixture-token-1234567890';
  const rendered=renderVerificationEmail({
    linkUrl,
    expiresAt:'2026-09-22T21:00:00.000Z',
  });
  assert.equal(rendered.url,linkUrl);
  assert.match(rendered.html,/bgcolor="#171918"/);
  assert.match(rendered.html,/>P<sup[^>]*>1<\/sup><\/td>/);
  assert.match(rendered.html,/Verify your email/i);
  assert.match(rendered.html,/Verify email/);
  assert.doesNotMatch(rendered.html,/<img\b/i);
  for(const body of [rendered.text,rendered.html]){
    assert.match(body,/Pack One/);
    assert.match(body,/auth\.verify\.example\/pack1\/auth\/verify-email/);
    assert.doesNotMatch(body,/Reset your password/);
  }
});

test('Resend delivery fixes sender server-side and uses Neon event id for idempotency',async()=>{
  const calls=[];
  const result=await sendRecoveryEmail({
    RESEND_API_KEY:'re_fixture',
    SENDER:'Pack One <accounts@packone.pro>',
    RESET_ORIGIN:'https://packone.pro',
    SUBJECT:'Reset Your Password - Pack One',
  },{
    eventId:'evt_test_12345678',
    email:'person@example.com',
    token:'fixture-token-1234567890',
    expiresAt:'2026-09-21T21:00:00.000Z',
  },async(url,init)=>{
    calls.push({url,init});
    return Response.json({id:'email_fixture_123'},{status:200});
  });
  assert.deepEqual(result,{id:'email_fixture_123'});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers['idempotency-key'],'neon-auth/send.magic_link/evt_test_12345678');
  const body=JSON.parse(calls[0].init.body);
  assert.equal(body.from,'Pack One <accounts@packone.pro>');
  assert.deepEqual(body.to,['person@example.com']);
  assert.match(body.html,/https:\/\/packone\.pro\/reset-password\/#token=/);
  assert.doesNotMatch(body.html,/neon\.tech/i);
});

test('verification delivery uses a separate subject and idempotency namespace',async()=>{
  const calls=[];
  const result=await sendVerificationEmail({
    RESEND_API_KEY:'re_fixture',
    SENDER:'Pack One <accounts@packone.pro>',
    VERIFICATION_SUBJECT:'Verify Your Email - Pack One',
  },{
    eventId:'evt_verify_12345678',
    email:'person@example.com',
    linkUrl:'https://auth.verify.example/pack1/auth/verify-email?token=fixture-token-1234567890',
    expiresAt:'2026-09-22T21:00:00.000Z',
    linkType:'email-verification',
  },async(url,init)=>{
    calls.push({url,init});
    return Response.json({id:'email_verify_fixture_123'},{status:200});
  });
  assert.deepEqual(result,{id:'email_verify_fixture_123'});
  assert.equal(calls.length,1);
  assert.equal(calls[0].init.headers['idempotency-key'],'neon-auth/send.magic_link/email-verification/evt_verify_12345678');
  const body=JSON.parse(calls[0].init.body);
  assert.equal(body.subject,'Verify Your Email - Pack One');
  assert.match(body.html,/Verify your email/i);
  assert.match(body.html,/https:\/\/auth\.verify\.example\/pack1\/auth\/verify-email/);
});

test('webhook handler rejects unsigned requests and hands a verified event to the dedupe boundary',async()=>{
  const fixture=await signedFixture({kid:'handler-kid'});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    if(String(url)==='https://auth.handler.example/.well-known/jwks.json')return Response.json({keys:[fixture.jwk]});
    throw Error('unexpected network call');
  };
  let received=null;
  const env={
    AUTH_BASE:'https://auth.handler.example',
    RECOVERY_DEDUPE:{
      idFromName:value=>'id:'+value,
      get:id=>({
        fetch:async(_url,init)=>{
          received={id,body:JSON.parse(init.body)};
          return responseJson({ok:true});
        },
      }),
    },
  };
  try {
    const unsigned=await authWebhook(new Request('https://hook.example/webhook',{method:'POST',body:'{}'}),env);
    assert.equal(unsigned.status,401);

    const request=new Request('https://hook.example/webhook',{method:'POST',headers:fixture.headers,body:fixture.raw});
    const response=await authWebhook(request,env);
    assert.equal(response.status,204);
    assert.equal(received.id,'id:evt_test_12345678');
    assert.equal(received.body.token,'fixture-token-1234567890');
  } finally {
    globalThis.fetch=originalFetch;
  }
});

test('webhook handler accepts a verified email-verification event without forwarding the raw token',async()=>{
  const authBase='https://auth.verify-handler.example/pack1/auth';
  const fixture=await signedFixture({
    kid:'verify-handler-kid',
    linkType:'email-verification',
    linkUrl:authBase+'/verify-email?token=fixture-token-1234567890',
  });
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    if(String(url)===authBase+'/.well-known/jwks.json')return Response.json({keys:[fixture.jwk]});
    throw Error('unexpected network call');
  };
  let received=null;
  const env={
    AUTH_BASE:authBase,
    RECOVERY_DEDUPE:{
      idFromName:value=>'id:'+value,
      get:id=>({
        fetch:async(_url,init)=>{
          received={id,body:JSON.parse(init.body)};
          return responseJson({ok:true});
        },
      }),
    },
  };
  try{
    const response=await authWebhook(new Request('https://hook.example/webhook',{method:'POST',headers:fixture.headers,body:fixture.raw}),env);
    assert.equal(response.status,204);
    assert.equal(received.id,'id:evt_test_12345678');
    assert.equal(received.body.linkType,'email-verification');
    assert.equal(received.body.linkUrl,fixture.payload.event_data.link_url);
    assert.equal('token' in received.body,false);
  }finally{
    globalThis.fetch=originalFetch;
  }
});

test('QA Durable Object stores pending verification evidence separately from delivery dedupe',async()=>{
  const stored=new Map();
  const dedupe=new RecoveryEventDedupe({
    storage:{
      get:async key=>stored.get(key),
      put:async(key,value)=>stored.set(key,value),
    },
  },{});
  const linkUrl='https://auth.qa-evidence.example/pack1/auth/verify-email?token=fixture-token';
  const post=await dedupe.fetch(new Request('https://pack1.internal/pending-verification',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({linkUrl}),
  }));
  assert.equal(post.status,200);
  const get=await dedupe.fetch(new Request('https://pack1.internal/pending-verification'));
  assert.deepEqual(await get.json(),{linkUrl});
  assert.equal(stored.has('sent'),false);
});

test('QA pending verification evidence is secret-protected and hidden in production',async()=>{
  const linkUrl='https://auth.qa-evidence.example/pack1/auth/verify-email?token=fixture-token';
  const secret='q'.repeat(48);
  const evidenceStub={
    fetch:async()=>Response.json({linkUrl}),
  };
  const qaEnv={
    PACK1_AUTH_ENV:'qa',
    PACK1_QA_EVIDENCE_KEY:secret,
    RECOVERY_DEDUPE:{
      idFromName:value=>value,
      get:id=>{
        assert.match(id,/^__qa_verification_evidence__:[a-f0-9]{16}$/);
        return evidenceStub;
      },
    },
  };
  assert.equal((await authWebhook(new Request('https://hook.example/qa/pending-verification'),qaEnv)).status,401);
  assert.equal((await authWebhook(new Request('https://hook.example/qa/pending-verification',{
    headers:{authorization:'Bearer wrong'},
  }),qaEnv)).status,401);
  const allowed=await authWebhook(new Request('https://hook.example/qa/pending-verification',{
    headers:{authorization:'Bearer '+secret},
  }),qaEnv);
  assert.equal(allowed.status,200);
  assert.deepEqual(await allowed.json(),{linkUrl});

  const prod=await authWebhook(new Request('https://hook.example/qa/pending-verification',{
    headers:{authorization:'Bearer '+secret},
  }),{
    ...qaEnv,
    PACK1_AUTH_ENV:'production',
  });
  assert.equal(prod.status,404);
});

test('signed QA verification delivery records the validated link for later acceptance without raw token telemetry',async()=>{
  const authBase='https://auth.qa-evidence-handler.example/pack1/auth';
  const linkUrl=authBase+'/verify-email?token=fixture-token-1234567890';
  const fixture=await signedFixture({
    kid:'qa-evidence-handler-kid',
    linkType:'email-verification',
    linkUrl,
  });
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    if(String(url)===authBase+'/.well-known/jwks.json')return Response.json({keys:[fixture.jwk]});
    throw Error('unexpected network call');
  };
  const evidence=[];
  const telemetry=[];
  const env={
    PACK1_AUTH_ENV:'qa',
    PACK1_QA_EVIDENCE_KEY:'e'.repeat(48),
    AUTH_BASE:authBase,
    RECOVERY_DEDUPE:{
      idFromName:value=>value,
      get:id=>({
        fetch:async(_url,init)=>{
          if(id==='evt_test_12345678')return Response.json({ok:true,duplicate:false});
          if(/^__qa_verification_evidence__:[a-f0-9]{16}$/.test(id)){
            evidence.push(JSON.parse(init.body));
            return Response.json({ok:true});
          }
          if(id==='__qa_telemetry__'){
            telemetry.push(JSON.parse(init.body));
            return Response.json({ok:true});
          }
          throw Error('unexpected Durable Object id');
        },
      }),
    },
  };
  try{
    const response=await authWebhook(new Request('https://hook.example/webhook',{
      method:'POST',headers:fixture.headers,body:fixture.raw,
    }),env);
    assert.equal(response.status,204);
    assert.deepEqual(evidence,[{linkUrl}]);
    assert.equal(telemetry.length,1);
    assert.equal(telemetry[0].link_type,'email-verification');
    assert.equal('token' in telemetry[0],false);
    assert.equal('linkUrl' in telemetry[0],false);
  }finally{
    globalThis.fetch=originalFetch;
  }
});

test('health endpoint exposes only environment and exact release marker',async()=>{
  const response=await authWebhook(new Request('https://hook.example/health?quick=1'),{
    PACK1_AUTH_ENV:'qa',
    PACK1_RELEASE_COMMIT:'a'.repeat(40),
  });
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{
    ok:true,
    service:'pack1authhook',
    environment:'qa',
    release_commit:'a'.repeat(40),
  });
  assert.equal((await authWebhook(new Request('https://hook.example/health'),{})).status,404);
});

function responseJson(value,status=200) {
  return Response.json(value,{status});
}

test('Durable Object dedupe returns success without a second Resend call after an event is marked sent',async()=>{
  let writes=0;
  const dedupe=new RecoveryEventDedupe({
    storage:{
      get:async key=>key==='sent'?{messageId:'email_already_sent'}:null,
      put:async()=>{writes++;},
    },
  },{});
  const response=await dedupe.fetch(new Request('https://pack1.internal/send',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      eventId:'evt_test_12345678',
      email:'person@example.com',
      token:'fixture-token-1234567890',
      expiresAt:'2026-09-21T21:00:00.000Z',
    }),
  }));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,duplicate:true});
  assert.equal(writes,0);
});


test('QA telemetry stores only sanitized retry fields and is hidden outside QA',async()=>{
  let stored=[];
  const storage={
    get:async key=>key==='qa_telemetry'?stored:null,
    put:async(key,value)=>{if(key==='qa_telemetry')stored=value;},
  };
  const telemetry=new RecoveryEventDedupe({storage},{});
  const post=await telemetry.fetch(new Request('https://pack1.internal/telemetry',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({event_key:'abc123',delivery_attempt:'2',status:'forced_failure',total_ms:17}),
  }));
  assert.equal(post.status,200);
  const get=await telemetry.fetch(new Request('https://pack1.internal/telemetry'));
  assert.deepEqual(await get.json(),{entries:[{event_key:'abc123',delivery_attempt:'2',status:'forced_failure',total_ms:17}]});

  const prod=await authWebhook(new Request('https://hook.example/qa/telemetry'),{PACK1_AUTH_ENV:'production'});
  assert.equal(prod.status,404);
});

test('QA forced delivery failure exercises the provider path and emits verified event metadata',async()=>{
  const fixture=await signedFixture({kid:'qa-delivery-failure-kid'});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    if(String(url)==='https://auth.qa-delivery-failure.example/.well-known/jwks.json')return Response.json({keys:[fixture.jwk]});
    throw Error('unexpected network call');
  };

  const stored=new Map();
  const telemetryEntries=[];
  const dedupe=new RecoveryEventDedupe({
    storage:{
      get:async key=>stored.get(key),
      put:async(key,value)=>stored.set(key,value),
    },
  },{
    PACK1_AUTH_ENV:'qa',
    PACK1_FORCE_DELIVERY_FAILURE:'1',
    RESEND_API_KEY:'re_fixture',
    SENDER:'Pack One QA <qa-accounts@packone.pro>',
    RESET_ORIGIN:'http://localhost:4173',
    SUBJECT:'Reset Your Password - Pack One QA',
  });
  const env={
    PACK1_AUTH_ENV:'qa',
    PACK1_FORCE_DELIVERY_FAILURE:'1',
    AUTH_BASE:'https://auth.qa-delivery-failure.example',
    RECOVERY_DEDUPE:{
      idFromName:value=>value,
      get:id=>{
        if(id==='__qa_telemetry__')return {
          fetch:async(_url,init)=>{
            telemetryEntries.push(JSON.parse(init.body));
            return Response.json({ok:true});
          },
        };
        return {
          fetch:(url,init)=>dedupe.fetch(new Request(url,init)),
        };
      },
    },
  };

  try {
    const response=await authWebhook(new Request('https://hook.example/webhook',{
      method:'POST',headers:fixture.headers,body:fixture.raw,
    }),env);
    assert.equal(response.status,502);
    assert.equal(stored.has('sent'),false);
    assert.equal(telemetryEntries.length,1);
    assert.equal(telemetryEntries[0].status,'delivery_failure');
    assert.equal(telemetryEntries[0].event_type,'send.magic_link');
    assert.equal(telemetryEntries[0].link_type,'forget-password');
    assert.equal('token' in telemetryEntries[0],false);
    assert.equal('email' in telemetryEntries[0],false);
  } finally {
    globalThis.fetch=originalFetch;
  }
});


test('QA retry-after-send mode returns retryable failure after one successful deduped send boundary',async()=>{
  const fixture=await signedFixture({kid:'qa-retry-kid'});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    if(String(url)==='https://auth.qa-retry.example/.well-known/jwks.json')return Response.json({keys:[fixture.jwk]});
    throw Error('unexpected network call');
  };
  const telemetryEntries=[];
  let sendCalls=0;
  const env={
    PACK1_AUTH_ENV:'qa',
    PACK1_FORCE_RETRY_AFTER_SEND:'1',
    AUTH_BASE:'https://auth.qa-retry.example',
    RECOVERY_DEDUPE:{
      idFromName:value=>value,
      get:id=>({
        fetch:async(_url,init)=>{
          if(id==='__qa_telemetry__'){
            telemetryEntries.push(JSON.parse(init.body));
            return Response.json({ok:true});
          }
          sendCalls++;
          return Response.json({ok:true,duplicate:sendCalls>1});
        },
      }),
    },
  };
  try {
    const first=await authWebhook(new Request('https://hook.example/webhook',{method:'POST',headers:fixture.headers,body:fixture.raw}),env);
    assert.equal(first.status,503);
    const retryHeaders=new Headers(fixture.headers);retryHeaders.set('x-neon-delivery-attempt','2');
    const second=await authWebhook(new Request('https://hook.example/webhook',{method:'POST',headers:retryHeaders,body:fixture.raw}),env);
    assert.equal(second.status,503);
    assert.equal(sendCalls,2);
    assert.equal(telemetryEntries[0].duplicate,false);
    assert.equal(telemetryEntries[1].duplicate,true);
    assert.equal(telemetryEntries[1].delivery_attempt,'2');
    assert.equal('token' in telemetryEntries[0],false);
    assert.equal('email' in telemetryEntries[0],false);
  } finally {
    globalThis.fetch=originalFetch;
  }
});


test('production ignores QA fault-injection flags even if dashboard vars are set',async()=>{
  const fixture=await signedFixture({kid:'prod-fault-guard-kid'});
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    if(String(url)==='https://auth.prod-fault-guard.example/.well-known/jwks.json')return Response.json({keys:[fixture.jwk]});
    throw Error('unexpected network call');
  };
  let deliveryCalls=0;
  const env={
    PACK1_AUTH_ENV:'production',
    PACK1_FORCE_DELIVERY_FAILURE:'1',
    PACK1_FORCE_RETRY_AFTER_SEND:'1',
    AUTH_BASE:'https://auth.prod-fault-guard.example',
    RECOVERY_DEDUPE:{
      idFromName:value=>value,
      get:()=>({
        fetch:async()=>{
          deliveryCalls++;
          return Response.json({ok:true,duplicate:false});
        },
      }),
    },
  };
  try {
    const response=await authWebhook(new Request('https://hook.example/webhook',{
      method:'POST',headers:fixture.headers,body:fixture.raw,
    }),env);
    assert.equal(response.status,204);
    assert.equal(deliveryCalls,1);
  } finally {
    globalThis.fetch=originalFetch;
  }
});
