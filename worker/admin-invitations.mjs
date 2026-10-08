import {createHash,randomBytes} from 'node:crypto';
import {requireTrustedOrigin} from './account-session.mjs';
import {PROD_ORIGINS,LOCAL_ORIGINS} from './account-config.mjs';

const TRUSTED_ORIGINS=new Set([...PROD_ORIGINS,...LOCAL_ORIGINS]);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fail=(message,status=400,code=null)=>{throw Object.assign(Error(message),{status,...(code?{code}:{})});};
const digest=token=>createHash('sha256').update(token).digest('hex');

export function validateAdminMutation(request){
  requireTrustedOrigin(request,TRUSTED_ORIGINS);
}
export function normalizeInviteEmail(value){
  if(typeof value!=='string')fail('Enter a valid email address.');
  const email=value.trim().toLowerCase();
  if(email.length<3||email.length>254||!EMAIL.test(email)||/[\u0000-\u001f\u007f]/.test(email))
    fail('Enter a valid email address.');
  return email;
}
export async function acceptAdminInvitation(request,query,readJson,authUserId){
  if(request.method!=='POST')fail('Method not allowed.',405);
  validateAdminMutation(request);
  const body=await readJson(request);
  const token=body?.token;
  if(typeof token!=='string'||!TOKEN.test(token))fail('Invalid or expired invitation.',403,'ADMIN_INVITATION_INVALID');
  const response=await query('SELECT pack1_accept_admin_invitation($1::uuid,$2) result',[authUserId,digest(token)]);
  const status=response.rows[0]?.result;
  if(status==='accepted')return {ok:true,role:'admin'};
  if(status==='not_verified')fail('Verify your Pack One account email before accepting this invitation.',403,'ADMIN_EMAIL_UNVERIFIED');
  if(status==='wrong_account')fail('Sign in with the verified email address specified on this invitation.',403,'ADMIN_WRONG_ACCOUNT');
  if(status==='account_deleting')fail('This account is being deleted.',409,'ACCOUNT_DELETING');
  if(status==='already_admin')fail('This account already has administrator access.',409,'ALREADY_ADMIN');
  fail('Invalid, expired or already used invitation.',403,'ADMIN_INVITATION_INVALID');
}
const ownerOnly=role=>{if(role!=='owner')fail('Only the Owner can manage administrator access.',403,'OWNER_REQUIRED');};

export async function handleAdminTeam(request,query,readJson,authUserId,role){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  ownerOnly(role);
  if(method==='GET'&&path==='/v1/admin/team'){
    const [members,invitations,audit]=await Promise.all([
      query(`SELECT a.auth_user_id::text id,a.role,a.created_at,u.name,u.email,u."emailVerified" email_verified
        FROM pack1_admins a JOIN neon_auth."user" u ON u.id=a.auth_user_id
        ORDER BY CASE WHEN a.role='owner' THEN 0 ELSE 1 END,u.email,a.auth_user_id`),
      query(`SELECT id,recipient_email,issued_by,issued_at,expires_at,accepted_by,accepted_at,revoked_by,revoked_at
        FROM pack1_admin_invitations ORDER BY issued_at DESC,id DESC LIMIT 100`),
      query(`SELECT id,event_type,actor_auth_user_id,target_auth_user_id,invitation_id,recipient_email,created_at
        FROM pack1_admin_audit ORDER BY created_at DESC,id DESC LIMIT 50`),
    ]);
    return {ok:true,members:members.rows,invitations:invitations.rows,audit:audit.rows};
  }
  validateAdminMutation(request);
  if(method==='POST'&&path==='/v1/admin/team/invitations'){
    const body=await readJson(request);
    const email=normalizeInviteEmail(body?.email);
    const token=randomBytes(32).toString('base64url');
    const result=await query(`SELECT result,invitation_id,expiration
      FROM pack1_issue_admin_invitation($1::uuid,$2,$3,$4::int)`,[authUserId,email,digest(token),259200]);
    const row=result.rows[0];
    if(row?.result==='rate_limited')fail('Too many invitations. Try again later.',429,'ADMIN_INVITE_LIMIT');
    if(row?.result==='already_admin')fail('An administrator already uses this email.',409,'ALREADY_ADMIN');
    if(row?.result==='forbidden')fail('Owner permission was revoked.',403,'OWNER_REQUIRED');
    if(row?.result!=='issued')fail('Invitation could not be created.');
    // This is the ONLY delivery of the bearer token: do not log or persist it
    // outside this direct response. No email is automatically sent.
    return {ok:true,invitation:{id:row.invitation_id,email,expires_at:row.expiration},token};
  }
  const revokeInvite=path.match(/^\/v1\/admin\/team\/invitations\/([a-f0-9-]{36})\/revoke$/i);
  if(method==='POST'&&revokeInvite){
    if(!UUID.test(revokeInvite[1]))fail('Invalid invitation.',400);
    const response=await query('SELECT pack1_revoke_admin_invitation($1::uuid,$2::uuid) result',[authUserId,revokeInvite[1]]);
    const status=response.rows[0]?.result;
    if(status==='forbidden')fail('Owner permission was revoked.',403);
    if(status==='not_found')fail('Invitation not found.',404);
    if(status==='already_accepted')fail('Already accepted; revoke the administrator membership instead.',409);
    return {ok:true,status};
  }
  const revokeMember=path.match(/^\/v1\/admin\/team\/members\/([a-f0-9-]{36})\/revoke$/i);
  if(method==='POST'&&revokeMember){
    if(!UUID.test(revokeMember[1]))fail('Invalid administrator.',400);
    const response=await query('SELECT pack1_revoke_admin_member($1::uuid,$2::uuid) result',[authUserId,revokeMember[1]]);
    const status=response.rows[0]?.result;
    if(status==='forbidden'||status==='owner_protected')fail('Cannot revoke the Owner or your own access.',403,'OWNER_PROTECTED');
    if(status==='not_found')fail('Administrator not found.',404);
    return {ok:true,status};
  }
  fail('Not found.',404);
}
