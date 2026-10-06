import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(path)=>readFileSync(path,'utf8');
const eulaUrl='https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
const termsUrl='https://packone.pro/terms/';
const privacyUrl='https://packone.pro/privacy/';

test('guarded App Store metadata repair includes required legal links and rejected edit states',()=>{
  const script=read('.github/scripts/app-store-submission-metadata.mjs');
  assert.ok(script.includes(eulaUrl));
  assert.match(script,/Pack One Terms:/);
  assert.match(script,/Privacy Policy:/);
  for(const state of ['REJECTED','METADATA_REJECTED','DEVELOPER_REJECTED']){
    assert.ok(script.includes(state));
  }
  assert.match(script,/appStoreVersionLocalizations/);
  assert.match(script,/attributes:\{description:repairedDescription\}/);
  assert.doesNotMatch(script,/\/reviewSubmissions/);
  assert.doesNotMatch(script,/relationships\/build/);
});

test('reviewed Apple description source keeps explicit EULA, Pack One Terms, and privacy URLs',()=>{
  const script=read('.github/scripts/store-submission-config.mjs');
  const docs=read('docs/mobile-store-submission.md');
  const appleDescription=script.match(/const appleDescription=`([\\s\\S]*?)`;\n\nconst playShort=/)?.[1]||'';
  for(const value of [eulaUrl,termsUrl,privacyUrl]){
    assert.ok(appleDescription.includes(value));
    assert.ok(docs.includes(value));
  }
  assert.match(appleDescription,/Terms of Use \(EULA\): https:\/\/www\.apple\.com\/legal\/internet-services\/itunes\/dev\/stdeula\//);
  assert.doesNotMatch(appleDescription,/See packone\.pro\/terms\//);
});

test('guarded request is scoped to metadata repair and does not authorize submission or release',()=>{
  const request=JSON.parse(read('.github/app-store-submission-metadata-request.json'));
  assert.equal(request.operation,'configure-app-store-safe-submission-metadata');
  assert.match(request.reason,/standard Apple Terms of Use \(EULA\)/);
  assert.match(request.reason,/Do not submit for review/);
  assert.match(request.reason,/release the version/);
});
