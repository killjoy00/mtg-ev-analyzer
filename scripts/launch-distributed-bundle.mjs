import fs from 'node:fs';
import {createHmac,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {pathToFileURL} from 'node:url';

function key() {
  if(!process.env.NEON_API_KEY||!/^\d+$/.test(process.env.GITHUB_RUN_ID||''))throw Error('Missing isolated bundle encryption context.');
  return createHmac('sha256',process.env.NEON_API_KEY).update('pack1-load-bundle:'+process.env.GITHUB_RUN_ID).digest();
}
export function seal(value) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');
}
export function unseal(value) {
  const bytes=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));
  decipher.setAuthTag(bytes.subarray(12,28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
}
function main() {
  if(process.argv[2]==='pack') {
    const fixture=JSON.parse(fs.readFileSync(process.env.LOAD_FIXTURE_FILE,'utf8'));
    fs.mkdirSync('artifacts/load-private',{recursive:true});
    fs.writeFileSync('artifacts/load-private/fixtures.enc',seal({...fixture,preview:process.env.PREVIEW_ACCESS_KEY}));
  } else if(process.argv[2]==='unpack') {
    const fixture=unseal(fs.readFileSync('artifacts/load-private/fixtures.enc','utf8'));
    if(!/^[a-f0-9]{64}$/.test(fixture.preview||''))throw Error('Invalid isolated preview access.');
    console.log('::add-mask::'+fixture.preview);
    fs.appendFileSync(process.env.GITHUB_ENV,'PREVIEW_ACCESS_KEY='+fixture.preview+'\n');
    fs.writeFileSync(process.env.LOAD_FIXTURE_FILE,JSON.stringify(fixture),{mode:0o600});
  } else throw Error('Unknown bundle operation.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)try {main();}catch{console.error('Isolated encrypted fixture bundle failed.');process.exitCode=1;}
