import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const base='https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth';
const origin='http://localhost:4173';
const project='late-fire-55708539';
const branch='br-super-snow-b5ufhq30';
const neon=process.env.NEON_BIN;
const databaseUrl=process.env.QA_DATABASE_URL;
if(!neon||!databaseUrl||!process.env.NEON_API_KEY) throw new Error('QA probe runtime is not configured.');

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
function cli(args,{allowFailure=false}={}){
  const r=spawnSync(neon,args,{encoding:'utf8',env:process.env});
  if(!allowFailure&&r.status!==0)throw new Error('Neon CLI failed with status '+r.status+'.');
  return r;
}
function resetRows(userId){
  assert.match(userId,/^[0-9a-f-]{36}$/i);
  const sql=`SELECT count(*) FROM neon_auth.verification WHERE value='${userId}' AND identifier LIKE 'reset-password:%';`;
  const r=spawnSync('psql',[databaseUrl,'-X','-A','-t','-c',sql],{encoding:'utf8',env:{...process.env,PGAPPNAME:'pack1-179c0-verification-probe'}});
  if(r.status!==0)throw new Error('Verification-row query failed.');
  const n=Number(String(r.stdout||'').trim());
  if(!Number.isInteger(n)||n<0)throw new Error('Invalid verification-row count.');
  return n;
}

const stamp=Date.now();
const adminEmail=`qa-179c0-admin-${stamp}@packone.pro`;
const victimEmail=`qa-179c0-victim-${stamp}@packone.pro`;
const adminPassword='Qa1!'+randomBytes(24).toString('base64url');
const victimPassword='Qa1!'+randomBytes(24).toString('base64url');
let adminId='',victimId='';

try{
  const admin=await call('/sign-up/email',{body:{name:'QA 179C0 Admin',email:adminEmail,password:adminPassword}});
  assert.equal(admin.response.status,200);
  adminId=String(admin.data?.user?.id||'');
  assert.match(adminId,/^[0-9a-f-]{36}$/i);
  assert.ok(admin.cookie.includes('neon-auth.session_token='));

  const victim=await call('/sign-up/email',{body:{name:'QA 179C0 Victim',email:victimEmail,password:victimPassword}});
  assert.equal(victim.response.status,200);
  victimId=String(victim.data?.user?.id||'');
  assert.match(victimId,/^[0-9a-f-]{36}$/i);

  cli(['neon-auth','user','set-role',adminId,'--roles','admin','--project-id',project,'--branch',branch]);
  const session=await call('/get-session',{method:'GET',cookie:admin.cookie});
  assert.equal(session.response.status,200);
  assert.match(String(session.data?.user?.role||''),/(^|,)admin(,|$)/);

  const reset=await call('/request-password-reset',{body:{email:victimEmail,redirectTo:'http://localhost:4173/reset-password/'}});
  assert.equal(reset.response.status,200);
  const before=resetRows(victimId);
  assert.ok(before>=1);

  const removed=await call('/admin/remove-user',{cookie:admin.cookie,body:{userId:victimId}});
  assert.equal(removed.response.status,200);
  assert.equal(removed.data?.success,true);
  const after=resetRows(victimId);

  const signin=await call('/sign-in/email',{body:{email:victimEmail,password:victimPassword,rememberMe:true}});
  assert.equal(signin.response.status,401);
  const repeated=await call('/admin/remove-user',{cookie:admin.cookie,body:{userId:victimId}});
  assert.equal(repeated.response.status,404);

  console.log(JSON.stringify({
    label:'qa-179c0-verification-cleanup',
    adminRemoveStatus:removed.response.status,
    victimSigninAfterStatus:signin.response.status,
    repeatRemoveStatus:repeated.response.status,
    resetRowsBefore:before,
    resetRowsAfter:after,
    resetRowsCleanedByAdminRemove:after===0
  }));
}finally{
  if(victimId)cli(['neon-auth','user','delete',victimId,'--project-id',project,'--branch',branch],{allowFailure:true});
  if(adminId)cli(['neon-auth','user','delete',adminId,'--project-id',project,'--branch',branch],{allowFailure:true});
}
