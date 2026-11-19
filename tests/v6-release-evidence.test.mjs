import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sealEvidence,openEvidence} from '../scripts/v6-release-evidence.mjs';
import {assertHistoryPreserved} from '../scripts/v6-release-state.mjs';
const secret='synthetic-release-credential-only';
test('private release evidence round-trips without publishing record fingerprints or counts',()=>{
  const bytes=Buffer.from(JSON.stringify({history:{sessions:[{fingerprint:'synthetic-private-row',n:123456}]}}));
  const a=sealEvidence(bytes,secret),b=sealEvidence(bytes,secret);
  assert.notEqual(a,b);
  assert.doesNotMatch(a,/synthetic-private-row|123456|synthetic-release-credential/);
  assert.deepEqual(openEvidence(a,secret),bytes);
  assert.throws(()=>openEvidence(a,'different-synthetic-credential'),/authentication failed/);
  for(const field of ['salt','iv','tag','ciphertext']) {
    const value=JSON.parse(a),data=Buffer.from(value[field],'base64');data[0]^=1;value[field]=data.toString('base64');
    assert.throws(()=>openEvidence(JSON.stringify(value),secret),/authentication failed/);
  }
  assert.throws(()=>sealEvidence(bytes,''),/credential is unavailable/);
  assert.throws(()=>assertHistoryPreserved({scores:[{fingerprint:'synthetic-private-row',n:1}]},{scores:[]}),
    error=>error.message==='Release history preservation check failed.');
});
test('public release artifacts contain encrypted preservation evidence only',()=>{
  const source=fs.readFileSync(new URL('../.github/workflows/release-v6-corpus.yml',import.meta.url),'utf8');
  const uploads=source.split('uses: actions/upload-artifact@v4').slice(1);
  assert.equal(uploads.length,2);
  for(const block of uploads){
    assert.match(block,/generated\/v6-release-baseline\.enc/);
    assert.doesNotMatch(block,/generated\/v6-release-baseline\.json/);
  }
  assert.match(source,/v6-release-evidence\.mjs open generated\/v6-stage-evidence\/v6-release-baseline\.enc/);
  assert.match(source,/v6-release-evidence\.mjs seal generated\/v6-release-baseline\.json/);
});
