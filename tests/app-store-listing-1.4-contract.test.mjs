import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const metadata=JSON.parse(readFileSync('.github/pack-one-app-store-1.4.json','utf8'));
const script=readFileSync('.github/scripts/app-store-listing-1.4.mjs','utf8');
const workflow=readFileSync('.github/workflows/app-store-listing-1.4.yml','utf8');
test('iOS 1.4 copy and legal requirements',()=>{
 assert.equal(metadata.version,'1.4');assert.equal(metadata.platform,'IOS');
 assert.equal(metadata.appId,'6814318676');assert.equal(metadata.subtitle,'Daily Limited Draft Challenge');
 assert.ok(metadata.subtitle.length<=30);assert.ok(metadata.promotionalText.length<=170);
 assert.ok(Buffer.byteLength(metadata.keywords)<=100);assert.ok(metadata.description.length<=4000);
 assert.match(metadata.description,/Daily Powered Cube/);assert.match(metadata.description,/partial credit/);
 for(const url of ['https://www.apple.com/legal/internet-services/itunes/dev/stdeula/','https://packone.pro/terms/','https://packone.pro/privacy/'])assert.ok(metadata.description.includes(url));
 assert.doesNotMatch(metadata.keywords,/magic|wizards|\bmtg\b/i);
});
test('write automation cannot submit or release',()=>{
 assert.match(script,/version!=='1.4'/);assert.match(script,/Version 1.4 not editable/);
 assert.doesNotMatch(script,/reviewSubmissions|releaseRequests|POST.*reviewSubmission/);
 assert.match(workflow,/pack-one-mobile-release/);
 assert.match(workflow,/refs\/heads\/main/);
});
