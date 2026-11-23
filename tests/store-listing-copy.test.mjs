import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const copy=JSON.parse(readFileSync('.github/pack-one-store-copy-en-US.json','utf8'));
const publisher=readFileSync('.github/scripts/apply-store-listing-copy.mjs','utf8');
const workflow=readFileSync('.github/workflows/store-listing-copy.yml','utf8');

test('copy targets the existing iOS 1.5 and Google Play en-US listing',()=>{
  assert.equal(copy.locale,'en-US');
  assert.equal(copy.apple.version,'1.5');
  assert.equal(copy.apple.name,'Pack One');
  assert.equal(copy.apple.subtitle,'Daily Limited Draft Challenge');
  assert.ok(copy.apple.subtitle.length<=30);
  assert.ok(copy.apple.promotionalText.length<=170);
  assert.ok(copy.apple.description.length<=4000);
  assert.ok(Buffer.byteLength(copy.apple.keywords,'utf8')<=100);
  assert.ok(copy.apple.keywords.split(',').every(k=>k.trim().length>2));
  assert.equal(copy.googlePlay.title,'Pack One: Draft Challenge');
  assert.ok(copy.googlePlay.title.length<=30);
  assert.ok(copy.googlePlay.shortDescription.length<=80);
  assert.ok(copy.googlePlay.fullDescription.length<=4000);
});

test('explicit Pack 1 and pack1 search variations without trademark keywords',()=>{
  assert.match(copy.googlePlay.shortDescription,/\bPack 1\b/);
  assert.ok(copy.apple.keywords.split(',').includes('pack1'));
  assert.ok(copy.apple.keywords.split(',').includes('pack 1'));
  assert.doesNotMatch(copy.apple.keywords,/\bmagic\b|\bwizards\b|\bmtg\b/i);
});

test('listing copy accurately describes free and Elite choices and retains attribution',()=>{
  for(const description of [copy.apple.description,copy.googlePlay.fullDescription]){
    for(const daily of ['Daily Draft Run','Daily Powered Cube','Daily Latest Set'])assert.ok(description.includes(daily));
    assert.match(description,/as many regular Draft Run practice games as you want/);
    assert.match(description,/Elite adds Powered Cube and custom-set practice/);
    assert.match(description,/don't need an account to play/);
    assert.match(description,/partial credit/);
    assert.match(description,/unofficial Fan Content/);
    assert.match(description,/not approved or endorsed by Wizards/);
    assert.match(description,/Scryfall/);
    assert.match(description,/https:\/\/packone\.pro\/terms\//);
  }
  assert.doesNotMatch(copy.apple.description,/\bAndroid\b|Google Play/);
  for(const link of [
    'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/',
    'https://packone.pro/terms/',
    'https://packone.pro/privacy/'
  ])assert.ok(copy.apple.description.includes(link));
});

test('publisher edits iOS 1.5 version copy and Play listing only',()=>{
  assert.match(publisher,/appleVersion='1\.5'/);
  assert.match(publisher,/Owner-created iOS 1\.5 record is missing/);
  assert.match(publisher,/editable\.has\(state\)/);
  assert.match(publisher,/appStoreVersionLocalizations/);
  assert.match(publisher,/promotionalText:apple\.promotionalText/);
  assert.match(publisher,/fields:\['title','shortDescription','fullDescription'\]/);
  assert.doesNotMatch(publisher,/\/v1\/appInfos|appInfoLocalizations|reviewSubmissions|releaseRequests/);
  assert.doesNotMatch(publisher,/\/tracks\/|\/images\/|\/bundles\/|appStoreVersionSubmissions/);
  assert.match(workflow,/environment: pack-one-mobile-release/);
  assert.match(workflow,/refs\/heads\/main/);
  assert.match(workflow,/store-listing-copy-request\.json/);
  assert.doesNotMatch(workflow,/workflow_dispatch:|pull_request:/);
});
