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
  growthUrl:'https://api.packone.pro/growth',
  draftRunUrl:'https://api.packone.pro/draft',
}};
let assigned=null;
globalThis.location={assign:url=>{assigned=String(url);}};
globalThis.dispatchEvent=()=>{};
const calls=[];
globalThis.fetch=async(url,options={})=>{
  const u=new URL(url),path=u.pathname,headers=new Headers(options.headers||{});
  calls.push({path,method:options.method||'GET',headers,credentials:options.credentials,body:options.body});
  if(path==='/growth/v1/player/migrate')return Response.json({ok:true,migrated:true});
  if(path==='/growth/v1/player/session')return Response.json({ok:true,playerId:'player'});
  if(path==='/growth/v1/account/migrate')return Response.json({ok:true,migrated:true,user:{id:'user',email:'qa@example.invalid',name:'QA'}});
  if(path==='/growth/v1/account/session')return Response.json({user:{id:'user',email:'qa@example.invalid',name:'QA'},session:{expiresAt:'2099-01-01T00:00:00Z'}});
  if(path==='/growth/v1/profile')return Response.json({player:{display_name:'QA Changed'}});
  if(path==='/growth/v1/account/google/start')return Response.json({url:'https://accounts.google.com/o/oauth2/v2/auth?client_id=fixture'});
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
});

test('first-party writes use CSRF without exposing an account bearer',async()=>{
  await auth.updateProfile({displayName:'QA Changed'});
  const call=calls.findLast(row=>row.path==='/growth/v1/profile');
  assert.equal(call.headers.get('x-pack1-csrf'),'c'.repeat(43));
  assert.equal(call.headers.has('x-pack1-auth-session'),false);
  assert.equal(auth.storedAccountToken(),'first-party');
});

test('Google starts through the first-party account endpoint',async()=>{
  await auth.startGoogleSignIn();
  const call=calls.findLast(row=>row.path==='/growth/v1/account/google/start');
  assert.equal(call.method,'POST');
  assert.equal(call.credentials,'include');
  assert.match(assigned,/^https:\/\/accounts\.google\.com\//);
});
