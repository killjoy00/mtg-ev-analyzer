import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';

const enabled=process.env.GITHUB_HEAD_REF==='ops/179b-provider-probe';
const base='https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth';
const origin='http://localhost:4173';

function cookiePairs(response) {
  const rows=typeof response.headers.getSetCookie==='function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return rows.flatMap(row=>String(row).split(/,(?=\s*[^;,]+=)/))
    .map(row=>row.split(';')[0].trim()).filter(Boolean);
}
const cookieHeader=response=>cookiePairs(response).join('; ');
const cookieNames=response=>cookiePairs(response).map(row=>row.slice(0,row.indexOf('=')));

async function call(path,{body,cookie}={}) {
  const response=await fetch(base+path,{
    method:body===undefined?'GET':'POST',
    headers:{origin,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},
    body:body===undefined?undefined:JSON.stringify(body),
    redirect:'manual',
  });
  const data=await response.json().catch(()=>({}));
  return {response,data,cookie:cookieHeader(response)};
}
function report(label,row) {
  console.log(JSON.stringify({
    label,status:row.response.status,ok:row.response.ok,
    keys:Object.keys(row.data||{}).sort(),
    userId:row.data?.user?.id||null,userEmail:row.data?.user?.email||null,
    hasToken:Boolean(row.data?.token||row.data?.session?.token),
    cookieNames:cookieNames(row.response),
    message:typeof row.data?.message==='string'?row.data.message.slice(0,120):null,
    error:typeof row.data?.error==='string'?row.data.error.slice(0,120):null,
  }));
}

test('isolated QA Better Auth 179B provider behavior',{skip:!enabled,timeout:60000},async()=>{
  const stamp=Date.now();
  const emailA=`qa-179b-a-${stamp}@example.com`;
  const emailB=`qa-179b-b-${stamp}@example.com`;
  const requestedEmail='delivered@resend.dev';
  const password='Qa1!'+randomBytes(20).toString('base64url');
  const nextPassword='Qb2!'+randomBytes(20).toString('base64url');

  const signupA=await call('/sign-up/email',{body:{name:'QA 179B A',email:emailA,password}});
  report('signup-a',signupA);
  assert.equal(signupA.response.status,200);
  assert.ok(signupA.data?.user?.id);

  const wrong=await call('/change-password',{cookie:signupA.cookie,body:{
    currentPassword:'definitely-wrong-'+randomBytes(8).toString('hex'),
    newPassword:nextPassword,revokeOtherSessions:true,
  }});
  report('change-password-wrong-current',wrong);

  const changed=await call('/change-password',{cookie:signupA.cookie,body:{
    currentPassword:password,newPassword:nextPassword,revokeOtherSessions:true,
  }});
  report('change-password-success',changed);

  const oldSignin=await call('/sign-in/email',{body:{email:emailA,password,rememberMe:true}});
  report('signin-old-password-after-change',oldSignin);
  const newSignin=await call('/sign-in/email',{body:{email:emailA,password:nextPassword,rememberMe:true}});
  report('signin-new-password-after-change',newSignin);

  const originalSession=await call('/get-session',{cookie:signupA.cookie});
  report('original-provider-session-after-change',originalSession);

  if(newSignin.response.ok) {
    const emailChange=await call('/change-email',{cookie:newSignin.cookie,body:{
      newEmail:requestedEmail,callbackURL:'http://localhost:4173/?account=email-change',
    }});
    report('change-email-new-address',emailChange);
  }

  const signupB=await call('/sign-up/email',{body:{name:'QA 179B B',email:emailB,password}});
  report('signup-b',signupB);
  assert.equal(signupB.response.status,200);
  assert.ok(signupB.data?.user?.id);

  if(newSignin.response.ok) {
    const duplicate=await call('/change-email',{cookie:newSignin.cookie,body:{
      newEmail:emailB,callbackURL:'http://localhost:4173/?account=email-change',
    }});
    report('change-email-duplicate-target',duplicate);
  }

  console.log(JSON.stringify({
    label:'fixture-identities',userA:signupA.data.user.id,userB:signupB.data.user.id,
    emailA,emailB,requestedEmail,
  }));
});
