import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL='postgres://user:pass@ep-fixture.example/neondb';
process.env.PACK1_RATE_LIMIT_SECRET='r'.repeat(64);

const {accountRuntimeConfig,PROD_AUTH_BASE,QA_AUTH_BASE,PROD_RESET_DESTINATION,QA_RESET_DESTINATION}=await import('../worker/account-config.mjs');
const {requireTrustedOrigin,revokeAllAccountSessions}=await import('../worker/account-session.mjs');
const {default:growth,normalizedRecoveryEmail,recoveryRateKey}=await import('../worker/growth-function.js');

const authId='11111111-1111-4111-8111-111111111111';
const origin='https://packone.pro';
const request=(path,body={},headers={})=>new Request('https://packone.pro'+path,{
  method:'POST',
  headers:{origin,'content-type':'application/json',...headers},
  body:JSON.stringify(body),
});

function dbResponse(fields=[],rows=[],rowCount=0) {
  return Response.json({fields:fields.map(name=>({name})),rows,rowCount});
}

function installFetch({providerStatus=200,attempts=1,recovery='valid'}={}) {
  const calls=[];
  globalThis.fetch=async(url,options={})=>{
    const target=String(url),body=options.body?JSON.parse(options.body):null;
    if(target.startsWith('https://api-fixture.example/sql')) {
      const sql=body.query;
      calls.push({kind:'db',sql,params:body.params});
      if(sql.includes('DELETE FROM account_recovery_rate_limits'))return dbResponse([],[],1);
      if(sql.includes('INSERT INTO account_recovery_rate_limits'))return dbResponse(['attempts','expires_at'],[[String(attempts),'2099-01-01T00:00:00Z']],1);
      if(sql.includes('FROM neon_auth.verification')) {
        if(recovery==='missing')return dbResponse(['auth_user_id','expires_at'],[],0);
        if(recovery==='expired')return dbResponse(['auth_user_id','expires_at'],[[authId,'2000-01-01T00:00:00Z']],1);
        return dbResponse(['auth_user_id','expires_at'],[[authId,'2099-01-01T00:00:00Z']],1);
      }
      if(sql.includes('UPDATE account_sessions SET revoked_at'))return dbResponse([],[],2);
      throw Error('Unexpected SQL: '+sql);
    }
    if(target.startsWith(PROD_AUTH_BASE)) {
      calls.push({kind:'provider',url:target,body,headers:new Headers(options.headers||{})});
      return providerStatus===200?Response.json({status:true}):Response.json({message:'provider rejected'},{status:providerStatus});
    }
    throw Error('Unexpected fetch '+target);
  };
  return calls;
}

test('trusted Auth environments and reset destinations are fixed server configuration',()=>{
  const prod=accountRuntimeConfig({});
  assert.equal(prod.authBase,PROD_AUTH_BASE);
  assert.equal(prod.resetDestination,PROD_RESET_DESTINATION);
  assert.deepEqual([...prod.allowedOrigins],['https://packone.pro','https://api.packone.pro','https://magic.planitnow.us']);
  const qa=accountRuntimeConfig({PACK1_AUTH_ENV:'qa',PACK1_ALLOW_LOCALHOST:'1'});
  assert.equal(qa.authBase,QA_AUTH_BASE);
  assert.equal(qa.resetDestination,QA_RESET_DESTINATION);
  assert.ok(qa.allowedOrigins.has('http://localhost:4173'));
  assert.ok(qa.allowedOrigins.has('http://127.0.0.1:4173'));
  assert.throws(()=>accountRuntimeConfig({PACK1_AUTH_ENV:'qa'}),/requires explicit localhost/);
});

test('origin enforcement has no silent default and production preserves all three origins',()=>{
  assert.throws(()=>requireTrustedOrigin(new Request('https://x.test',{headers:{origin}})),e=>e.status===503);
  const allowed=accountRuntimeConfig({}).allowedOrigins;
  for(const value of ['https://packone.pro','https://api.packone.pro','https://magic.planitnow.us'])
    assert.equal(requireTrustedOrigin(new Request('https://x.test',{headers:{origin:value}}),allowed),value);
  assert.throws(()=>requireTrustedOrigin(new Request('https://x.test',{headers:{origin:'http://localhost:4173'}}),allowed),e=>e.status===403);
});

test('email limiter identity is normalized HMAC, stable, secret-specific, and not a raw or plain SHA email key',async()=>{
  const crypto=await import('node:crypto');
  assert.equal(normalizedRecoveryEmail('  QA.User@Example.COM '),'qa.user@example.com');
  const email='qa.user@example.com';
  process.env.PACK1_RATE_LIMIT_SECRET='a'.repeat(64);
  const first=recoveryRateKey(email),again=recoveryRateKey(email);
  process.env.PACK1_RATE_LIMIT_SECRET='b'.repeat(64);
  const second=recoveryRateKey(email);
  assert.match(first,/^[a-f0-9]{64}$/);assert.equal(first,again);assert.notEqual(first,second);
  assert.notEqual(first,email);
  assert.notEqual(first,crypto.createHash('sha256').update(email).digest('hex'));
  process.env.PACK1_RATE_LIMIT_SECRET='r'.repeat(64);
});

test('reset request ignores hostile redirect inputs and sends only the exact server destination',async()=>{
  const calls=installFetch();
  const response=await growth.fetch(request('/v1/account/request-password-reset?redirectTo=https%3A%2F%2Fevil.test%2F',{
    email:' Victim@Example.com ',redirectTo:'https://evil.test/',
  },{
    referer:'https://evil.test/reset',
    'x-forwarded-host':'evil.test',
    'x-forwarded-proto':'https',
  }));
  assert.equal(response.status,200);
  const provider=calls.find(x=>x.kind==='provider');
  assert.ok(provider);
  assert.equal(provider.body.email,'victim@example.com');
  assert.equal(provider.body.redirectTo,PROD_RESET_DESTINATION);
  assert.equal(provider.headers.get('origin'),'https://packone.pro');
  assert.ok(!JSON.stringify(provider).includes('evil.test'));
});

test('malicious Origin is rejected before database or provider work',async()=>{
  const calls=installFetch();
  const response=await growth.fetch(request('/v1/account/request-password-reset',{email:'qa@example.com'},{origin:'https://evil.test'}));
  assert.equal(response.status,403);
  assert.equal(calls.length,0);
});

test('known and unknown/provider-rejected reset requests are enumeration-safe',async()=>{
  const okCalls=installFetch({providerStatus:200});
  const ok=await growth.fetch(request('/v1/account/request-password-reset',{email:'known@example.com'}));
  const okBody=await ok.json();
  assert.equal(ok.status,200);assert.ok(okCalls.some(x=>x.kind==='provider'));

  const unknownCalls=installFetch({providerStatus:404});
  const unknown=await growth.fetch(request('/v1/account/request-password-reset',{email:'unknown@example.com'}));
  const unknownBody=await unknown.json();
  assert.equal(unknown.status,200);assert.ok(unknownCalls.some(x=>x.kind==='provider'));
  assert.deepEqual(unknownBody,okBody);
});

test('missing limiter secret fails closed before database or provider invocation',async()=>{
  const calls=installFetch();
  delete process.env.PACK1_RATE_LIMIT_SECRET;
  const response=await growth.fetch(request('/v1/account/request-password-reset',{email:'qa@example.com'}));
  assert.equal(response.status,503);
  assert.equal(calls.length,0);
  process.env.PACK1_RATE_LIMIT_SECRET='r'.repeat(64);
});

test('rate-limit threshold blocks provider and limiter records carry only HMAC identity',async()=>{
  const calls=installFetch({attempts:6});
  const response=await growth.fetch(request('/v1/account/request-password-reset',{email:'qa@example.com'}));
  assert.equal(response.status,429);
  assert.equal(calls.some(x=>x.kind==='provider'),false);
  const write=calls.find(x=>x.kind==='db'&&x.sql.includes('INSERT INTO account_recovery_rate_limits'));
  assert.match(write.params[0],/^[a-f0-9]{64}$/);
  assert.ok(!write.params.includes('qa@example.com'));
  assert.ok(calls.some(x=>x.kind==='db'&&x.sql.includes('DELETE FROM account_recovery_rate_limits')));
});

test('shared account-session revocation is idempotent and requires an unambiguous Auth UUID',async()=>{
  const seen=[];
  const query=async(sql,params)=>{seen.push({sql,params});return {rowCount:2,rows:[]};};
  assert.deepEqual(await revokeAllAccountSessions(query,authId),{authUserId:authId,revoked:2});
  assert.equal(seen[0].params[0],authId);
  assert.match(seen[0].sql,/auth_user_id=\$1::uuid/);
  assert.equal((await revokeAllAccountSessions(async()=>({rowCount:0,rows:[]}),authId)).revoked,0);
  await assert.rejects(revokeAllAccountSessions(query,'legacy-token'),/Unambiguous Auth user identity/);
});

test('successful reset revokes Pack One sessions only after provider success',async()=>{
  const calls=installFetch();
  const response=await growth.fetch(request('/v1/account/reset-password',{token:'T'.repeat(32),newPassword:'New-password-123!'}));
  assert.equal(response.status,200);
  const providerIndex=calls.findIndex(x=>x.kind==='provider'&&x.url.endsWith('/reset-password'));
  const revokeIndex=calls.findIndex(x=>x.kind==='db'&&x.sql.includes('UPDATE account_sessions SET revoked_at'));
  assert.ok(providerIndex>=0&&revokeIndex>providerIndex);
  const cookies=response.headers.get('set-cookie')||'';
  assert.match(cookies,/__Host-pack1_account=;.*Max-Age=0/);
});

test('failed, expired, invalid or policy-rejected resets never revoke valid sessions',async()=>{
  for(const setup of [
    {providerStatus:400,recovery:'valid',password:'New-password-123!',code:'INVALID_RESET'},
    {providerStatus:200,recovery:'expired',password:'New-password-123!',code:'EXPIRED_RESET'},
    {providerStatus:200,recovery:'missing',password:'New-password-123!',code:'INVALID_RESET'},
    {providerStatus:200,recovery:'valid',password:'short',code:'PASSWORD_POLICY'},
  ]) {
    const calls=installFetch(setup);
    const response=await growth.fetch(request('/v1/account/reset-password',{token:'T'.repeat(32),newPassword:setup.password}));
    const body=await response.json();
    assert.equal(response.status,400);
    assert.equal(body.code,setup.code);
    assert.equal(calls.some(x=>x.kind==='db'&&x.sql.includes('UPDATE account_sessions SET revoked_at')),false);
  }
});
