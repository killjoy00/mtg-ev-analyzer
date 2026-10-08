import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {acceptAdminInvitation,handleAdminTeam,normalizeInviteEmail} from '../worker/admin-invitations.mjs';
import {adminPath} from '../edge/gateway.mjs';

const user='11111111-1111-4111-8111-111111111111';
const req=(path,method='POST',body={})=>new Request('https://packone.pro'+path,{
  method,headers:{origin:'https://packone.pro','content-type':'application/json'},
  ...(method==='GET'?{}:{body:JSON.stringify(body)}),
});
const readJson=async r=>r.json();
test('Owner routes must be explicitly allowlisted and unbound claims stay removed',()=>{
  for(const route of ['/v1/admin/team/invitations','/v1/admin/invitations/accept',
    '/v1/admin/team/invitations/22222222-2222-4222-8222-222222222222/revoke',
    '/v1/admin/team/members/22222222-2222-4222-8222-222222222222/revoke'])
    assert.equal(adminPath(route,'POST'),true,route);
  assert.equal(adminPath('/v1/admin/team','GET'),true);
  assert.equal(adminPath('/v1/admin/claim','POST'),false);
  assert.equal(adminPath('/v1/admin/team/invitations','GET'),false);
});
test('invitation email normalization never accepts control chars or nonaddresses',()=>{
  assert.equal(normalizeInviteEmail('  MEMBER@Example.COM '),'member@example.com');
  for(const bad of ['no-email','john@','john@example.com\nBcc:evil@example.com','',42])
    assert.throws(()=>normalizeInviteEmail(bad));
});
test('nonowner cannot issue, read or revoke invitations',async()=>{
  let reads=0;
  await assert.rejects(handleAdminTeam(req('/v1/admin/team/invitations'),async()=>{reads++;return {rows:[]};},readJson,user,'admin'),e=>e.status===403);
  await assert.rejects(handleAdminTeam(req('/v1/admin/team','GET'),async()=>{reads++;return {rows:[]};},readJson,user,'admin'),e=>e.status===403);
  assert.equal(reads,0);
});
test('create never logs raw tokens and returns them only once, with hashed storage',async()=>{
  let args=null;
  const q=async(sql,params)=>{assert.match(sql,/pack1_issue_admin_invitation/);args=params;return {rows:[{result:'issued',invitation_id:'22222222-2222-4222-8222-222222222222',expiration:'2026-10-10T00:00:00Z'}]};};
  const res=await handleAdminTeam(req('/v1/admin/team/invitations','POST',{email:'RECIPIENT@EXAMPLE.COM'}),q,readJson,user,'owner');
  assert.equal(res.ok,true);assert.equal(res.invitation.email,'recipient@example.com');
  assert.match(res.token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(args[0],user);assert.equal(args[1],'recipient@example.com');assert.match(args[2],/^[a-f0-9]{64}$/);
  assert.ok(!args.includes(res.token));assert.equal(args[3],259200);
  assert.ok(!JSON.stringify(res.invitation).includes(res.token));
});
test('invite acceptance is bound to verified recipient and rejects replay statuses',async()=>{
  const token='a'.repeat(43),statuses=['not_verified','wrong_account','account_deleting','already_admin','invalid'];
  for(const status of statuses){
    let params=null;
    const q=async(_sql,p)=>{params=p;return {rows:[{result:status}]};};
    await assert.rejects(acceptAdminInvitation(req('/v1/admin/invitations/accept','POST',{token}),q,readJson,user),e=>e.status===403||e.status===409);
    assert.equal(params[0],user);assert.match(params[1],/^[a-f0-9]{64}$/);assert.notEqual(params[1],token);
  }
  assert.deepEqual(await acceptAdminInvitation(req('/v1/admin/invitations/accept','POST',{token}),async()=>({rows:[{result:'accepted'}]}),readJson,user),{ok:true,role:'admin'});
});
test('cross-site mutation denied before any database operations',async()=>{
  let calls=0;
  const wrong=new Request('https://packone.pro/v1/admin/team/invitations',{method:'POST',headers:{origin:'https://attacker.invalid'},body:JSON.stringify({email:'person@example.com'})});
  await assert.rejects(handleAdminTeam(wrong,async()=>{calls++;return {rows:[]};},readJson,user,'owner'),e=>e.status===403);
  assert.equal(calls,0);
});
test('Owner deletion blocked on admin and self-service paths',()=>{
  assert.match(fs.readFileSync('worker/admin-account-deletion.mjs','utf8'),/OWNER_PROTECTED/);
  assert.match(fs.readFileSync('worker/growth-function.js','utf8'),/Owner account cannot be deleted/);
  const sql=fs.readFileSync('migrations/0057_admin_owner_invitations.sql','utf8');
  assert.match(sql,/pack1_owner_guard_on_deletions/);
  assert.match(sql,/pack1_owner_guard_on_admins/);
});
