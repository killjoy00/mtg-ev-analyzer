import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';

const enabled=process.env.GITHUB_HEAD_REF==='ops/179c-c0-verification-cleanup-20260921';
const base='https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth';
const origin='http://localhost:4173';

function cookies(response) {
  const rows=typeof response.headers.getSetCookie==='function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return rows.flatMap(row=>String(row).split(/,(?=\\s*[^;,]+=)/))
    .map(row=>row.split(';')[0].trim()).filter(Boolean).join('; ');
}

async function call(path,{body,cookie}={}) {
  const response=await fetch(base+path,{
    method:'POST',
    headers:{origin,accept:'application/json','content-type':'application/json',...(cookie?{cookie}:{})},
    body:JSON.stringify(body||{}),
    redirect:'manual',
  });
  const data=await response.json().catch(()=>({}));
  return {response,data,cookie:cookies(response)};
}

test('179C0 verification cleanup proof on isolated QA',{skip:!enabled,timeout:240000},async()=>{
  const adminEmail='qa-179c0-admin-20260921@example.com';
  const victimEmail='qa-179c0-victim-20260921@example.com';
  const adminPassword='Qa1!'+randomBytes(20).toString('base64url');
  const victimPassword='Qa1!'+randomBytes(20).toString('base64url');

  const admin=await call('/sign-up/email',{body:{name:'QA 179C0 Admin',email:adminEmail,password:adminPassword}});
  assert.equal(admin.response.status,200);
  const victim=await call('/sign-up/email',{body:{name:'QA 179C0 Victim',email:victimEmail,password:victimPassword}});
  assert.equal(victim.response.status,200);
  const adminId=String(admin.data?.user?.id||'');
  const victimId=String(victim.data?.user?.id||'');
  assert.match(adminId,/^[0-9a-f-]{36}$/i);
  assert.match(victimId,/^[0-9a-f-]{36}$/i);

  const reset=await call('/request-password-reset',{body:{email:victimEmail,redirectTo:'http://localhost:4173/reset-password/'}});
  assert.equal(reset.response.status,200);
  console.log(JSON.stringify({label:'qa-179c0-ready-for-role-promotion',adminId,victimId,adminEmail,victimEmail,resetStatus:reset.response.status}));

  await new Promise(resolve=>setTimeout(resolve,120000));

  const signin=await call('/sign-in/email',{body:{email:adminEmail,password:adminPassword,rememberMe:true}});
  assert.equal(signin.response.status,200);
  const removed=await call('/admin/remove-user',{cookie:signin.cookie,body:{userId:victimId}});
  console.log(JSON.stringify({label:'qa-179c0-remove-user',victimId,status:removed.response.status,ok:removed.response.ok,code:removed.data?.code||null,message:removed.data?.message||removed.data?.error||null}));
  assert.equal(removed.response.status,200);
});
