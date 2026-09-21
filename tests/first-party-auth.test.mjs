import test from 'node:test';
import assert from 'node:assert/strict';

const store=new Map([
  ['pack1-api-session-v1','p1_00000000-0000-4000-8000-000000000000.'+'p'.repeat(43)],
  ['pack1-auth-session-v1','legacy-auth-token'],
  ['pack1-player-name-v1','QA Player'],
]);
globalThis.localStorage={
  getItem:key=>store.has(key)?store.get(key):null,
  setItem:(key,value)=>store.set(key,String(value)),
  removeItem:key=>store.delete(key),
};
globalThis.document={cookie:'__Secure-pack1_csrf='+'c'.repeat(43)};
globalThis.window={PACK1_API:{
  firstParty:true,
  authBase:'https://ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth',
  growthUrl:'https://api.packone.pro/growth',
  draftRunUrl:'https://api.packone.pro/draft',
}};
let assigned=null;
globalThis.location={href:'https://packone.pro/?auth=google&neon_auth_session_verifier=fixture-verifier',assign:url=>{assigned=String(url);}};
globalThis.dispatchEvent=()=>{};
const calls=[];
globalThis.fetch=async(url,options={})=>{
  const u=new URL(url),path=u.pathname,headers=new Headers(options.headers||{});
  calls.push({host:u.host,path,method:options.method||'GET',headers,credentials:options.credentials,body:options.body});
  if(path==='/growth/v1/player/migrate')return Response.json({ok:true,migrated:true});
  if(path==='/growth/v1/player/session')return Response.json({ok:true,playerId:'player'});
  if(path==='/growth/v1/account/migrate')return Response.json({ok:true,migrated:true,user:{id:'user',email:'qa@example.invalid',name:'QA'}});
  if(path==='/growth/v1/account/session')return Response.json({user:{id:'user',email:'qa@example.invalid',name:'QA'},session:{expiresAt:'2099-01-01T00:00:00Z'}});
  if(path==='/growth/v1/profile')return Response.json({player:{display_name:'QA Changed'}});
  if(path==='/growth/v1/account/request-password-reset')return Response.json({ok:true,message:'generic'});
  if(path==='/growth/v1/account/reset-password')return Response.json({ok:true});
  if(path==='/pack1/auth/sign-in/social')return Response.json({url:'https://oauth.neon.tech/authorize?provider=google&state=fixture'});
  if(path==='/pack1/auth/get-session')return Response.json({session:{token:'google-neon-session',expiresAt:'2099-01-01T00:00:00Z'},user:{id:'google-user',email:'google@example.invalid',name:'Google QA'}});
  throw Error('Unexpected '+path);
};
const auth=await import('../growth-api.mjs');

test('first-party migration removes browser bearer credentials and uses credentialed cookies',async()=>{
  const session=await auth.getAuthSession();
  assert.equal(session.user.id,'user');
  assert.equal(store.has('pack1-api-session-v1'),false);
  assert.equal(store.has('pack1-auth-session-v1'),false);
  const playerMigration=calls.find(row=>row.path==='/growth/v1/player/migrate');
  assert.equal(playerMigration.headers.get('x-pack1-player-session')?.startsWith('p1_'),true);
  const accountMigration=calls.find(row=>row.path==='/growth/v1/account/migrate');
  assert.equal(accountMigration.headers.get('x-pack1-auth-session'),'legacy-auth-token');
  assert.equal(accountMigration.credentials,'include');
  const regular=calls.find(row=>row.path==='/growth/v1/account/session');
  assert.equal(regular.headers.has('x-pack1-auth-session'),false);
  assert.equal(regular.credentials,'include');
  const playerSessionCount=calls.filter(row=>row.path==='/growth/v1/player/session').length;
  await auth.ensurePackSession();
  await auth.ensurePackSession();
  assert.equal(calls.filter(row=>row.path==='/growth/v1/player/session').length,playerSessionCount,'first-party player session is reused for the page lifetime');
});

test('first-party writes use CSRF without exposing an account bearer',async()=>{
  await auth.updateProfile({displayName:'QA Changed'});
  const call=calls.findLast(row=>row.path==='/growth/v1/profile');
  assert.equal(call.headers.get('x-pack1-csrf'),'c'.repeat(43));
  assert.equal(call.headers.has('x-pack1-auth-session'),false);
  assert.equal(auth.storedAccountToken(),'first-party');
});

test('Google starts on Neon Auth and returns to Pack One with a verifier',async()=>{
  await auth.startGoogleSignIn();
  const call=calls.findLast(row=>row.path==='/pack1/auth/sign-in/social');
  assert.equal(call.host,'ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech');
  assert.equal(call.method,'POST');
  assert.equal(call.credentials,'include');
  const body=JSON.parse(call.body);
  assert.equal(body.provider,'google');
  assert.equal(body.callbackURL,'https://packone.pro/?auth=google');
  assert.equal(body.newUserCallbackURL,body.callbackURL);
  assert.equal(body.disableRedirect,true);
  assert.equal(assigned,'https://oauth.neon.tech/authorize?provider=google&state=fixture');
});

test('Google verifier is exchanged in the browser and immediately migrated to a first-party Pack One session',async()=>{
  const result=await auth.completeGoogleSignIn();
  assert.equal(result.user.id,'google-user');
  const exchange=calls.findLast(row=>row.path==='/pack1/auth/get-session');
  assert.equal(exchange.host,'ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech');
  assert.equal(exchange.credentials,'include');
  const migrate=calls.findLast(row=>row.path==='/growth/v1/account/migrate');
  assert.equal(migrate.headers.get('x-pack1-auth-session'),'google-neon-session');
  assert.equal(migrate.credentials,'include');
});


test('password recovery stays behind the Pack One first-party API and never accepts a browser redirect destination',async()=>{
  await auth.requestPasswordReset('qa@example.invalid');
  const request=calls.findLast(row=>row.path==='/growth/v1/account/request-password-reset');
  assert.equal(request.host,'api.packone.pro');
  assert.deepEqual(JSON.parse(request.body),{email:'qa@example.invalid'});
  await auth.resetPassword({token:'fixture-token-123456',newPassword:'new-password-123'});
  const reset=calls.findLast(row=>row.path==='/growth/v1/account/reset-password');
  assert.equal(reset.host,'api.packone.pro');
  assert.deepEqual(JSON.parse(reset.body),{token:'fixture-token-123456',newPassword:'new-password-123'});
});
