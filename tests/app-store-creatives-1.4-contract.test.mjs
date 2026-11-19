import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const scriptPath='.github/scripts/app-store-upload-creatives-1.4.mjs';
const workflow=readFileSync('.github/workflows/app-store-creatives-1.4.yml','utf8');
const source=readFileSync(scriptPath,'utf8');
const manifest=JSON.parse(readFileSync('.github/app-store-creative-upload-request.json','utf8'));
function jpegDimensions(bytes) {
 let p=2;
 while(p+12<bytes.length) {
  if(bytes[p]!==255) {p++;continue;}
  while(bytes[p]===255) p++;
  const marker=bytes[p++];if(marker===217||marker===218)break;
  const length=bytes.readUInt16BE(p);
  if([192,193,194,195,198,199,201,202,203,205,206,207].includes(marker))
   return [bytes.readUInt16BE(p+5),bytes.readUInt16BE(p+3)];
  p+=length;
 }
 throw Error('Cannot determine JPEG dimensions');
}
test('Pack One 1.4 creative images are byte-pinned and exact Apple dimensions',()=>{
 assert.equal(manifest.operation,'upload-pack-one-14-header-and-search');
 assert.equal(manifest.appId,'6814318676');
 assert.equal(manifest.bundleId,'pro.packone.app');
 assert.equal(manifest.versionString,'1.4');
 assert.equal(manifest.locale,'en-US');
 for(const [basename,hash,dimensions] of [
  ['header',manifest.headerSha256,[3840,1646]],
  ['search',manifest.searchSha256,[3840,2560]],
 ]) {
  const data=readFileSync('.github/app-store-creative-assets/pack-one-14-'+basename+'.jpg');
  assert.equal(createHash('sha256').update(data).digest('hex'),hash);
  assert.deepEqual(jpegDimensions(data),dimensions);
 }
});
test('Apple creative uploader is syntax-valid, version-scoped, and does not release or submit',()=>{
 const result=spawnSync(process.execPath,['--check',scriptPath],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 assert.match(source,/versionString !== '1\.4'/);
 assert.match(source,/PREPARE_FOR_SUBMISSION/);
 assert.match(source,/appAssetLibraryImages/);
 assert.match(source,/PRODUCT_PAGE_HEADER_ASSET/);
 assert.match(source,/APP_STORE_SEARCH_RESULTS_ASSET/);
 assert.match(source,/live1_3_unchanged:true/);
 assert.doesNotMatch(source,/reviewSubmissions|appStoreVersionSubmissions|appStoreVersionReleaseRequests/);
 assert.match(workflow,/branches: \[main\]/);
 assert.match(workflow,/pack-one-mobile-release/);
 assert.match(workflow,/refs\/heads\/main/);
});
