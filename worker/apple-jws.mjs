import {X509Certificate,verify as verifySignature} from 'node:crypto';
import {APPLE_ROOT_CERTIFICATES} from './apple-root-certificates.mjs';

const LEAF_APP_STORE_OID=Buffer.from('060a2a864886f76364060b01','hex');
const INTERMEDIATE_APPLE_OID=Buffer.from('060a2a864886f76364060201','hex');
const MAX_SKEW_MS=60_000;

const problem=(message,code='APPLE_JWS_INVALID')=>Object.assign(Error(message),{status:400,code});

function decoded(value) {
  try{return JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}
  catch{throw problem('Apple signed data is invalid.');}
}
function certTime(cert,key) {
  const value=Date.parse(key==='from'?cert.validFrom:cert.validTo);
  if(!Number.isFinite(value))throw problem('Apple signing certificate date is invalid.','APPLE_JWS_CERT');
  return value;
}
function validAt(cert,at) {
  const time=at.getTime();
  return certTime(cert,'from')<=time+MAX_SKEW_MS
    && certTime(cert,'to')>=time-MAX_SKEW_MS;
}
function trustedCertificates(values) {
  try {
    return values.map(value=>value instanceof X509Certificate
      ?value
      :new X509Certificate(Buffer.isBuffer(value)?value:Buffer.from(value)));
  } catch {
    throw problem('Apple signing certificate is invalid.','APPLE_JWS_CERT');
  }
}

/**
 * Verify Apple's ES256 compact JWS and x5c chain without a runtime network
 * dependency. This mirrors Apple's server-library offline verification model:
 * pinned Apple roots, App Store leaf/intermediate OIDs, and certificate
 * validity evaluated at the payload signedDate.
 */
export async function verifyAppleJws(value,{roots=APPLE_ROOT_CERTIFICATES}={}) {
  const raw=String(value||'').trim();
  if(raw.length<64||raw.length>50000)throw problem('Apple signed data is invalid.');
  const parts=raw.split('.');
  if(parts.length!==3)throw problem('Apple signed data is invalid.');

  const header=decoded(parts[0]),payload=decoded(parts[1]);
  if(header?.alg!=='ES256'||!Array.isArray(header.x5c)||header.x5c.length!==3)
    throw problem('Apple signing certificate chain is invalid.','APPLE_JWS_CERT');

  const signedDate=Number(payload?.signedDate);
  if(!Number.isFinite(signedDate)||signedDate<=0)
    throw problem('Apple signed data date is invalid.');

  let chain;
  try {
    chain=header.x5c.map(item=>new X509Certificate(Buffer.from(String(item),'base64')));
  } catch {
    throw problem('Apple signing certificate chain is invalid.','APPLE_JWS_CERT');
  }
  const [leaf,intermediate]=chain;
  const root=trustedCertificates(roots).find(candidate=>
    intermediate.verify(candidate.publicKey)&&intermediate.issuer===candidate.subject);
  const chainValid=Boolean(root)
    && !leaf.ca
    && intermediate.ca
    && leaf.verify(intermediate.publicKey)
    && leaf.issuer===intermediate.subject
    && leaf.raw.includes(LEAF_APP_STORE_OID)
    && intermediate.raw.includes(INTERMEDIATE_APPLE_OID);
  if(!chainValid)throw problem('Apple signing certificate chain is invalid.','APPLE_JWS_CERT');

  const effective=new Date(signedDate);
  if(!validAt(leaf,effective)||!validAt(intermediate,effective)||!validAt(root,effective))
    throw problem('Apple signing certificate was not valid at the signed date.','APPLE_JWS_CERT');

  const signature=Buffer.from(parts[2],'base64url');
  const verified=signature.length===64&&verifySignature(
    'sha256',
    Buffer.from(parts[0]+'.'+parts[1]),
    {key:leaf.publicKey,dsaEncoding:'ieee-p1363'},
    signature,
  );
  if(!verified)throw problem('Apple signed data signature is invalid.','APPLE_JWS_SIGNATURE');
  return payload;
}
