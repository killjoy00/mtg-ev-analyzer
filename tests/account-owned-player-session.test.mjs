import test from 'node:test';
import assert from 'node:assert/strict';
import {requireOwnedPlayerSession} from '../worker/account-identity.mjs';
import {digest} from '../worker/account-session.mjs';

const PLAYER='11111111-1111-4111-8111-111111111111';
const OWNER='22222222-2222-4222-8222-222222222222';
const OTHER='33333333-3333-4333-8333-333333333333';
const LIVE='a'.repeat(43),STALE='b'.repeat(43),WRONG='c'.repeat(43),CSRF='d'.repeat(43);
function fixture({linked=true,duplicate=false,offline=false}={}){
 const calls=[];
 const query=async(sql,params)=>{
  calls.push({sql,params});
  if(sql.includes('FROM account_links'))return {rows:linked?[{auth_user_id:OWNER},...(duplicate?[{auth_user_id:OTHER}]:[])]:[]};
  if(offline)throw Object.assign(Error('Temporary database outage'),{status:503});
  if(sql.includes('FROM account_sessions')){
   if(params[0]===digest(LIVE))return {rows:[{user_id:OWNER,csrf_hash:digest(CSRF)}]};
   if(params[0]===digest(WRONG))return {rows:[{user_id:OTHER,csrf_hash:digest(CSRF)}]};
   return {rows:[]};
  }
  if(sql.includes('FROM neon_auth.session'))return {rows:params[0]==='legacy-live'?[{user_id:OWNER}]:[]};
  throw Error('Unexpected query: '+sql);
 };
 return {query,calls};
}
const req=(headers={},method='GET')=>new Request('https://packone.pro/v1/daily-status',{method,headers});
const native=token=>({'x-pack1-mobile-account':token});
const cookie=token=>({cookie:'__Host-pack1_account='+token});
const reject401=error=>error.status===401;

test('unclaimed guests retain anonymous play with no account session lookup',async()=>{
 const f=fixture({linked:false});
 assert.equal(await requireOwnedPlayerSession(req(),f.query,PLAYER),null);
 assert.equal(f.calls.length,1);
});
test('account-owned player with no active account cannot read or write gameplay',async()=>{
 const f=fixture();
 for(const method of ['GET','POST'])await assert.rejects(requireOwnedPlayerSession(req({},method),f.query,PLAYER),reject401);
});
test('revoked, malformed and mismatched native credentials are rejected',async()=>{
 const f=fixture();
 for(const token of [STALE,WRONG,'bad'])await assert.rejects(requireOwnedPlayerSession(req(native(token)),f.query,PLAYER),reject401);
 assert.equal((await requireOwnedPlayerSession(req(native(LIVE),'POST'),f.query,PLAYER)).user_id,OWNER);
});
test('browser reads require live matching account and writes additionally require CSRF',async()=>{
 const f=fixture();
 for(const token of [STALE,WRONG])await assert.rejects(requireOwnedPlayerSession(req(cookie(token)),f.query,PLAYER),reject401);
 assert.equal((await requireOwnedPlayerSession(req(cookie(LIVE)),f.query,PLAYER)).user_id,OWNER);
 await assert.rejects(requireOwnedPlayerSession(req(cookie(LIVE),'POST'),f.query,PLAYER),e=>e.status===403);
 assert.equal((await requireOwnedPlayerSession(req({...cookie(LIVE),'x-pack1-csrf':CSRF},'POST'),f.query,PLAYER)).user_id,OWNER);
 assert.equal((await requireOwnedPlayerSession(req(cookie(LIVE),'POST'),f.query,PLAYER,{csrf:false})).user_id,OWNER);
});
test('valid legacy account migration credential remains supported',async()=>{
 const f=fixture();
 assert.equal((await requireOwnedPlayerSession(req({'x-pack1-auth-session':'legacy-live'}),f.query,PLAYER)).user_id,OWNER);
});
test('ambiguous linked player fails closed and temporary errors are not disguised as logout',async()=>{
 const f=fixture({duplicate:true});
 await assert.rejects(requireOwnedPlayerSession(req(native(LIVE)),f.query,PLAYER),reject401);
 await assert.rejects(requireOwnedPlayerSession(req(native(LIVE)),fixture({offline:true}).query,PLAYER),e=>e.status===503);
});
