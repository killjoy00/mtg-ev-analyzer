import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {digest} from '../worker/account-session.mjs';

process.env.DATABASE_URL='postgres://user:pass@ep-fixture.example/neondb';
process.env.PACK1_RATE_LIMIT_SECRET='r'.repeat(64);

const {default:growth}=await import('../worker/growth-function.js');

const USER='11111111-1111-4111-8111-111111111111';
const ACCOUNT='a'.repeat(43);
const CSRF='c'.repeat(43);
const NETWORK='d'.repeat(64);
const ORIGIN='https://packone.pro';
const proof=()=>createHmac('sha256',process.env.PACK1_RATE_LIMIT_SECRET)
  .update('pack1-credential-network:'+NETWORK).digest('hex');

function dbResponse(fields=[],rows=[],rowCount=0) {
  return Response.json({fields:fields.map(name=>({name})),rows,rowCount});
}

function installFetch({
  currentAttempts=1,networkAttempts=1,emailAccountAttempts=1,emailNetworkAttempts=1,
  hasPassword=true,hasGoogle=false,signInStatus=200,changeStatus=200,
}={}) {
  const calls=[];
  globalThis.fetch=async(url,options={})=>{
    const target=String(url),body=options.body?JSON.parse(options.body):null;
    if(target.startsWith('https://api.example/sql')) {
      const sql=body.query,params=body.params||[];
      calls.push({kind:'db',sql,params});
      if(sql.includes('FROM account_sessions s JOIN neon_auth."user" u'))
        return dbResponse(
          ['session_hash','csrf_hash','expires_at','user_id','email','name'],
          [[digest(ACCOUNT),digest(CSRF),'2099-01-01T00:00:00Z',USER,'server-owner@example.com','Owner']],1,
        );
      if(sql.includes('bool_or("providerId"='))
        return dbResponse(['has_password','has_google'],[[hasPassword?'t':'f',hasGoogle?'t':'f']],1);
      if(sql.startsWith('DELETE FROM account_credential_rate_limits WHERE expires_at'))
        return dbResponse([],[],1);
      if(sql.includes('INSERT INTO account_credential_rate_limits')) {
        const attempts={
          current_password:currentAttempts,
          password_change_network:networkAttempts,
          email_change_account:emailAccountAttempts,
          email_change_network:emailNetworkAttempts,
        }[params[1]]??1;
        return dbResponse(['attempts','expires_at','retry_after'],[[String(attempts),'2099-01-01T00:00:00Z','900']],1);
      }
      if(sql.startsWith('DELETE FROM account_credential_rate_limits WHERE auth_user_id='))
        return dbResponse([],[],1);
      if(sql.includes('UPDATE account_sessions SET revoked_at=COALESCE'))
        return dbResponse([],[],3);
      throw Error('Unexpected SQL: '+sql);
    }
    if(target.includes('.neonauth.')||target.includes('/pack1/auth/')) {
      const path=new URL(target).pathname;
      calls.push({kind:'provider',path,body,headers:new Headers(options.headers||{})});
      if(path.endsWith('/sign-in/email')) {
        if(signInStatus!==200)return Response.json({code:'INVALID_EMAIL_OR_PASSWORD',message:'provider detail'},{status:signInStatus});
        return new Response(JSON.stringify({user:{id:USER,email:'server-owner@example.com'},token:'provider-token'}),{
          status:200,headers:{'content-type':'application/json','set-cookie':'__Secure-neon-auth.session_token=provider-session; Path=/; HttpOnly'},
        });
      }
      if(path.endsWith('/change-password')) {
        if(changeStatus!==200)return Response.json({code:'PASSWORD_TOO_SHORT',message:'provider policy detail'},{status:changeStatus});
        return new Response(JSON.stringify({user:{id:USER,email:'server-owner@example.com'},token:'changed-token'}),{
          status:200,headers:{'content-type':'application/json','set-cookie':'__Secure-neon-auth.session_token=changed-session; Path=/; HttpOnly'},
        });
      }
      if(path.endsWith('/sign-out'))return Response.json({success:true});
      throw Error('Unexpected provider path '+path);
    }
    throw Error('Unexpected fetch '+target);
  };
  return calls;
}

function request(body={},headers={}) {
  return new Request('https://packone.pro/v1/account/password-change',{
    method:'POST',
    headers:{
      origin:ORIGIN,'content-type':'application/json',
      cookie:`__Host-pack1_account=${ACCOUNT}; __Secure-pack1_csrf=${CSRF}`,
      'x-pack1-csrf':CSRF,
      'x-pack1-network-id':NETWORK,
      'x-pack1-network-proof':proof(),
      ...headers,
    },
    body:JSON.stringify({
      currentPassword:'Current-password-123!',
      newPassword:'New-password-456!',
      ...body,
    }),
  });
}

function emailRequest(newEmail='new-owner@example.com',headers={}) {
  return new Request('https://packone.pro/v1/account/email-change',{
    method:'POST',
    headers:{
      origin:ORIGIN,'content-type':'application/json',
      cookie:`__Host-pack1_account=${ACCOUNT}; __Secure-pack1_csrf=${CSRF}`,
      'x-pack1-csrf':CSRF,
      'x-pack1-network-id':NETWORK,
      'x-pack1-network-proof':proof(),
      ...headers,
    },
    body:JSON.stringify({newEmail}),
  });
}

test('password change rejects malicious origin, missing CSRF and legacy-only sessions before provider work',async()=>{
  let calls=installFetch();
  let response=await growth.fetch(request({}, {origin:'https://evil.test'}));
  assert.equal(response.status,403);
  assert.equal(calls.some(x=>x.kind==='provider'),false);

  calls=installFetch();
  response=await growth.fetch(request({}, {'x-pack1-csrf':''}));
  assert.equal(response.status,403);
  assert.equal(calls.some(x=>x.kind==='provider'),false);

  calls=installFetch();
  const legacy=new Request('https://packone.pro/v1/account/password-change',{
    method:'POST',
    headers:{origin:ORIGIN,'content-type':'application/json','x-pack1-auth-session':'legacy-session'},
    body:JSON.stringify({currentPassword:'x',newPassword:'New-password-456!'}),
  });
  response=await growth.fetch(legacy);
  assert.equal(response.status,401);
  assert.equal(calls.some(x=>x.kind==='provider'),false);
});

test('password verification uses the server-derived authenticated email and never a client identity',async()=>{
  const calls=installFetch();
  const response=await growth.fetch(request({email:'attacker@example.net',authUserId:'00000000-0000-4000-8000-000000000000'}));
  assert.equal(response.status,200);
  const signin=calls.find(x=>x.kind==='provider'&&x.path.endsWith('/sign-in/email'));
  assert.equal(signin.body.email,'server-owner@example.com');
  assert.equal(signin.body.password,'Current-password-123!');
  assert.equal(calls.some(x=>JSON.stringify(x).includes('attacker@example.net')),false);
});

test('global account threshold blocks before network/provider and network threshold blocks before provider',async()=>{
  let calls=installFetch({currentAttempts:9});
  let response=await growth.fetch(request());
  assert.equal(response.status,429);
  assert.equal(calls.some(x=>x.kind==='provider'),false);
  assert.equal(calls.filter(x=>x.kind==='db'&&x.sql.includes('INSERT INTO account_credential_rate_limits')).length,1);

  calls=installFetch({currentAttempts:1,networkAttempts:6});
  response=await growth.fetch(request());
  assert.equal(response.status,429);
  assert.equal(calls.some(x=>x.kind==='provider'),false);
  assert.equal(calls.filter(x=>x.kind==='db'&&x.sql.includes('INSERT INTO account_credential_rate_limits')).length,2);
});

test('forged or missing gateway network proof fails closed before provider work',async()=>{
  for(const headers of [
    {'x-pack1-network-proof':''},
    {'x-pack1-network-proof':'e'.repeat(64)},
    {'x-pack1-network-id':'f'.repeat(64)},
  ]) {
    const calls=installFetch();
    const response=await growth.fetch(request({},headers));
    assert.equal(response.status,503);
    assert.equal(calls.some(x=>x.kind==='provider'),false);
  }
});

test('wrong current password is generic, retains failure budget, and never revokes Pack One sessions',async()=>{
  const calls=installFetch({signInStatus:401});
  const response=await growth.fetch(request());
  const body=await response.json();
  assert.equal(response.status,400);
  assert.equal(body.code,'CURRENT_PASSWORD');
  assert.equal(body.error,'Current password was not accepted.');
  assert.equal(calls.some(x=>x.kind==='db'&&x.sql.includes('UPDATE account_sessions SET revoked_at')),false);
  assert.equal(calls.some(x=>x.kind==='db'&&x.sql.startsWith('DELETE FROM account_credential_rate_limits WHERE auth_user_id=')),false);
});

test('provider password-policy failure does not revoke sessions or clear the shared failure budget',async()=>{
  const calls=installFetch({changeStatus:422});
  const response=await growth.fetch(request());
  const body=await response.json();
  assert.equal(response.status,400);
  assert.equal(body.code,'PASSWORD_POLICY');
  assert.equal(body.error,'The new password was not accepted.');
  assert.equal(calls.some(x=>x.kind==='db'&&x.sql.includes('UPDATE account_sessions SET revoked_at')),false);
  assert.equal(calls.some(x=>x.kind==='db'&&x.sql.startsWith('DELETE FROM account_credential_rate_limits WHERE auth_user_id=')),false);
  assert.ok(calls.some(x=>x.kind==='provider'&&x.path.endsWith('/sign-out')),'temporary provider session is closed');
});

test('successful password change clears shared failure counter then revokes all Pack One sessions and clears cookies',async()=>{
  const calls=installFetch();
  const response=await growth.fetch(request());
  assert.equal(response.status,200);
  const changed=calls.findIndex(x=>x.kind==='provider'&&x.path.endsWith('/change-password'));
  const cleared=calls.findIndex(x=>x.kind==='db'&&x.sql.startsWith('DELETE FROM account_credential_rate_limits WHERE auth_user_id='));
  const revoked=calls.findIndex(x=>x.kind==='db'&&x.sql.includes('UPDATE account_sessions SET revoked_at'));
  assert.ok(changed>=0&&cleared>changed&&revoked>cleared);
  const clearCall=calls[cleared];
  assert.deepEqual(clearCall.params,[USER,'current_password','']);
  assert.ok(calls.some(x=>x.kind==='provider'&&x.path.endsWith('/sign-out')));
  const cookies=response.headers.get('set-cookie')||'';
  assert.match(cookies,/__Host-pack1_account=;.*Max-Age=0/);
  assert.match(cookies,/__Secure-pack1_csrf=;.*Max-Age=0/);
});

test('Google-only account is provider-aware and never enters password verification',async()=>{
  const calls=installFetch({hasPassword:false,hasGoogle:true});
  const response=await growth.fetch(request());
  const body=await response.json();
  assert.equal(response.status,409);
  assert.equal(body.code,'NO_PASSWORD_CREDENTIAL');
  assert.equal(calls.some(x=>x.kind==='provider'),false);
  assert.equal(calls.some(x=>x.kind==='db'&&x.sql.includes('INSERT INTO account_credential_rate_limits')),false);
});


test('email-change boundary is first-party only, target-independent, rate limited, and never claims verification was sent',async()=>{
  const calls=installFetch();
  const response=await growth.fetch(emailRequest('first-target@example.com'));
  const body=await response.json();
  assert.equal(response.status,503);
  assert.equal(body.code,'EMAIL_CHANGE_UNAVAILABLE');
  assert.equal(body.error,'Email changes are temporarily unavailable.');
  assert.equal(calls.some(x=>x.kind==='provider'),false);
  const writes=calls.filter(x=>x.kind==='db'&&x.sql.includes('INSERT INTO account_credential_rate_limits'));
  assert.equal(writes.length,2);
  assert.deepEqual(writes[0].params.slice(0,3),[USER,'email_change_account','']);
  assert.deepEqual(writes[1].params.slice(0,3),[USER,'email_change_network',NETWORK]);
  assert.equal(JSON.stringify(writes).includes('first-target@example.com'),false);
  assert.equal(calls.some(x=>x.kind==='db'&&x.sql.startsWith('DELETE FROM account_credential_rate_limits WHERE auth_user_id=')),false);
});

test('changing target email cannot evade account email-submission threshold',async()=>{
  for(const target of ['one@example.com','two@example.net']) {
    const calls=installFetch({emailAccountAttempts:7});
    const response=await growth.fetch(emailRequest(target));
    assert.equal(response.status,429);
    assert.equal(calls.some(x=>x.kind==='provider'),false);
    const writes=calls.filter(x=>x.kind==='db'&&x.sql.includes('INSERT INTO account_credential_rate_limits'));
    assert.equal(writes.length,1);
    assert.deepEqual(writes[0].params.slice(0,3),[USER,'email_change_account','']);
    assert.equal(JSON.stringify(writes).includes(target),false);
  }
});

test('email-change network threshold blocks locally and malicious Origin or CSRF never reaches limiter/provider',async()=>{
  let calls=installFetch({emailAccountAttempts:1,emailNetworkAttempts:5});
  let response=await growth.fetch(emailRequest());
  assert.equal(response.status,429);
  assert.equal(calls.some(x=>x.kind==='provider'),false);

  calls=installFetch();
  response=await growth.fetch(emailRequest('other@example.com',{origin:'https://evil.test'}));
  assert.equal(response.status,403);
  assert.equal(calls.length,0);

  calls=installFetch();
  response=await growth.fetch(emailRequest('other@example.com',{'x-pack1-csrf':''}));
  assert.equal(response.status,403);
  assert.equal(calls.some(x=>x.kind==='provider'),false);
});
