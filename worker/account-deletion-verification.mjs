import {createHmac,randomInt} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE=/^\d{8}$/;
const HMAC=/^[a-f0-9]{64}$/;
export const DELETION_CODE_TTL_SECONDS=10*60;
export const DELETION_EMAIL_SENDER='Pack One <accounts@packone.pro>';

function authId(value) {
  const id=String(value||'');
  if(!UUID.test(id))throw Object.assign(Error('Account deletion identity is invalid.'),{status:500,code:'DELETE_IDENTITY'});
  return id;
}

function configuredKey(env=process.env) {
  const key=String(env.PACK1_ACCOUNT_DELETE_RESEND_API_KEY||'');
  return key.startsWith('re_')&&key.length>3?key:null;
}

export function deletionEmailConfigured(env=process.env) {
  return Boolean(configuredKey(env));
}

export function deletionCodeHmac(authUserId,code,env=process.env) {
  const id=authId(authUserId);
  const value=String(code||'').trim();
  if(!CODE.test(value))throw Object.assign(Error('Deletion code is invalid or expired.'),{status:400,code:'DELETE_CODE_INVALID'});
  const secret=String(env.PACK1_RATE_LIMIT_SECRET||'');
  if(secret.length<32)
    throw Object.assign(Error('Account deletion verification is temporarily unavailable.'),{status:503,code:'RATE_LIMIT_CONFIG'});
  return createHmac('sha256',secret)
    .update('pack1-account-delete-code:'+id+':'+value)
    .digest('hex');
}

function generatedCode() {
  return String(randomInt(0,100000000)).padStart(8,'0');
}

function verified(value) {
  return value===true||value==='true'||value==='t'||value===1||value==='1';
}

export async function deletionEmailForAuth(query,authUserId) {
  const id=authId(authUserId);
  const result=await query(`SELECT email,"emailVerified" email_verified
    FROM neon_auth."user"
    WHERE id=$1::uuid
    LIMIT 1`,[id]);
  const row=result.rows[0];
  const email=String(row?.email||'').trim();
  return email&&verified(row?.email_verified)?email:null;
}

export async function purgeExpiredDeletionVerifications(query) {
  const result=await query('DELETE FROM account_deletion_verifications WHERE expires_at<=now()');
  return Number(result?.rowCount||0);
}

export async function storeDeletionVerification(query,{authUserId,codeHmac,ttlSeconds=DELETION_CODE_TTL_SECONDS}={}) {
  const id=authId(authUserId);
  const digest=String(codeHmac||'');
  const ttl=Number(ttlSeconds);
  if(!HMAC.test(digest)||!Number.isInteger(ttl)||ttl<1)
    throw Object.assign(Error('Account deletion verification could not be created.'),{status:500,code:'DELETE_VERIFICATION_STATE'});
  const result=await query(`INSERT INTO account_deletion_verifications(auth_user_id,code_hmac,created_at,expires_at)
      SELECT $1::uuid,$2,now(),now()+($3::int*interval '1 second')
      WHERE pack1_identity_attachment_allowed($1::uuid)
      ON CONFLICT(auth_user_id) DO UPDATE SET
        code_hmac=EXCLUDED.code_hmac,
        created_at=EXCLUDED.created_at,
        expires_at=EXCLUDED.expires_at
      RETURNING auth_user_id,code_hmac,created_at,expires_at`,[id,digest,ttl]);
  if(!result.rows[0])
    throw Object.assign(Error('This account is being deleted.'),{status:409,code:'ACCOUNT_DELETING'});
  return result.rows[0];
}

export async function deleteDeletionVerificationIfMatch(query,{authUserId,codeHmac}={}) {
  const id=authId(authUserId);
  const digest=String(codeHmac||'');
  if(!HMAC.test(digest))return false;
  const result=await query(
    'DELETE FROM account_deletion_verifications WHERE auth_user_id=$1::uuid AND code_hmac=$2',
    [id,digest],
  );
  return Number(result?.rowCount||0)>0;
}

export async function consumeDeletionVerification(query,{authUserId,code,env=process.env}={}) {
  const id=authId(authUserId);
  const digest=deletionCodeHmac(id,code,env);
  const result=await query(`DELETE FROM account_deletion_verifications
    WHERE auth_user_id=$1::uuid AND code_hmac=$2 AND expires_at>now()
    RETURNING auth_user_id`,[id,digest]);
  return Boolean(result.rows[0]);
}

export async function sendDeletionEmail({email,code,env=process.env,fetcher=fetch}={}) {
  const key=configuredKey(env);
  if(!key)
    throw Object.assign(Error('Account deletion email is not configured.'),{status:503,code:'DELETION_EMAIL_UNAVAILABLE'});
  const destination=String(email||'').trim();
  if(!destination||!CODE.test(String(code||'')))
    throw Object.assign(Error('Account deletion email request is invalid.'),{status:500,code:'DELETE_EMAIL_REQUEST'});
  const text=[
    'Pack One account-deletion verification',
    '',
    'Your deletion code is: '+code,
    '',
    'This code expires in about 10 minutes.',
    '',
    'If you did not request account deletion, you can ignore this email.',
    'Pack One will never ask you for this code.',
  ].join('\n');
  const response=await fetcher('https://api.resend.com/emails',{
    method:'POST',
    headers:{
      authorization:'Bearer '+key,
      'content-type':'application/json',
    },
    body:JSON.stringify({
      from:DELETION_EMAIL_SENDER,
      to:[destination],
      subject:'Your Pack One account deletion code',
      text,
    }),
    signal:AbortSignal.timeout(15000),
  });
  if(!response.ok)
    throw Object.assign(Error('Deletion verification email could not be sent.'),{status:503,code:'DELETE_EMAIL_SEND_FAILED'});
  return true;
}

export async function createDeletionVerification(query,{authUserId,email,env=process.env,sender=sendDeletionEmail}={}) {
  const id=authId(authUserId);
  if(!deletionEmailConfigured(env))
    throw Object.assign(Error('Account deletion verification is temporarily unavailable.'),{status:503,code:'DELETION_EMAIL_UNAVAILABLE'});
  await purgeExpiredDeletionVerifications(query);
  const code=generatedCode();
  const codeHmac=deletionCodeHmac(id,code,env);
  const stored=await storeDeletionVerification(query,{authUserId:id,codeHmac});
  try {
    await sender({email,code,env});
  } catch(error) {
    await deleteDeletionVerificationIfMatch(query,{authUserId:id,codeHmac});
    if(error?.code==='DELETION_EMAIL_UNAVAILABLE')throw error;
    throw Object.assign(Error('Deletion verification email could not be sent. Please try again.'),{
      status:503,code:'DELETE_EMAIL_SEND_FAILED',cause:error,
    });
  }
  return {expiresAt:stored.expires_at,expiresInSeconds:DELETION_CODE_TTL_SECONDS};
}
