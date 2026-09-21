import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';

const base='https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth';
const origin='http://localhost:4173';

function cookies(response){
  const rows=typeof response.headers.getSetCookie==='function'?response.headers.getSetCookie():[response.headers.get('set-cookie')].filter(Boolean);
  return rows.flatMap(row=>String(row).split(/,(?=\\s*[^;,]+=)/)).map(row=>row.split(';')[0].trim()).filter(Boolean).join('; ');
}
async function call(path,{method='POST',body,cookie}={}){
  const headers={origin,accept:'application/json'};
  if(body!==undefined)headers['content-type']='application/json';
  if(cookie)headers.cookie=cookie;
  const response=await fetch(base+path,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{}),redirect:'manual'});
  const data=await response.json().catch(()=>({}));
  return {response,data,cookie:cookies(response)};
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

const stamp=Date.now();
const adminEmail=`qa-179c0-admin-${stamp}@example.com`;
const victimEmail=`qa-179c0-victim-${stamp}@example.com`;
const adminPassword='Qa1!'+randomBytes(24).toString('base64url');
const victimPassword='Qa1!'+randomBytes(24).toString('base64url');

const admin=await call('/sign-up/email',{body:{name:'QA 179C0 Admin',email:adminEmail,password:adminPassword}});
assert.equal(admin.response.status,200);
const adminId=String(admin.data?.user?.id||'');
assert.match(adminId,/^[0-9a-f-]{36}$/i);
assert.ok(admin.cookie.includes('neon-auth.session_token='));

const victim=await call('/sign-up/email',{body:{name:'QA 179C0 Victim',email:victimEmail,password:victimPassword}});
assert.equal(victim.response.status,200);
const victimId=String(victim.data?.user?.id||'');
assert.match(victimId,/^[0-9a-f-]{36}$/i);

const reset=await call('/request-password-reset',{body:{email:victimEmail,redirectTo:'http://localhost:4173/reset-password/'}});
assert.equal(reset.response.status,200);
console.log(JSON.stringify({label:'qa-179c0-setup',adminId,victimId,resetStatus:reset.response.status}));

let role='';
for(let i=0;i<60;i++){
  const session=await call('/get-session',{method:'GET',cookie:admin.cookie});
  role=String(session.data?.user?.role||'');
  if(/(^|,)admin(,|$)/.test(role))break;
  await sleep(5000);
}
assert.match(role,/(^|,)admin(,|$)/,'Temporary QA principal was not promoted to admin in time.');

const removed=await call('/admin/remove-user',{cookie:admin.cookie,body:{userId:victimId}});
assert.equal(removed.response.status,200);
assert.equal(removed.data?.success,true);
const signin=await call('/sign-in/email',{body:{email:victimEmail,password:victimPassword,rememberMe:true}});
assert.equal(signin.response.status,401);
const repeated=await call('/admin/remove-user',{cookie:admin.cookie,body:{userId:victimId}});
assert.equal(repeated.response.status,404);

console.log(JSON.stringify({
  label:'qa-179c0-delete-result',
  adminRemoveStatus:removed.response.status,
  victimSigninAfterStatus:signin.response.status,
  repeatRemoveStatus:repeated.response.status
}));
