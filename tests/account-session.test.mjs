import test from 'node:test';
import assert from 'node:assert/strict';
import {accountSession,digest} from '../worker/account-session.mjs';

const opaque=x=>x.repeat(43).slice(0,43);
const LIVE=opaque('a'),STALE=opaque('b'),CSRF=opaque('c');

// Only the live session exists. A revoked or expired cookie simply matches no
// row, which is the state a browser cannot clear for itself.
function fakeQuery({legacy=null}={}) {
  return async(sql,params)=>{
    if(sql.includes('FROM account_sessions'))
      return {rows:params[0]===digest(LIVE)?[{
        session_hash:digest(LIVE),csrf_hash:digest(CSRF),expires_at:'2099-01-01T00:00:00Z',
        user_id:'11111111-1111-4111-8111-111111111111',email:'qa@example.invalid',name:'QA',
      }]:[]};
    if(sql.includes('FROM neon_auth.session'))
      return {rows:legacy&&params[0]===legacy?[{
        token:legacy,expires_at:'2099-01-01T00:00:00Z',
        user_id:'22222222-2222-4222-8222-222222222222',email:'legacy@example.invalid',name:'Legacy',
      }]:[]};
    throw Error('Unexpected SQL: '+sql);
  };
}
const request=(cookie,{method='GET',headers={}}={})=>
  new Request('https://packone.pro/v1/account/session',{method,headers:{...(cookie?{cookie}:{}),...headers}});
const accountCookie=value=>'__Host-pack1_account='+value;

test('a live first-party cookie resolves to its account',async()=>{
  const session=await accountSession(request(accountCookie(LIVE)),fakeQuery());
  assert.equal(session.source,'cookie');
  assert.equal(session.email,'qa@example.invalid');
});

test('an optional caller reads a revoked cookie as no account instead of 401',async()=>{
  // Regression: accountIdentity asks for an optional session so guests keep
  // playing. Throwing here 401'd every gameplay surface for anyone holding a
  // rotated or expired HttpOnly cookie, with no way to clear it from the page.
  assert.equal(await accountSession(request(accountCookie(STALE)),fakeQuery(),{required:false}),null);
});

test('a required caller still rejects a revoked cookie',async()=>{
  await assert.rejects(
    accountSession(request(accountCookie(STALE)),fakeQuery()),
    error=>error.status===401&&/expired/i.test(error.message),
  );
});

test('a revoked cookie falls through to a still-valid legacy header',async()=>{
  const session=await accountSession(
    request(accountCookie(STALE),{headers:{'x-pack1-auth-session':'legacy-token'}}),
    fakeQuery({legacy:'legacy-token'}),
  );
  assert.equal(session.source,'legacy');
  assert.equal(session.email,'legacy@example.invalid');
});

test('sign-out style optional reads never bypass CSRF on a live session',async()=>{
  await assert.rejects(
    accountSession(request(accountCookie(LIVE),{method:'POST'}),fakeQuery(),{required:false}),
    error=>error.status===403,
  );
  const session=await accountSession(
    request(accountCookie(LIVE),{method:'POST',headers:{'x-pack1-csrf':CSRF}}),
    fakeQuery(),{required:false},
  );
  assert.equal(session.source,'cookie');
});

test('no credential at all stays 401 for required callers and null for optional ones',async()=>{
  await assert.rejects(accountSession(request(null),fakeQuery()),error=>error.status===401);
  assert.equal(await accountSession(request(null),fakeQuery(),{required:false}),null);
});
