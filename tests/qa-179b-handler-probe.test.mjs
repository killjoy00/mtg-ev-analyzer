import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';

const enabled=process.env.GITHUB_HEAD_REF==='ops/179b-handler-qa-probe';
const authBase='https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth';
const origin='http://localhost:4173';

function cookieHeader(response) {
  const rows=typeof response.headers.getSetCookie==='function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return rows.flatMap(row=>String(row).split(/,(?=\\s*[^;,]+=)/))
    .map(row=>row.split(';')[0].trim()).filter(Boolean).join('; ');
}

async function provider(realFetch,path,{body,cookie}={}) {
  const response=await realFetch(authBase+path,{
    method:body===undefined?'GET':'POST',
    headers:{origin,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},
    body:body===undefined?undefined:JSON.stringify(body),
    redirect:'manual',
  });
  const data=await response.json().catch(()=>({}));
  return {response,data,cookie:cookieHeader(response)};
}

function dbResponse(fields=[],rows=[],rowCount=0) {
  return Response.json({fields:fields.map(name=>({name})),rows,rowCount});
}

test('actual 179B password-change handler works against isolated QA Auth',{skip:!enabled,timeout:60000},async()=>{
  process.env.DATABASE_URL='postgres://user:pass@ep-fixture.example/neondb';
  process.env.PACK1_AUTH_ENV='qa';
  process.env.PACK1_ALLOW_LOCALHOST='1';
  process.env.PACK1_RATE_LIMIT_SECRET='r'.repeat(64);

  const realFetch=globalThis.fetch;
  const stamp=Date.now();
  const email=`qa-179b-handler-${stamp}@example.com`;
  const currentPassword='Qa1!'+randomBytes(20).toString('base64url');
  const newPassword='Qb2!'+randomBytes(20).toString('base64url');

  const signup=await provider(realFetch,'/sign-up/email',{body:{name:'QA 179B Handler',email,password:currentPassword}});
  assert.equal(signup.response.status,200);
  const userId=String(signup.data?.user?.id||'');
  assert.match(userId,/^[0-9a-f-]{36}$/i);

  const {digest}=await import('../worker/account-session.mjs');
  const ACCOUNT='a'.repeat(43);
  const CSRF='c'.repeat(43);
  const NETWORK='d'.repeat(64);
  const calls=[];

  globalThis.fetch=async(url,options={})=>{
    const target=String(url);
    if(target.startsWith('https://api.example/sql')) {
      const body=JSON.parse(options.body||'{}'),sql=body.query,params=body.params||[];
      calls.push({kind:'db',sql,params});
      if(sql.includes('FROM account_sessions s JOIN neon_auth."user" u'))
        return dbResponse(
          ['session_hash','csrf_hash','expires_at','user_id','email','name'],
          [[digest(ACCOUNT),digest(CSRF),'2099-01-01T00:00:00Z',userId,email,'QA 179B Handler']],1,
        );
      if(sql.includes('bool_or("providerId"='))
        return dbResponse(['has_password','has_google'],[['t','f']],1);
      if(sql.startsWith('DELETE FROM account_credential_rate_limits WHERE expires_at'))
        return dbResponse([],[],1);
      if(sql.includes('INSERT INTO account_credential_rate_limits'))
        return dbResponse(['attempts','expires_at','retry_after'],[['1','2099-01-01T00:00:00Z','900']],1);
      if(sql.startsWith('DELETE FROM account_credential_rate_limits WHERE auth_user_id='))
        return dbResponse([],[],1);
      if(sql.includes('UPDATE account_sessions SET revoked_at=COALESCE'))
        return dbResponse([],[],2);
      throw Error('Unexpected SQL: '+sql);
    }
    calls.push({kind:'provider',url:target});
    return realFetch(url,options);
  };

  try {
    const {default:growth}=await import('../worker/growth-function.js');
    const proof=createHmac('sha256',process.env.PACK1_RATE_LIMIT_SECRET)
      .update('pack1-credential-network:'+NETWORK).digest('hex');
    const response=await growth.fetch(new Request('http://localhost:4173/v1/account/password-change',{
      method:'POST',
      headers:{
        origin,'content-type':'application/json',
        cookie:`__Host-pack1_account=${ACCOUNT}; __Secure-pack1_csrf=${CSRF}`,
        'x-pack1-csrf':CSRF,
        'x-pack1-network-id':NETWORK,
        'x-pack1-network-proof':proof,
      },
      body:JSON.stringify({currentPassword,newPassword}),
    }));
    const body=await response.json();
    assert.equal(response.status,200);
    assert.deepEqual(body,{ok:true,signedOut:true});
    assert.ok(calls.some(x=>x.kind==='provider'&&x.url.endsWith('/sign-in/email')));
    assert.ok(calls.some(x=>x.kind==='provider'&&x.url.endsWith('/change-password')));
    assert.ok(calls.some(x=>x.kind==='provider'&&x.url.endsWith('/sign-out')));
    assert.ok(calls.some(x=>x.kind==='db'&&x.sql.includes('UPDATE account_sessions SET revoked_at=COALESCE')));

    const oldSignin=await provider(realFetch,'/sign-in/email',{body:{email,password:currentPassword,rememberMe:true}});
    const newSignin=await provider(realFetch,'/sign-in/email',{body:{email,password:newPassword,rememberMe:true}});
    assert.equal(oldSignin.response.status,401);
    assert.equal(newSignin.response.status,200);

    console.log(JSON.stringify({
      label:'qa-179b-handler-result',
      userId,
      handlerStatus:response.status,
      oldPasswordStatus:oldSignin.response.status,
      newPasswordStatus:newSignin.response.status,
      revokedPackOneSessions:true,
    }));
  } finally {
    globalThis.fetch=realFetch;
  }
});
