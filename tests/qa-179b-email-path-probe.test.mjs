import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';

const enabled=process.env.GITHUB_HEAD_REF==='ops/179b-email-path-probe';
const base='https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth';
const origin='http://localhost:4173';
function cookies(response){
  const rows=typeof response.headers.getSetCookie==='function'?response.headers.getSetCookie():[response.headers.get('set-cookie')].filter(Boolean);
  return rows.map(x=>String(x).split(';')[0]).join('; ');
}
async function call(path,{body,cookie}={}){
  const response=await fetch(base+path,{method:'POST',headers:{origin,'content-type':'application/json',accept:'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(body||{}),redirect:'manual'});
  const data=await response.json().catch(()=>({}));
  return {response,data,cookie:cookies(response)};
}
test('probe supported Neon email mutation paths',{skip:!enabled,timeout:30000},async()=>{
  const stamp=Date.now(),email=`qa-179b-email-${stamp}@example.com`,target=`qa-179b-email-new-${stamp}@example.com`;
  const password='Qa1!'+randomBytes(18).toString('base64url');
  const signup=await call('/sign-up/email',{body:{name:'QA Email Probe',email,password}});
  assert.equal(signup.response.status,200);
  console.log(JSON.stringify({label:'fixture',userId:signup.data?.user?.id||null,email,target}));
  const update=await call('/update-user',{cookie:signup.cookie,body:{email:target}});
  console.log(JSON.stringify({label:'update-user-email',status:update.response.status,keys:Object.keys(update.data||{}).sort(),message:update.data?.message||null,code:update.data?.code||null,userEmail:update.data?.user?.email||null}));
  const signinOld=await call('/sign-in/email',{body:{email,password,rememberMe:true}});
  const signinNew=await call('/sign-in/email',{body:{email:target,password,rememberMe:true}});
  console.log(JSON.stringify({label:'post-update-signin',oldStatus:signinOld.response.status,newStatus:signinNew.response.status,newUserId:signinNew.data?.user?.id||null}));
});
