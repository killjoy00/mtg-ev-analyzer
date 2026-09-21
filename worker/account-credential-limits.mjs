import {createHmac,timingSafeEqual} from 'node:crypto';

const PURPOSES=new Set([
  'current_password',
  'password_change_network',
  'email_change_account',
  'email_change_network',
]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST=/^[a-f0-9]{64}$/;

function identity(authUserId,purpose,networkHash='') {
  const id=String(authUserId||'');
  const kind=String(purpose||'');
  const network=String(networkHash||'');
  if(!UUID.test(id))throw Object.assign(Error('Unambiguous Auth user identity required.'),{status:500});
  if(!PURPOSES.has(kind))throw Object.assign(Error('Credential limiter purpose is invalid.'),{status:500});
  if(network!==''&&!DIGEST.test(network))throw Object.assign(Error('Credential network identity is invalid.'),{status:503,code:'RATE_LIMIT_CONFIG'});
  return {id,kind,network};
}

function proofFor(network,secret) {
  return createHmac('sha256',secret).update('pack1-credential-network:'+network).digest('hex');
}

export function trustedCredentialNetwork(request,env=process.env) {
  // The edge gateway derives network from Cloudflare's CF-Connecting-IP, HMACs
  // that network before forwarding it, then authenticates the digest again
  // with the server-only rate-limit secret. Direct-origin callers can invent
  // headers, but cannot produce the matching proof.
  const secret=String(env.PACK1_RATE_LIMIT_SECRET||'');
  if(secret.length<32)
    throw Object.assign(Error('Credential management is temporarily unavailable.'),{status:503,code:'RATE_LIMIT_CONFIG'});
  const network=String(request.headers.get('x-pack1-network-id')||'');
  const supplied=String(request.headers.get('x-pack1-network-proof')||'');
  if(!DIGEST.test(network)||!DIGEST.test(supplied))
    throw Object.assign(Error('Credential management is temporarily unavailable.'),{status:503,code:'RATE_LIMIT_CONFIG'});
  const expected=proofFor(network,secret);
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(supplied)))
    throw Object.assign(Error('Credential management is temporarily unavailable.'),{status:503,code:'RATE_LIMIT_CONFIG'});
  return network;
}

export async function consumeCredentialLimit(query,{
  authUserId,purpose,networkHash='',limit,seconds,
}={}) {
  const {id,kind,network}=identity(authUserId,purpose,networkHash);
  const max=Number(limit),windowSeconds=Number(seconds);
  if(!Number.isInteger(max)||max<1||!Number.isInteger(windowSeconds)||windowSeconds<1)
    throw Object.assign(Error('Credential limiter policy is invalid.'),{status:500});
  await query('DELETE FROM account_credential_rate_limits WHERE expires_at<=now()');
  const result=await query(`INSERT INTO account_credential_rate_limits(auth_user_id,purpose,network_hash,attempts,expires_at)
    VALUES($1::uuid,$2,$3,1,now()+($4::int*interval '1 second'))
    ON CONFLICT(auth_user_id,purpose,network_hash) DO UPDATE SET
      attempts=CASE WHEN account_credential_rate_limits.expires_at<=now() THEN 1 ELSE account_credential_rate_limits.attempts+1 END,
      expires_at=CASE WHEN account_credential_rate_limits.expires_at<=now()
        THEN now()+($4::int*interval '1 second') ELSE account_credential_rate_limits.expires_at END
    RETURNING attempts,expires_at,
      GREATEST(1,ceil(extract(epoch from (expires_at-now()))))::int retry_after`,[
    id,kind,network,windowSeconds,
  ]);
  const row=result.rows[0]||{};
  return {
    attempts:Number(row.attempts||0),
    limited:Number(row.attempts||0)>max,
    expiresAt:row.expires_at||null,
    retryAfter:Math.max(1,Number(row.retry_after||1)),
  };
}

export async function clearCredentialLimit(query,{authUserId,purpose,networkHash=''}={}) {
  const {id,kind,network}=identity(authUserId,purpose,networkHash);
  await query(
    'DELETE FROM account_credential_rate_limits WHERE auth_user_id=$1::uuid AND purpose=$2 AND network_hash=$3',
    [id,kind,network],
  );
}

export const CREDENTIAL_LIMIT_PURPOSES=Object.freeze([...PURPOSES]);
export const credentialNetworkProof=proofFor;
