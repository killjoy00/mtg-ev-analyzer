import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';

const enabled=process.env.GITHUB_HEAD_REF==='ops/179c-delete-postcheck';
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
    method:body===undefined?'GET':'POST',
    headers:{origin,accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie}:{})},
    body:body===undefined?undefined:JSON.stringify(body),
    redirect:'manual',
  });
  const text=await response.text();
  let data={};try{data=JSON.parse(text);}catch{}
  return {response,data,cookie:cookies(response),text};
}

test('179C Gate 1 postcheck: determine whether delete-user 404 still deletes QA user',{skip:!enabled,timeout:30000},async()=>{
  const stamp=Date.now(),email=`qa-179c-postcheck-${stamp}@example.com`;
  const password='Qa1!'+randomBytes(20).toString('base64url');
  const signup=await call('/sign-up/email',{body:{name:'QA 179C Postcheck',email,password}});
  assert.equal(signup.response.status,200);
  const userId=String(signup.data?.user?.id||'');
  assert.match(userId,/^[0-9a-f-]{36}$/i);

  const deleted=await call('/delete-user',{cookie:signup.cookie,body:{password}});
  const signin=await call('/sign-in/email',{body:{email,password,rememberMe:true}});
  const session=await call('/get-session',{cookie:signup.cookie});
  console.log(JSON.stringify({
    label:'qa-179c-delete-postcheck',
    userId,
    deleteStatus:deleted.response.status,
    deleteOk:deleted.response.ok,
    deleteCode:deleted.data?.code||null,
    deleteMessage:deleted.data?.message||deleted.data?.error||null,
    signinAfterDeleteStatus:signin.response.status,
    signinAfterDeleteOk:signin.response.ok,
    originalSessionStatus:session.response.status,
    originalSessionHasUser:Boolean(session.data?.user),
  }));
});
