import assert from 'node:assert/strict';
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto';

const DB=process.env.QA_DATABASE_URL;
const APP=process.env.QA_FUNCTION_BASE;
const AUTH=process.env.QA_AUTH_BASE;
const ORIGIN='http://localhost:4173';
const RATE_SECRET=process.env.QA_RATE_LIMIT_SECRET;
const RUN=String(process.env.GITHUB_RUN_ID||Date.now()).replace(/[^0-9]/g,'').slice(-12);
const mainEmail='ryanmindell+pack1-179a-'+RUN+'@gmail.com';
const googleEmail='ryanmindell+pack1-googleqa-'+RUN+'@gmail.com';
const rateEmail='absent-'+RUN+'@example.invalid';
const password1='QaA1!'+randomBytes(20).toString('hex');
const password2='QaB2!'+randomBytes(20).toString('hex');
const RESET_MESSAGE="If an account exists for that email, we've sent a password reset link.";

assert.ok(DB&&APP&&AUTH&&RATE_SECRET,'QA environment is incomplete');
assert.ok(RATE_SECRET.length>=32,'QA rate-limit secret is too short');

function dbApiUrl() {
  const u=new URL(DB);
  const parts=u.hostname.split('.');
  parts[0]='api';
  return 'https://'+parts.join('.')+'/sql';
}

async function sql(query,params=[]) {
  const r=await fetch(dbApiUrl(),{
    method:'POST',
    headers:{
      'content-type':'application/json',
      'Neon-Connection-String':DB,
      'Neon-Raw-Text-Output':'true',
      'Neon-Array-Mode':'true',
    },
    body:JSON.stringify({query,params:params.map(v=>v==null?null:String(v))}),
    signal:AbortSignal.timeout(30000),
  });
  const text=await r.text();
  assert.equal(r.ok,true,'QA SQL failed with HTTP '+r.status);
  const data=JSON.parse(text);
  const fields=(data.fields||[]).map(f=>f.name);
  return {
    rows:(data.rows||[]).map(row=>Object.fromEntries(row.map((v,i)=>[fields[i],v]))),
    rowCount:Number(data.rowCount||0),
  };
}

async function app(path,body,{origin=ORIGIN}={}) {
  const r=await fetch(APP+path,{
    method:'POST',
    headers:{origin,'content-type':'application/json'},
    body:JSON.stringify(body),
    redirect:'manual',
    signal:AbortSignal.timeout(30000),
  });
  const text=await r.text();
  let data={};
  try { data=JSON.parse(text); } catch {}
  return {status:r.status,data};
}

async function auth(path,body) {
  const r=await fetch(AUTH+path,{
    method:'POST',
    headers:{origin:ORIGIN,'content-type':'application/json'},
    body:JSON.stringify(body),
    redirect:'manual',
    signal:AbortSignal.timeout(30000),
  });
  const text=await r.text();
  let data={};
  try { data=JSON.parse(text); } catch {}
  return {status:r.status,data};
}

async function userId(email) {
  const q=await sql('SELECT id::text id FROM neon_auth."user" WHERE email=$1 LIMIT 1',[email]);
  return q.rows[0]?.id||null;
}

async function cleanupEmail(email) {
  const id=await userId(email);
  if(!id)return;
  await sql('DELETE FROM account_sessions WHERE auth_user_id=$1::uuid',[id]);
  await sql('DELETE FROM neon_auth.verification WHERE value=$1',[id]);
  await sql('DELETE FROM neon_auth.session WHERE "userId"=$1::uuid',[id]);
  await sql('DELETE FROM neon_auth.account WHERE "userId"=$1::uuid',[id]);
  await sql('DELETE FROM neon_auth."user" WHERE id=$1::uuid',[id]);
}

function rateKey(email) {
  return createHmac('sha256',RATE_SECRET).update(email.trim().toLowerCase()).digest('hex');
}

async function latestResetToken(id) {
  const q=await sql('SELECT identifier FROM neon_auth.verification WHERE value=$1 AND identifier LIKE \'reset-password:%\' ORDER BY "createdAt" DESC LIMIT 1',[id]);
  const identifier=String(q.rows[0]?.identifier||'');
  assert.equal(identifier.startsWith('reset-password:'),true,'Reset verification was not created');
  const token=identifier.slice('reset-password:'.length);
  assert.match(token,/^[A-Za-z0-9._~-]{16,2048}$/);
  return {identifier,token};
}

async function activeSessions(id) {
  const q=await sql('SELECT count(*)::int count FROM account_sessions WHERE auth_user_id=$1::uuid AND revoked_at IS NULL AND expires_at>now()',[id]);
  return Number(q.rows[0]?.count||0);
}

async function packSignin(email,password) {
  const r=await app('/v1/account/signin',{email,password});
  assert.equal(r.status,200,'Pack One sign-in failed with HTTP '+r.status);
}

const cleanupKeys=new Set([rateKey(mainEmail),rateKey(googleEmail),rateKey(rateEmail)]);

try {
  await cleanupEmail(mainEmail);
  await cleanupEmail(googleEmail);
  for(const key of cleanupKeys)await sql('DELETE FROM account_recovery_rate_limits WHERE limit_key=$1',[key]);

  const signup=await auth('/sign-up/email',{name:'Pack One 179A QA',email:mainEmail,password:password1});
  assert.ok([200,201].includes(signup.status),'QA signup failed with HTTP '+signup.status);
  const mainId=await userId(mainEmail);
  assert.match(String(mainId),/^[0-9a-f-]{36}$/i);

  const resetRequest=await app('/v1/account/request-password-reset',{
    email:mainEmail,
    redirectTo:'https://evil.example/reset',
    callbackURL:'https://evil.example/callback',
    url:'https://evil.example/',
  });
  assert.equal(resetRequest.status,200);
  assert.equal(resetRequest.data.message,RESET_MESSAGE);
  const first=await latestResetToken(mainId);

  await packSignin(mainEmail,password1);
  await packSignin(mainEmail,password1);
  assert.ok((await activeSessions(mainId))>=2,'Expected multiple active Pack One sessions before reset');

  const reset=await app('/v1/account/reset-password',{token:first.token,newPassword:password2});
  assert.equal(reset.status,200,'Successful reset failed with HTTP '+reset.status);
  assert.equal(await activeSessions(mainId),0,'Successful reset did not revoke all Pack One sessions');

  const reused=await app('/v1/account/reset-password',{token:first.token,newPassword:password2});
  assert.equal(reused.status,400,'Reused reset token was accepted');

  const oldLogin=await auth('/sign-in/email',{email:mainEmail,password:password1,rememberMe:true});
  assert.equal(oldLogin.status>=400,true,'Old password still authenticates after reset');
  const newLogin=await auth('/sign-in/email',{email:mainEmail,password:password2,rememberMe:true});
  assert.ok(newLogin.status>=200&&newLogin.status<300,'New password was not accepted');

  await packSignin(mainEmail,password2);
  await packSignin(mainEmail,password2);
  const beforeInvalid=await activeSessions(mainId);
  assert.ok(beforeInvalid>=2,'Expected active sessions for negative reset tests');

  const malformed=await app('/v1/account/reset-password',{token:'short',newPassword:password2});
  assert.equal(malformed.status,400);
  assert.equal(await activeSessions(mainId),beforeInvalid,'Malformed token revoked sessions');

  const ambiguous=await app('/v1/account/reset-password',{token:'A'.repeat(32),newPassword:password2});
  assert.equal(ambiguous.status,400);
  assert.equal(await activeSessions(mainId),beforeInvalid,'Unknown valid-looking token revoked sessions');

  const secondRequest=await app('/v1/account/request-password-reset',{email:mainEmail});
  assert.equal(secondRequest.status,200);
  const second=await latestResetToken(mainId);
  await sql('UPDATE neon_auth.verification SET "expiresAt"=now()-interval \'1 minute\' WHERE identifier=$1',[second.identifier]);
  const expired=await app('/v1/account/reset-password',{token:second.token,newPassword:password1});
  assert.equal(expired.status,400,'Expired token was accepted');
  assert.equal(expired.data.code,'EXPIRED_RESET');
  assert.equal(await activeSessions(mainId),beforeInvalid,'Expired reset revoked sessions');

  const evilOrigin=await app('/v1/account/request-password-reset',{email:mainEmail},{origin:'https://evil.example'});
  assert.equal(evilOrigin.status,403,'Untrusted origin was accepted');

  for(let i=1;i<=6;i++) {
    const r=await app('/v1/account/request-password-reset',{email:rateEmail,redirectTo:'https://evil.example/'+i});
    assert.equal(r.status,i<=5?200:429,'Unexpected rate-limit status at attempt '+i);
  }
  const hmac=rateKey(rateEmail);
  const plain=createHash('sha256').update(rateEmail).digest('hex');
  assert.notEqual(hmac,plain,'Limiter identity unexpectedly equals plain SHA-256');
  const limiter=await sql('SELECT limit_key,attempts,expires_at FROM account_recovery_rate_limits WHERE limit_key=$1',[hmac]);
  assert.equal(limiter.rows.length,1);
  assert.equal(limiter.rows[0].limit_key,hmac);
  assert.equal(Number(limiter.rows[0].attempts),6);
  const cols=await sql("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='account_recovery_rate_limits' ORDER BY ordinal_position");
  assert.deepEqual(cols.rows.map(r=>r.column_name),['limit_key','attempts','expires_at']);

  const dummy='f'.repeat(64);
  await sql("INSERT INTO account_recovery_rate_limits(limit_key,attempts,expires_at) VALUES($1,1,now()-interval '1 minute') ON CONFLICT(limit_key) DO UPDATE SET attempts=1,expires_at=EXCLUDED.expires_at",[dummy]);
  await sql("UPDATE account_recovery_rate_limits SET expires_at=now()-interval '1 minute' WHERE limit_key=$1",[hmac]);
  const afterExpiry=await app('/v1/account/request-password-reset',{email:rateEmail});
  assert.equal(afterExpiry.status,200);
  const limiterReset=await sql('SELECT attempts FROM account_recovery_rate_limits WHERE limit_key=$1',[hmac]);
  assert.equal(Number(limiterReset.rows[0]?.attempts),1,'Expired limiter did not reset');
  const dummyLeft=await sql('SELECT count(*)::int count FROM account_recovery_rate_limits WHERE limit_key=$1',[dummy]);
  assert.equal(Number(dummyLeft.rows[0]?.count||0),0,'Expired limiter cleanup did not run');

  const googleId=randomUUID();
  await sql('INSERT INTO neon_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1::uuid,$2,$3,true,now(),now())',[googleId,'Pack One Google-only QA',googleEmail]);
  await sql('INSERT INTO neon_auth.account("accountId","providerId","userId","updatedAt") VALUES($1,$2,$3::uuid,now())',['google-qa-'+RUN,'google',googleId]);
  const googleReset=await app('/v1/account/request-password-reset',{email:googleEmail,redirectTo:'https://evil.example/google'});
  assert.equal(googleReset.status,200,'Google-only reset request leaked provider-specific failure');
  assert.equal(googleReset.data.message,RESET_MESSAGE);
  const googleAccounts=await sql('SELECT "providerId" provider_id,password FROM neon_auth.account WHERE "userId"=$1::uuid ORDER BY "providerId"',[googleId]);
  assert.equal(googleAccounts.rows.length,1,'Google-only request changed linked providers');
  assert.equal(googleAccounts.rows[0].provider_id,'google');
  assert.equal(googleAccounts.rows[0].password,null);

  console.log(JSON.stringify({
    issue_179a_live_qa:'passed',
    real_reset_and_password_change:true,
    multi_session_revocation:true,
    failed_resets_preserve_sessions:true,
    reused_and_malformed_tokens_rejected:true,
    malicious_origin_rejected:true,
    hmac_rate_limit_and_cleanup:true,
    google_only_account_safe:true,
    hostile_browser_redirect_fields_ignored_by_app_boundary:true
  }));
} finally {
  try { await cleanupEmail(mainEmail); } catch {}
  try { await cleanupEmail(googleEmail); } catch {}
  for(const key of cleanupKeys) {
    try { await sql('DELETE FROM account_recovery_rate_limits WHERE limit_key=$1',[key]); } catch {}
  }
  try { await sql('DELETE FROM account_recovery_rate_limits WHERE limit_key=$1',['f'.repeat(64)]); } catch {}
}
