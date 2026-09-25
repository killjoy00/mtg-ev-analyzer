import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';

import {
  APPLE_NATIVE_CLIENT_ID,
  APPLE_REDIRECT_URI,
  appleDisplayName,
  APPLE_WEB_CLIENT_ID,
  appleAuthorizeUrl,
  createAppleClientSecret,
  decryptAppleRefreshToken,
  encryptAppleRefreshToken,
  resetAppleKeyCache,
  sanitizeAppleFirstName,
  verifyAppleIdentityToken,
} from '../worker/apple-auth.mjs';

const b64=value=>Buffer.from(value).toString('base64url');

test('Apple authorization URL is pinned to the reviewed Services ID and callback',()=>{
  const state='s'.repeat(43);
  const url=new URL(appleAuthorizeUrl(state));
  assert.equal(url.origin,'https://appleid.apple.com');
  assert.equal(url.pathname,'/auth/authorize');
  assert.equal(url.searchParams.get('client_id'),APPLE_WEB_CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'),APPLE_REDIRECT_URI);
  assert.equal(url.searchParams.get('response_type'),'code id_token');
  assert.equal(url.searchParams.get('response_mode'),'form_post');
  assert.equal(url.searchParams.get('scope'),'name email');
  assert.equal(url.searchParams.get('state'),state);
  assert.equal(url.searchParams.get('nonce'),state);
});

test('Apple client secret is short lived and signed for the requested client',()=>{
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'P-256'});
  const env={
    APPLE_TEAM_ID:'TEAMID1234',
    APPLE_SIGN_IN_KEY_ID:'KEYID12345',
    APPLE_SIGN_IN_KEY_P8:privateKey.export({type:'pkcs8',format:'pem'}),
  };
  const token=createAppleClientSecret(APPLE_NATIVE_CLIENT_ID,{env,now:1000});
  const [head,payload,signature]=token.split('.');
  const claims=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  assert.deepEqual(claims,{
    iss:'TEAMID1234',
    iat:1000,
    exp:1300,
    aud:'https://appleid.apple.com',
    sub:APPLE_NATIVE_CLIENT_ID,
  });
  assert.equal(JSON.parse(Buffer.from(head,'base64url').toString('utf8')).kid,'KEYID12345');
  assert.equal(sign('sha256',Buffer.from('not-the-token'),{key:privateKey,dsaEncoding:'ieee-p1363'}).length,64);
  assert.equal(
    verify(
      'sha256',
      Buffer.from(head+'.'+payload),
      {key:publicKey,dsaEncoding:'ieee-p1363'},
      Buffer.from(signature,'base64url'),
    ),
    true,
  );
});

test('Apple identity tokens require Apple issuer, intended audience, nonce and signature',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const kid='fixture-key';
  const makeToken=(overrides={})=>{
    const head=b64(JSON.stringify({alg:'RS256',kid,typ:'JWT'}));
    const payload=b64(JSON.stringify({
      iss:'https://appleid.apple.com',
      aud:APPLE_NATIVE_CLIENT_ID,
      exp:4102444800,
      sub:'apple-subject-123',
      nonce:'n'.repeat(43),
      email:'Relay@Privaterelay.AppleID.com',
      email_verified:'true',
      ...overrides,
    }));
    const signature=sign('RSA-SHA256',Buffer.from(head+'.'+payload),privateKey);
    return head+'.'+payload+'.'+b64(signature);
  };
  const jwk=publicKey.export({format:'jwk'});
  const fetcher=async()=>Response.json({keys:[{...jwk,kid,alg:'RS256',use:'sig'}]});
  resetAppleKeyCache();
  const verified=await verifyAppleIdentityToken(makeToken(),{
    clientId:APPLE_NATIVE_CLIENT_ID,
    nonce:'n'.repeat(43),
    fetcher,
    now:2000,
  });
  assert.equal(verified.subject,'apple-subject-123');
  assert.equal(verified.email,'relay@privaterelay.appleid.com');
  assert.equal(verified.emailVerified,true);

  resetAppleKeyCache();
  await assert.rejects(
    verifyAppleIdentityToken(makeToken({aud:APPLE_WEB_CLIENT_ID}),{
      clientId:APPLE_NATIVE_CLIENT_ID,nonce:'n'.repeat(43),fetcher,now:2000,
    }),
    error=>error?.code==='APPLE_TOKEN_INVALID',
  );
});

test('Apple refresh tokens are encrypted at rest and first names are normalized',()=>{
  const env={PACK1_RATE_LIMIT_SECRET:'r'.repeat(64)};
  const encrypted=encryptAppleRefreshToken('refresh-token-fixture',{env});
  assert.match(encrypted,/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(encrypted,/refresh-token-fixture/);
  assert.equal(decryptAppleRefreshToken(encrypted,{env}),'refresh-token-fixture');
  assert.equal(sanitizeAppleFirstName('  Ry\u0000an   Example  '),'Ry an Example');
  assert.equal(appleDisplayName(' Ada ',' Lovelace '),'Ada Lovelace');
});


test('unknown Apple signing keys force one JWKS refresh for key rotation',async()=>{
  const first=generateKeyPairSync('rsa',{modulusLength:2048});
  const rotated=generateKeyPairSync('rsa',{modulusLength:2048});
  const kid='rotated-key';
  const head=b64(JSON.stringify({alg:'RS256',kid,typ:'JWT'}));
  const payload=b64(JSON.stringify({
    iss:'https://appleid.apple.com',
    aud:APPLE_NATIVE_CLIENT_ID,
    exp:4102444800,
    sub:'apple-rotated-subject',
  }));
  const signature=sign('RSA-SHA256',Buffer.from(head+'.'+payload),rotated.privateKey);
  const token=head+'.'+payload+'.'+b64(signature);
  const firstJwk=first.publicKey.export({format:'jwk'});
  const rotatedJwk=rotated.publicKey.export({format:'jwk'});
  let calls=0;
  const fetcher=async()=>{
    calls++;
    return Response.json({keys:calls===1
      ? [{...firstJwk,kid:'old-key',alg:'RS256',use:'sig'}]
      : [{...rotatedJwk,kid,alg:'RS256',use:'sig'}]});
  };
  resetAppleKeyCache();
  const verified=await verifyAppleIdentityToken(token,{
    clientId:APPLE_NATIVE_CLIENT_ID,
    fetcher,
    now:2000,
  });
  assert.equal(verified.subject,'apple-rotated-subject');
  assert.equal(calls,2);
});
