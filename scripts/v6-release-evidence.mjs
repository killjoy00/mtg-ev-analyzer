// Public Actions artifacts must not contain the private preservation baseline.
// Use the existing release credential only inside the trusted workflow. Keep
// that credential available until this release's rollback window is closed.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes,hkdfSync,createCipheriv,createDecipheriv} from 'node:crypto';

const context='pack-one/v6-release-preservation/v1';
function key(secret,salt) {
  if(typeof secret!=='string'||secret.length<16)throw Error('Release evidence credential is unavailable.');
  return hkdfSync('sha256',secret,salt,context,32);
}
export function sealEvidence(bytes,secret) {
  const salt=randomBytes(32),iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key(secret,salt),iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
  return JSON.stringify({version:1,salt:salt.toString('base64'),iv:iv.toString('base64'),
    tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')})+'\n';
}
export function openEvidence(envelope,secret) {
  try {
    const value=JSON.parse(envelope);
    if(value.version!==1)throw Error();
    const salt=Buffer.from(value.salt,'base64'),iv=Buffer.from(value.iv,'base64'),tag=Buffer.from(value.tag,'base64');
    if(salt.length!==32||iv.length!==12||tag.length!==16)throw Error();
    const decipher=createDecipheriv('aes-256-gcm',key(secret,salt),iv);
    decipher.setAAD(Buffer.from(context));decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(value.ciphertext,'base64')),decipher.final()]);
  } catch {throw Error('Release evidence authentication failed.');}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  const [action,input,output]=process.argv.slice(2);
  if(!['seal','open'].includes(action)||!input||!output)throw Error('Expected seal|open INPUT OUTPUT');
  const bytes=fs.readFileSync(input),secret=process.env.NEON_API_KEY;
  const result=action==='seal'?sealEvidence(bytes,secret):openEvidence(bytes,secret);
  fs.writeFileSync(output,result,{mode:0o600});
  console.log('Release evidence '+(action==='seal'?'protected.':'authenticated.'));
}
