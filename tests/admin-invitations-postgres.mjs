// Runs ONLY after the disposable local PostgreSQL fixture was created.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {fixturePool} from './support/postgres-fixture.mjs';

const pool=fixturePool(),query=(text,values=[])=>pool.query(text,values);
const digest=value=>createHash('sha256').update(value).digest('hex');
const token=()=>randomBytes(32).toString('base64url');
let tests=0;
const check=(ok,message)=>{assert.ok(ok,message);tests++;};
async function auth(email,verified=true){
  const id=randomUUID();
  await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,$4)',[id,'Fixture admin invitation',email,verified]);
  return id;
}
async function create(actor,email,tok=token()){
  const result=(await query('SELECT * FROM pack1_issue_admin_invitation($1::uuid,$2,$3,$4::int)',
    [actor,email,digest(tok),259200])).rows[0];
  return {result,tok};
}
async function accept(id,tok){
  return (await query('SELECT pack1_accept_admin_invitation($1::uuid,$2) result',[id,digest(tok)])).rows[0].result;
}
async function revoke(owner,id){
  return (await query('SELECT pack1_revoke_admin_invitation($1::uuid,$2::uuid) result',[owner,id])).rows[0].result;
}
try {
  const suffix=randomUUID().slice(0,8);
  const owner=await auth('owner-'+suffix+'@example.invalid');
  const other=await auth('other-'+suffix+'@example.invalid');
  const unverified=await auth('unverified-'+suffix+'@example.invalid',false);
  await query('INSERT INTO pack1_admins(auth_user_id,role) VALUES($1::uuid,\'admin\'),($2::uuid,\'admin\'),($3::uuid,\'admin\')',[owner,other,unverified]);
  await query('UPDATE pack1_admins SET role=\'owner\' WHERE auth_user_id=$1::uuid',[owner]);
  check((await query('SELECT count(*)::int n FROM pack1_admins WHERE role=\'owner\'')).rows[0].n===1,'One explicit Owner exists');
  await assert.rejects(query('UPDATE pack1_admins SET role=\'owner\' WHERE auth_user_id=$1::uuid',[other]),e=>e.code==='23505');
  tests++;
  await assert.rejects(query('UPDATE pack1_admins SET role=\'owner\' WHERE auth_user_id=$1::uuid',[unverified]),e=>e.code==='23514');
  tests++;

  const one=await auth('member-'+suffix+'@example.invalid');
  const wrong=await auth('wrong-'+suffix+'@example.invalid');
  const unverifiedMember=await auth('pending-'+suffix+'@example.invalid',false);
  const denied=await create(other,'member-'+suffix+'@example.invalid');
  check(denied.result.result==='forbidden','Admins cannot issue invitations');
  const issued=await create(owner,'member-'+suffix+'@example.invalid');
  check(issued.result.result==='issued','Owner can issue invitation');
  const stored=(await query('SELECT token_hash,recipient_email FROM pack1_admin_invitations WHERE id=$1::uuid',[issued.result.invitation_id])).rows[0];
  check(stored.token_hash===digest(issued.tok)&&!stored.token_hash.includes(issued.tok),'Only token hash is persisted');
  check(await accept(wrong,issued.tok)==='wrong_account','Verified email must match recipient');
  check(await accept(unverifiedMember,issued.tok)==='not_verified','Unverified accounts cannot claim');

  const results=await Promise.all([accept(one,issued.tok),accept(one,issued.tok)]);
  check(results.every(x=>x==='accepted'),'Simultaneous retry by same account is safe');
  check((await query('SELECT count(*)::int n FROM pack1_admins WHERE auth_user_id=$1::uuid',[one])).rows[0].n===1,
    'Concurrent invitation accepts grant exactly one membership');
  check(await accept(wrong,issued.tok)==='invalid','Accepted token cannot grant another account');

  const expired=await create(owner,'expired-'+suffix+'@example.invalid');
  const expiredUser=await auth('expired-'+suffix+'@example.invalid');
  await query('UPDATE pack1_admin_invitations SET expires_at=now()-interval \'1 second\' WHERE id=$1::uuid',[expired.result.invitation_id]);
  check(await accept(expiredUser,expired.tok)==='invalid','Expired invitation rejected');

  const revoked=await create(owner,'revoked-'+suffix+'@example.invalid');
  const revokedUser=await auth('revoked-'+suffix+'@example.invalid');
  check(await revoke(owner,revoked.result.invitation_id)==='revoked','Owner may revoke pending invitation');
  check(await accept(revokedUser,revoked.tok)==='invalid','Revoked invitation rejected');
  check(await revoke(owner,revoked.result.invitation_id)==='revoked','Revocation idempotent');

  const reissuedUser=await auth('reissued-'+suffix+'@example.invalid');
  const first=await create(owner,'reissued-'+suffix+'@example.invalid');
  const second=await create(owner,'reissued-'+suffix+'@example.invalid');
  check(second.result.result==='issued','Reissue succeeds');
  check(await accept(reissuedUser,first.tok)==='invalid','Reissue invalidates previous token');
  check(await accept(reissuedUser,second.tok)==='accepted','Latest token redeems once');

  const simultaneousUserA=await auth('RACE-'+suffix+'@example.invalid');
  const simultaneousUserB=await auth('race-'+suffix+'@example.invalid');
  const simultaneous=await create(owner,'race-'+suffix+'@example.invalid');
  const claims=await Promise.all([accept(simultaneousUserA,simultaneous.tok),accept(simultaneousUserB,simultaneous.tok)]);
  check(claims.filter(x=>x==='accepted').length===1,'Two different Auth accounts cannot both redeem a token');
  check(claims.filter(x=>x==='invalid').length===1,'Concurrent losing claimant is rejected');

  const racedUser=await auth('revoke-race-'+suffix+'@example.invalid');
  const raced=await create(owner,'revoke-race-'+suffix+'@example.invalid');
  const [accepted,revokeResult]=await Promise.all([accept(racedUser,raced.tok),revoke(owner,raced.result.invitation_id)]);
  check(['accepted','invalid'].includes(accepted)&&['revoked','already_accepted'].includes(revokeResult),
    'Accept/revoke race resolves to one terminal outcome');
  const state=(await query('SELECT accepted_at,revoked_at FROM pack1_admin_invitations WHERE id=$1::uuid',[raced.result.invitation_id])).rows[0];
  check(Boolean(state.accepted_at)!==Boolean(state.revoked_at),'Accept/revoke race cannot produce both final states');

  const deletingUser=await auth('deleting-'+suffix+'@example.invalid');
  const deletingInvite=await create(owner,'deleting-'+suffix+'@example.invalid');
  await query('SELECT * FROM pack1_begin_account_deletion($1::uuid,NULL::uuid)',[deletingUser]);
  check(await accept(deletingUser,deletingInvite.tok)==='account_deleting','Deletion tombstone blocks joining');

  await assert.rejects(query('SELECT * FROM pack1_begin_account_deletion($1::uuid,NULL::uuid)',[owner]),e=>e.code==='23514');
  tests++;
  check((await query('SELECT count(*)::int n FROM account_deletion_operations WHERE auth_user_id=$1::uuid',[owner])).rows[0].n===0,'Owner deletion never commits tombstone');

  check((await query('SELECT pack1_revoke_admin_member($1::uuid,$2::uuid) result',[other,one])).rows[0].result==='forbidden',
    'Ordinary admin cannot revoke members');
  check((await query('SELECT pack1_revoke_admin_member($1::uuid,$2::uuid) result',[owner,owner])).rows[0].result==='forbidden',
    'Owner cannot revoke itself');
  check((await query('SELECT pack1_revoke_admin_member($1::uuid,$2::uuid) result',[owner,one])).rows[0].result==='revoked',
    'Owner revokes an Admin member');
  check(await accept(one,issued.tok)==='invalid','Revoked Admin cannot reclaim a used invitation');

  const audit=(await query('SELECT event_type,count(*)::int n FROM pack1_admin_audit GROUP BY event_type')).rows;
  check(audit.some(x=>x.event_type==='invite_issued'&&x.n>=1)&&audit.some(x=>x.event_type==='invite_accepted'&&x.n>=1)
    &&audit.some(x=>x.event_type==='invite_revoked'&&x.n>=1)&&audit.some(x=>x.event_type==='admin_revoked'&&x.n>=1),
    'Invitation, acceptance and revocation audit is durable');

  console.log('PASS: '+tests+' real PostgreSQL Owner/invitation lifecycle assertions; no external services or production data.');
} finally {await pool.end();}
