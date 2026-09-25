import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

export const APPLE_NATIVE_CLIENT_ID='pro.packone.app';
export const APPLE_WEB_CLIENT_ID='pro.packone.web';
export const APPLE_REDIRECT_URI='https://api.packone.pro/growth/v1/account/apple/callback';
export const APPLE_AUTHORIZE_ENDPOINT='https://appleid.apple.com/auth/authorize';
const APPLE_TOKEN_ENDPOINT='https://appleid.apple.com/auth/token';
const APPLE_REVOKE_ENDPOINT='https://appleid.apple.com/auth/revoke';
const APPLE_KEYS_ENDPOINT='https://appleid.apple.com/auth/keys';
const APPLE_ISSUER='https://appleid.apple.com';
const TOKEN_CIPHER_PREFIX='apple-token';
const TOKEN_KEY_VERSION='v1';
let keyCache={at:0,keys:[]};

const bool=value=>value===true||value===1||value==='1'||value==='t'||value==='true';

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function parseJwt(token) {
  const parts=String(token||'').split('.');
  if(parts.length!==3)throw Object.assign(Error('Apple identity token is invalid.'),{status:401,code:'APPLE_TOKEN_INVALID'});
  let header,payload;
  try {
    header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    payload=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
  } catch {
    throw Object.assign(Error('Apple identity token is invalid.'),{status:401,code:'APPLE_TOKEN_INVALID'});
  }
  return {parts,header,payload};
}

function appleConfig(env=process.env) {
  const teamId=String(env.APPLE_TEAM_ID||'').trim();
  const keyId=String(env.APPLE_SIGN_IN_KEY_ID||'').trim();
  const privateKey=String(env.APPLE_SIGN_IN_KEY_P8||'').replace(/\\n/g,'\n').trim();
  if(!/^[A-Z0-9]{10}$/.test(teamId)||!/^[A-Z0-9]{10}$/.test(keyId)||!privateKey.includes('BEGIN PRIVATE KEY'))
    throw Object.assign(Error('Sign in with Apple is temporarily unavailable.'),{status:503,code:'APPLE_CONFIG'});
  return {teamId,keyId,privateKey};
}

export function appleConfigured(env=process.env) {
  try {appleConfig(env);encryptionKey(env,TOKEN_KEY_VERSION);return true;} catch {return false;}
}

export function createAppleClientSecret(clientId,{env=process.env,now=Math.floor(Date.now()/1000)}={}) {
  if(![APPLE_NATIVE_CLIENT_ID,APPLE_WEB_CLIENT_ID].includes(String(clientId||'')))
    throw Object.assign(Error('Apple client is invalid.'),{status:500,code:'APPLE_CLIENT'});
  const {teamId,keyId,privateKey}=appleConfig(env);
  const header=base64url(JSON.stringify({alg:'ES256',kid:keyId,typ:'JWT'}));
  const payload=base64url(JSON.stringify({
    iss:teamId,
    iat:now,
    exp:now+300,
    aud:APPLE_ISSUER,
    sub:clientId,
  }));
  const body=header+'.'+payload;
  let signature;
  try {
    signature=cryptoSign('sha256',Buffer.from(body),{
      key:createPrivateKey(privateKey),
      dsaEncoding:'ieee-p1363',
    });
  } catch {
    throw Object.assign(Error('Sign in with Apple is temporarily unavailable.'),{status:503,code:'APPLE_CONFIG'});
  }
  return body+'.'+base64url(signature);
}

async function appleKeys(fetcher=fetch,{force=false}={}) {
  if(!force&&keyCache.keys.length&&Date.now()-keyCache.at<60*60*1000)return keyCache.keys;
  const response=await fetcher(APPLE_KEYS_ENDPOINT,{headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Object.assign(Error('Apple identity verification is temporarily unavailable.'),{status:503,code:'APPLE_KEYS'});
  const data=await response.json().catch(()=>({}));
  if(!Array.isArray(data.keys)||!data.keys.length)
    throw Object.assign(Error('Apple identity verification is temporarily unavailable.'),{status:503,code:'APPLE_KEYS'});
  keyCache={at:Date.now(),keys:data.keys};
  return keyCache.keys;
}

export function resetAppleKeyCache() {
  keyCache={at:0,keys:[]};
}

export async function verifyAppleIdentityToken(token,{clientId,nonce=null,fetcher=fetch,now=Math.floor(Date.now()/1000)}={}) {
  const parsed=parseJwt(token);
  if(parsed.header?.alg!=='RS256'||!parsed.header?.kid)
    throw Object.assign(Error('Apple identity token is invalid.'),{status:401,code:'APPLE_TOKEN_INVALID'});
  let keys=await appleKeys(fetcher);
  let jwk=keys.find(key=>key?.kid===parsed.header.kid&&key?.kty==='RSA');
  if(!jwk) {
    keys=await appleKeys(fetcher,{force:true});
    jwk=keys.find(key=>key?.kid===parsed.header.kid&&key?.kty==='RSA');
  }
  if(!jwk)throw Object.assign(Error('Apple identity token signing key is unavailable.'),{status:503,code:'APPLE_KEYS'});
  let verified=false;
  try {
    verified=cryptoVerify(
      'RSA-SHA256',
      Buffer.from(parsed.parts[0]+'.'+parsed.parts[1]),
      createPublicKey({key:jwk,format:'jwk'}),
      Buffer.from(parsed.parts[2],'base64url'),
    );
  } catch {}
  const claims=parsed.payload||{};
  const aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(!verified||claims.iss!==APPLE_ISSUER||!aud.includes(clientId)||!Number.isFinite(Number(claims.exp))||Number(claims.exp)<now-30)
    throw Object.assign(Error('Apple identity token is invalid.'),{status:401,code:'APPLE_TOKEN_INVALID'});
  if(nonce!==null&&String(claims.nonce||'')!==String(nonce))
    throw Object.assign(Error('Apple sign in could not be verified.'),{status:401,code:'APPLE_NONCE'});
  const subject=String(claims.sub||'');
  if(!subject||subject.length>255)
    throw Object.assign(Error('Apple identity token is invalid.'),{status:401,code:'APPLE_TOKEN_INVALID'});
  return {
    subject,
    email:String(claims.email||'').trim().toLowerCase()||null,
    emailVerified:bool(claims.email_verified),
    claims,
  };
}

async function appleForm(endpoint,params,{fetcher=fetch}={}) {
  const response=await fetcher(endpoint,{
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},
    body:new URLSearchParams(params).toString(),
    signal:AbortSignal.timeout(15000),
  });
  const data=await response.json().catch(()=>({}));
  return {response,data};
}

export async function exchangeAppleAuthorizationCode(code,{clientId,redirectUri=null,env=process.env,fetcher=fetch}={}) {
  const value=String(code||'');
  if(value.length<8||value.length>4096)
    throw Object.assign(Error('Apple authorization code is invalid.'),{status:401,code:'APPLE_CODE'});
  const params={
    client_id:clientId,
    client_secret:createAppleClientSecret(clientId,{env}),
    code:value,
    grant_type:'authorization_code',
  };
  if(redirectUri)params.redirect_uri=redirectUri;
  const {response,data}=await appleForm(APPLE_TOKEN_ENDPOINT,params,{fetcher});
  if(!response.ok||!data?.id_token||!data?.refresh_token)
    throw Object.assign(Error('Apple sign in could not be finalized.'),{
      status:response.status>=500?503:401,
      code:response.status>=500?'APPLE_TOKEN_SERVICE':'APPLE_CODE',
    });
  return data;
}

export async function verifyAppleAuthorization({
  identityToken,
  authorizationCode,
  clientId,
  nonce=null,
  redirectUri=null,
  env=process.env,
  fetcher=fetch,
}={}) {
  const presented=await verifyAppleIdentityToken(identityToken,{clientId,nonce,fetcher});
  const exchanged=await exchangeAppleAuthorizationCode(authorizationCode,{clientId,redirectUri,env,fetcher});
  const validated=await verifyAppleIdentityToken(exchanged.id_token,{clientId,fetcher});
  if(validated.subject!==presented.subject)
    throw Object.assign(Error('Apple sign in identities did not match.'),{status:401,code:'APPLE_IDENTITY_MISMATCH'});
  return {
    subject:presented.subject,
    email:presented.email||validated.email||null,
    emailVerified:presented.emailVerified||validated.emailVerified,
    refreshToken:exchanged.refresh_token,
  };
}

function encryptionKey(env=process.env,keyVersion=TOKEN_KEY_VERSION) {
  const name=keyVersion==='v1'?'APPLE_TOKEN_ENCRYPTION_KEY_V1':'';
  const raw=name?String(env[name]||'').trim():'';
  if(!/^[a-f0-9]{64}$/i.test(raw))
    throw Object.assign(Error('Apple credential storage is temporarily unavailable.'),{status:503,code:'APPLE_STORAGE_CONFIG'});
  return Buffer.from(raw,'hex');
}

export function encryptAppleRefreshToken(token,{env=process.env,keyVersion=TOKEN_KEY_VERSION}={}) {
  const value=String(token||'');
  if(value.length<8||value.length>8192)throw Object.assign(Error('Apple token response is invalid.'),{status:502,code:'APPLE_TOKEN_SERVICE'});
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(env,keyVersion),iv);
  const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return [TOKEN_CIPHER_PREFIX,keyVersion,base64url(iv),base64url(encrypted),base64url(tag)].join('.');
}

export function decryptAppleRefreshToken(value,{env=process.env}={}) {
  const [prefix,keyVersion,ivRaw,dataRaw,tagRaw,...rest]=String(value||'').split('.');
  if(prefix!==TOKEN_CIPHER_PREFIX||keyVersion!=='v1'||!ivRaw||!dataRaw||!tagRaw||rest.length)
    throw Object.assign(Error('Stored Apple authorization is invalid.'),{status:500,code:'APPLE_TOKEN_STORAGE'});
  try {
    const decipher=createDecipheriv('aes-256-gcm',encryptionKey(env,keyVersion),Buffer.from(ivRaw,'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw,'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataRaw,'base64url')),decipher.final()]).toString('utf8');
  } catch {
    throw Object.assign(Error('Stored Apple authorization is invalid.'),{status:500,code:'APPLE_TOKEN_STORAGE'});
  }
}

export function sanitizeAppleNamePart(value) {
  return String(value||'')
    .replace(/[\u0000-\u001f\u007f]/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,80);
}

export const sanitizeAppleFirstName=sanitizeAppleNamePart;

export function appleDisplayName(firstName,lastName) {
  return [sanitizeAppleNamePart(firstName),sanitizeAppleNamePart(lastName)]
    .filter(Boolean)
    .join(' ')
    .slice(0,80);
}

export function appleAuthorizeUrl(state,{nonce=state}={}) {
  const flow=String(state||'');
  if(!/^[A-Za-z0-9_-]{43}$/.test(flow))throw Error('Apple OAuth state must be a 256-bit base64url token.');
  const url=new URL(APPLE_AUTHORIZE_ENDPOINT);
  url.searchParams.set('client_id',APPLE_WEB_CLIENT_ID);
  url.searchParams.set('redirect_uri',APPLE_REDIRECT_URI);
  url.searchParams.set('response_type','code id_token');
  url.searchParams.set('response_mode','form_post');
  url.searchParams.set('scope','name email');
  url.searchParams.set('state',flow);
  url.searchParams.set('nonce',String(nonce));
  return url.toString();
}

async function providerAdminCall(authBase,path,{body,cookie}={}) {
  const response=await fetch(authBase+path,{
    method:'POST',
    headers:{
      origin:'https://packone.pro',
      accept:'application/json',
      'content-type':'application/json',
      ...(cookie?{cookie}:{}),
    },
    body:JSON.stringify(body||{}),
    redirect:'manual',
    signal:AbortSignal.timeout(15000),
  });
  const data=await response.json().catch(()=>({}));
  const set=String(response.headers.get('set-cookie')||'');
  const session=set.split(/,(?=\s*[^;,]+=)/)[0]?.split(';')[0]?.trim()||cookie||'';
  return {response,data,cookie:session};
}

async function providerAdminSession(authBase,{env=process.env,validateServicePrincipal}={}) {
  const email=String(env.PACK1_DELETION_ADMIN_EMAIL||'').trim();
  const password=String(env.PACK1_DELETION_ADMIN_PASSWORD||'');
  if(!email||password.length<16)
    throw Object.assign(Error('Sign in with Apple is temporarily unavailable.'),{status:503,code:'APPLE_ADMIN_CONFIG'});
  const signed=await providerAdminCall(authBase,'/sign-in/email',{body:{email,password,rememberMe:false}});
  if(!signed.response.ok||!signed.cookie)
    throw Object.assign(Error('Sign in with Apple is temporarily unavailable.'),{status:503,code:'APPLE_ADMIN_AUTH'});
  const serviceId=String(signed.data?.user?.id||'');
  if(!/^[0-9a-f-]{36}$/i.test(serviceId))
    throw Object.assign(Error('Sign in with Apple is temporarily unavailable.'),{status:503,code:'APPLE_ADMIN_AUTH'});
  if(typeof validateServicePrincipal!=='function'||!(await validateServicePrincipal(serviceId)))
    throw Object.assign(Error('Sign in with Apple is temporarily unavailable.'),{status:503,code:'APPLE_ADMIN_LINK_POLICY'});
  return {cookie:signed.cookie,serviceId};
}

async function markAppleAuthEmailVerified({authBase,userId,env=process.env,validateServicePrincipal}) {
  let admin=null;
  try {
    admin=await providerAdminSession(authBase,{env,validateServicePrincipal});
    if(admin.serviceId===String(userId))
      throw Object.assign(Error('Apple account cannot use the Auth service principal.'),{status:409,code:'APPLE_LINK'});
    const updated=await providerAdminCall(authBase,'/admin/update-user',{cookie:admin.cookie,body:{
      userId,
      data:{emailVerified:true},
    }});
    admin.cookie=updated.cookie||admin.cookie;
    if(!updated.response.ok)
      throw Object.assign(Error('Apple account could not be verified.'),{status:503,code:'APPLE_ADMIN_VERIFY'});
  } finally {
    if(admin?.cookie) {
      try {await providerAdminCall(authBase,'/sign-out',{cookie:admin.cookie,body:{}});} catch {}
    }
  }
}

export async function createAppleAuthUser({authBase,email,name,env=process.env,validateServicePrincipal}) {
  let admin=null;
  try {
    admin=await providerAdminSession(authBase,{env,validateServicePrincipal});
    const syntheticPassword=base64url(randomBytes(32));
    const created=await providerAdminCall(authBase,'/admin/create-user',{cookie:admin.cookie,body:{
      email,
      password:syntheticPassword,
      name:name||'Pack One Player',
      role:'user',
    }});
    admin.cookie=created.cookie||admin.cookie;
    if(!created.response.ok) {
      const error=Object.assign(Error('Apple account could not be created.'),{
        status:created.response.status===409||created.response.status===422?409:503,
        code:created.response.status===409||created.response.status===422?'APPLE_ACCOUNT_EXISTS':'APPLE_ADMIN_CREATE',
      });
      throw error;
    }
    const user=created.data?.user||created.data;
    const userId=String(user?.id||'');
    if(!/^[0-9a-f-]{36}$/i.test(userId))
      throw Object.assign(Error('Apple account could not be created.'),{status:503,code:'APPLE_ADMIN_CREATE'});
    if(admin.serviceId===userId)
      throw Object.assign(Error('Apple account could not be created.'),{status:503,code:'APPLE_ADMIN_CREATE'});
    const updated=await providerAdminCall(authBase,'/admin/update-user',{cookie:admin.cookie,body:{
      userId,
      data:{emailVerified:true},
    }});
    admin.cookie=updated.cookie||admin.cookie;
    if(!updated.response.ok)
      throw Object.assign(Error('Apple account could not be verified.'),{status:503,code:'APPLE_ADMIN_VERIFY'});
    return {userId,syntheticPassword:true};
  } finally {
    if(admin?.cookie) {
      try {await providerAdminCall(authBase,'/sign-out',{cookie:admin.cookie,body:{}});} catch {}
    }
  }
}

export async function resolveAppleAccount(query,{
  identityToken,
  authorizationCode,
  clientId,
  nonce,
  redirectUri=null,
  firstName='',
  lastName='',
  authBase,
  env=process.env,
  fetcher=fetch,
  validateServicePrincipal,
}={}) {
  const authorization=await verifyAppleAuthorization({
    identityToken,authorizationCode,clientId,nonce,redirectUri,env,fetcher,
  });
  const subject=authorization.subject;
  let record=(await query(`SELECT ai.auth_user_id,u.email,u.name,ai.synthetic_password
    FROM apple_auth_identities ai
    JOIN neon_auth."user" u ON u.id=ai.auth_user_id
    WHERE ai.apple_subject=$1 LIMIT 1`,[subject])).rows[0]||null;

  if(!record) {
    const email=authorization.email;
    if(!email||!authorization.emailVerified)
      throw Object.assign(Error('Apple did not provide a verified account email.'),{status:409,code:'APPLE_EMAIL'});
    if(email.toLowerCase()===String(env.PACK1_DELETION_ADMIN_EMAIL||'').trim().toLowerCase())
      throw Object.assign(Error('Apple account cannot use the Auth service principal.'),{status:409,code:'APPLE_LINK'});
    const byEmail=(await query('SELECT id auth_user_id,email,name,"emailVerified" email_verified FROM neon_auth."user" WHERE lower(email)=lower($1) LIMIT 1',[email])).rows[0]||null;
    let authUserId=byEmail?.auth_user_id||null,syntheticPassword=false;
    if(authUserId&&!bool(byEmail.email_verified)) {
      // Never convert an unverified email/password identity into an Apple-linked
      // account. An attacker can pre-register a victim's email with a password;
      // marking that row verified here would activate the attacker's credential.
      throw Object.assign(Error('An unverified Pack One account already uses this email. Reset that account password from the email inbox before linking Apple.'),{
        status:409,
        code:'APPLE_EXISTING_ACCOUNT_UNVERIFIED',
      });
    }
    if(!authUserId) {
      try {
        const created=await createAppleAuthUser({
          authBase,email,name:appleDisplayName(firstName,lastName)||'Pack One Player',env,validateServicePrincipal,
        });
        authUserId=created.userId;
        syntheticPassword=created.syntheticPassword;
      } catch(error) {
        if(error?.code!=='APPLE_ACCOUNT_EXISTS')throw error;
        const raced=(await query('SELECT id auth_user_id,"emailVerified" email_verified FROM neon_auth."user" WHERE lower(email)=lower($1) LIMIT 1',[email])).rows[0];
        if(!raced?.auth_user_id)throw error;
        if(!bool(raced.email_verified)) {
          throw Object.assign(Error('An unverified Pack One account already uses this email. Reset that account password from the email inbox before linking Apple.'),{
            status:409,
            code:'APPLE_EXISTING_ACCOUNT_UNVERIFIED',
          });
        }
        authUserId=raced.auth_user_id;
      }
    }
    const given=sanitizeAppleNamePart(firstName)||null;
    const family=sanitizeAppleNamePart(lastName)||null;
    await query(`INSERT INTO apple_auth_identities(apple_subject,auth_user_id,email,first_name,last_name,synthetic_password)
      SELECT $1,$2::uuid,$3,$4,$5,$6::boolean
      WHERE pack1_identity_attachment_allowed($2::uuid)
      ON CONFLICT(apple_subject) DO NOTHING`,[subject,authUserId,email,given,family,syntheticPassword]);
    record=(await query(`SELECT ai.auth_user_id,u.email,u.name,ai.synthetic_password
      FROM apple_auth_identities ai
      JOIN neon_auth."user" u ON u.id=ai.auth_user_id
      WHERE ai.apple_subject=$1 LIMIT 1`,[subject])).rows[0]||null;
    if(!record)
      throw Object.assign(Error('Apple identity could not be linked.'),{status:409,code:'APPLE_LINK'});
  }

  await storeAppleRefreshToken(query,{
    subject,
    clientId,
    refreshToken:authorization.refreshToken,
    env,
  });

  return {
    user_id:record.auth_user_id,
    email:record.email,
    name:record.name,
    apple_subject:subject,
    synthetic_password:bool(record.synthetic_password),
  };
}

export async function storeAppleRefreshToken(query,{subject,clientId,refreshToken,env=process.env}={}) {
  const encrypted=encryptAppleRefreshToken(refreshToken,{env});
  await query(`INSERT INTO apple_auth_tokens(apple_subject,client_id,refresh_token_ciphertext,updated_at,revoked_at)
    VALUES($1,$2,$3,now(),NULL)
    ON CONFLICT(apple_subject,client_id) DO UPDATE SET
      refresh_token_ciphertext=EXCLUDED.refresh_token_ciphertext,
      updated_at=now(),
      revoked_at=NULL`,[subject,clientId,encrypted]);
}

export async function markApplePasswordEstablished(query,authUserId) {
  await query('UPDATE apple_auth_identities SET synthetic_password=false,updated_at=now() WHERE auth_user_id=$1::uuid',[authUserId]);
}

export async function revokeAppleAuthorization(query,authUserId,{env=process.env,fetcher=fetch}={}) {
  const result=await query(`SELECT t.apple_subject,t.client_id,t.refresh_token_ciphertext
    FROM apple_auth_tokens t
    JOIN apple_auth_identities i ON i.apple_subject=t.apple_subject
    WHERE i.auth_user_id=$1::uuid AND t.revoked_at IS NULL
    ORDER BY t.client_id`,[authUserId]);
  if(!result.rows.length)return {kind:'success',revoked:0};
  if(!appleConfigured(env))return {kind:'operator_review',code:'APPLE_CONFIG'};
  let count=0;
  for(const row of result.rows) {
    let token;
    try {token=decryptAppleRefreshToken(row.refresh_token_ciphertext,{env});}
    catch {return {kind:'operator_review',code:'APPLE_TOKEN_STORAGE'};}
    let response;
    try {
      ({response}=await appleForm(APPLE_REVOKE_ENDPOINT,{
        client_id:row.client_id,
        client_secret:createAppleClientSecret(row.client_id,{env}),
        token,
        token_type_hint:'refresh_token',
      },{fetcher}));
    } catch(error) {
      return {kind:'transient',code:error?.name==='TimeoutError'||error?.name==='AbortError'?'APPLE_REVOKE_TIMEOUT':'APPLE_REVOKE_NETWORK'};
    }
    if(!response.ok) {
      if(response.status>=500||response.status===429)return {kind:'transient',code:'APPLE_REVOKE_SERVICE'};
      return {kind:'operator_review',code:'APPLE_REVOKE_RESPONSE'};
    }
    await query('UPDATE apple_auth_tokens SET revoked_at=COALESCE(revoked_at,now()),updated_at=now() WHERE apple_subject=$1 AND client_id=$2',[
      row.apple_subject,row.client_id,
    ]);
    count++;
  }
  return {kind:'success',revoked:count};
}

export const appleSubjectHash=value=>createHash('sha256').update(String(value||'')).digest('hex');
