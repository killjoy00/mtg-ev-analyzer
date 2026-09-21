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

test('179C Gate 1 capability probe: application-facing delete-user on isolated QA',{skip:!enabled,timeout:30000},async()=>{
  const stamp=Date.now();
  const email=`qa-179c-delete-${stamp}@example.com`;
  const password='Qa1!'+randomBytes(20).toString('base64url');

  const signup=await call('/sign-up/email',{body:{name:'QA 179C Delete Probe',email,password}});
  assert.equal(signup.response.status,200);
  const userId=String(signup.data?.user?.id||'');
  assert.match(userId,/^[0-9a-f-]{36}$/i);

  const deleted=await call('/delete-user',{cookie:signup.cookie,body:{password}});
  console.log(JSON.stringify({
    label:'qa-179c-delete-capability',
    userId,
    deleteStatus:deleted.response.status,
    deleteOk:deleted.response.ok,
    code:deleted.data?.code||null,
    message:typeof deleted.data?.message==='string'?deleted.data.message.slice(0,160):null,
    error:typeof deleted.data?.error==='string'?deleted.data.error.slice(0,160):null,
  }));

  if(deleted.response.ok) {
    const signin=await call('/sign-in/email',{body:{email,password,rememberMe:true}});
    console.log(JSON.stringify({
      label:'qa-179c-delete-postcheck',
      signinAfterDeleteStatus:signin.response.status,
    }));
  }
});
