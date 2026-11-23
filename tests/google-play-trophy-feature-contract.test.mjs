import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
const req=JSON.parse(read('.github/google-play-trophy-feature-request.json'));
const render=read('.github/scripts/render-reviewed-play-trophy-feature.py');
const publish=read('.github/scripts/publish-reviewed-play-trophy-feature.mjs');
const workflow=read('.github/workflows/publish-reviewed-play-trophy-feature.yml');

test('the exact approved Pack One trophy graphic is based on real native decisions',()=>{
  assert.equal(req.operation,'publish-reviewed-trophy-feature-graphic');
  assert.equal(req.packageName,'pro.packone.app');
  assert.equal(req.language,'en-US');
  assert.equal(req.jpegSha256,'8059f51d5e826dddf718d19d50e1cb9e6c13b8c0657b06e95aea3912f185672d');
  assert.equal(req.pngSha256,'c12e4aecc3472b457a20b17c4e8e272e424831564ee6957545853a1b010c9ff3');
  assert.match(render,/Real picks from/);
  assert.match(render,/trophy drafts/);
  assert.match(render,/source-native\/ios-prior\/ipad\/01-daily-decision\.jpg/);
  assert.match(render,/source-native\/android\/android\/03-daily-hub\.jpg/);
  assert.match(render,/src=source\.crop/);
  assert.match(render,/approved\[key\]!=sha/);
  assert.doesNotMatch(render,/7-win|7 win|synthetic cards/);
});

test('the new feature replaces only the exact old one and preserves other media',()=>{
  assert.equal(req.expectedCurrentImageId,'16376716273099719508');
  assert.equal(req.expectedCurrentFeatureSha256,'c4c5f8437f8f195ddfde3755c2b7cd4ff52dd8f01e0479bba8f6324ffe73e969');
  assert.match(publish,/sha256/);
  assert.match(publish,/expectedCurrentImageId/);
  assert.match(publish,/expectedCurrentFeatureSha256/);
  assert.match(publish,/phoneScreenshots\.length!==6/);
  assert.match(publish,/sevenInchScreenshots\.length\|\|s\.tenInchScreenshots\.length/);
  assert.match(publish,/imageType\.filter\(x=>x!=='featureGraphic'\)/);
  assert.match(publish,/featureGraphic\?uploadType=resumable/);
  assert.match(publish,/listing\[field\]!==listingAfter\[field\]/);
  assert.match(publish,/PACK_ONE_FEATURE_GRAPHIC_RECEIPT/);
  assert.doesNotMatch(publish,/\/tracks\/|releaseRequests|reviewSubmissions/);
});

test('production requires a successful read-only render and protected main environment',()=>{
  assert.match(workflow,/environment: pack-one-mobile-release/);
  assert.match(workflow,/if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/14538515390/);
  assert.match(workflow,/44658473163/);
  assert.match(workflow,/sha256/);
  assert.match(workflow,/Pillow==12\.3\.0/);
  assert.match(workflow,/Publish approved Pack One trophy feature graphic/);
  assert.doesNotMatch(workflow,/appStoreVersionSubmissions|\/tracks\//);
});
