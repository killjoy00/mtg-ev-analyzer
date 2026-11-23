import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(p,'utf8');
const renderer=read('.github/scripts/render-app-store-trophy-creatives-1.5.py');
const uploader=read('.github/scripts/app-store-upload-trophy-creatives-1.5.mjs');
const workflow=read('.github/workflows/app-store-trophy-creatives-1.5.yml');
const request=JSON.parse(read('.github/app-store-trophy-1.5-request.json'));

test('Pack One header/search show real trophy draft context, not 7-win copy or invented UI',()=>{
  assert.match(renderer,/Real picks from\\ntrophy drafts\./);
  assert.match(renderer,/Real trophy drafts\.\\nWhat would you pick\?/);
  assert.match(renderer,/Earlier picks|earlier picks/);
  assert.doesNotMatch(renderer,/7-win|7 win|fake|synthetic card/);
  assert.match(renderer,/source-native\/ios-prior\/iphone\/01-daily-decision\.jpg/);
  assert.match(renderer,/source-native\/ios-prior\/ipad\/01-daily-decision\.jpg/);
  assert.match(renderer,/source-native\/android\/android\/03-daily-hub\.jpg/);
  assert.match(renderer,/3840,1646/);
  assert.match(renderer,/3840,2560/);
});

test('Apple creative uploader targets only existing editable 1.5 and preserves 1.4',()=>{
  assert.equal(request.versionString,'1.5');
  assert.equal(request.appId,'6814318676');
  assert.equal(request.bundleId,'pro.packone.app');
  assert.equal(request.locale,'en-US');
  assert.equal(request.operation,'upload-pack-one-15-trophy-header-and-search');
  assert.match(uploader,/const target=await loc\('1\.5'\),live=await loc\('1\.4'\)/);
  assert.match(uploader,/PRODUCT_PAGE_HEADER_ASSET/);
  assert.match(uploader,/APP_STORE_SEARCH_RESULTS_ASSET/);
  assert.match(uploader,/live1_4_unchanged:true/);
  assert.match(uploader,/PREPARE_FOR_SUBMISSION/);
  assert.doesNotMatch(uploader,/reviewSubmissions|appStoreVersionSubmissions|appStoreVersionReleaseRequests/);
});

test('Publishing protected and exact content verified before Apple mutation',()=>{
  assert.match(workflow,/environment: pack-one-mobile-release/);
  assert.match(workflow,/if: github\.event_name == 'push'/);
  assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/source-native\/ios-prior/);
  assert.match(workflow,/source-native\/android/);
  assert.match(workflow,/14538515390/);
  assert.match(workflow,/14596259120/);
  assert.match(workflow,/headerSha256!==actual\.headerSha256/);
  assert.match(workflow,/searchSha256!==actual\.searchSha256/);
  assert.doesNotMatch(workflow,/submitReview|appStoreVersionSubmissions|releaseApp/);
});
