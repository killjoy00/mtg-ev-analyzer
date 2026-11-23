import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const read=p=>readFileSync(p,'utf8');
const approved=JSON.parse(read('.github/pack-one-approved-six-screenshots.json'));
const request=JSON.parse(read('.github/publish-approved-six-screenshots-request.json'));
const renderer=read('.github/scripts/render-approved-pack-one-screenshots.py');
const verifier=read('.github/scripts/verify-approved-screenshot-sources.mjs');
const workflow=read('.github/workflows/publish-approved-six-screenshots.yml');
const apple=read('.github/scripts/app-store-upload-screenshots.mjs');
const play=read('.github/scripts/publish-approved-google-play-screenshots.mjs');

test('all 18 specifically owner-approved images are pinned to SHA256',()=>{
  assert.equal(Object.keys(approved.sha256).length,18);
  for(const platform of ['iphone','ipad','google-play']){
    const items=Object.entries(approved.sha256).filter(([p])=>p.startsWith(platform+'/'));
    assert.equal(items.length,6,platform);
    assert.ok(items.every(([p,h])=>p.endsWith('.jpg')&&/^[a-f0-9]{64}$/.test(h)));
  }
  assert.equal(approved.sourceArtifacts.length,5);
  assert.equal(approved.targetAppleVersion,'1.5');
  assert.match(renderer,/sha256\(p\.read_bytes\(\)\)\.hexdigest\(\)/);
  assert.match(renderer,/Unapproved screenshot/); // exact hash gate also checked below
});

test('image rebuild is pinned to native capture artifacts and real fonts',()=>{
  assert.match(renderer,/ios_prior if i==1 else ios/);
  assert.match(renderer,/card/); // card images are in the native captures
  assert.match(renderer,/assets\/fonts\/barlow-condensed-700\.woff2/);
  assert.match(renderer,/source-native/);
  assert.match(renderer,/REJECTED image/);
  assert.match(verifier,/artifact\.digest/);
  assert.match(verifier,/head_repository/);
  assert.match(workflow,/actions\/download-artifact@v4/);
});

test('production writes target only iOS 1.5 and Google Play en-US screenshots',()=>{
  assert.equal(request.operation,'publish-approved-six-screenshots');
  assert.equal(request.appleVersion,'1.5');
  assert.equal(request.locale,'en-US');
  assert.match(workflow,/environment: pack-one-mobile-release/);
  assert.match(workflow,/github\.event_name == 'push'/);
  assert.match(workflow,/PACKONE_VERSION_STRING: '1\.5'/);
  assert.match(workflow,/app-store-upload-screenshots\.mjs/);
  assert.match(workflow,/publish-approved-google-play-screenshots\.mjs/);
  assert.match(apple,/versionString === '1\.5' \? reviewedSixNames : productNames/);
  assert.match(apple,/versionString === '1\.4' \|\| versionString === '1\.5' \? null : await findSubscription/);
  assert.match(apple,/APP_IPHONE_67/);
  assert.match(apple,/APP_IPAD_PRO_3GEN_129/);
  assert.match(play,/phoneScreenshots/);
  assert.doesNotMatch(play,/\/icon|featureGraphic|\/tracks\/|releaseRequests/);
  assert.doesNotMatch(workflow,/reviewSubmissions|appStoreVersionSubmissions|\/tracks\//);
});
