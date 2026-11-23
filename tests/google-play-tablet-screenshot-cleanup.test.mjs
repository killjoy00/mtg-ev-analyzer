import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync('.github/scripts/remove-stale-google-play-tablet-screenshots.mjs','utf8');
const wf=readFileSync('.github/workflows/remove-stale-google-play-tablet-screenshots.yml','utf8');
const req=JSON.parse(readFileSync('.github/google-play-tablet-screenshot-cleanup-request.json','utf8'));

test('only the exactly identified duplicate tablet screenshot can be deleted',()=>{
 assert.equal(req.operation,'remove-two-pinned-obsolete-tablet-screenshots');
 assert.equal(req.packageName,'pro.packone.app');
 assert.equal(req.language,'en-US');
 assert.equal(req.expectedImageId,'3455473393333885257');
 assert.equal(req.expectedSha256,'ee1e899151c069698eab302a1936fd2237a3f0e1a692ee187fbf4687bbbc2428');
 assert.match(src,/s\[type\]\[0\]\.id!==expectedLegacy\.id/);
 assert.match(src,/s\[type\]\[0\]\.sha256!==expectedLegacy\.sha256/);
 assert.match(src,/for\(const type of \['sevenInchScreenshots','tenInchScreenshots'\]\)/);
 assert.match(src,/if\(s\[type\]\.length!==1/);
});
test('preserve all approved phone, icon, feature image and listing copy',()=>{
 assert.match(src,/phoneHashes\.length!==6/);
 assert.match(src,/s\.phoneScreenshots\.length!==6/);
 assert.match(src,/expectedIcon/);
 assert.match(src,/expectedFeature/);
 assert.match(src,/assertProtected\(before\)/);
 assert.match(src,/assertProtected\(pending\)/);
 assert.match(src,/assertProtected\(after\)/);
 assert.match(src,/listingAfter\[key\]!==listing\[key\]/);
 assert.match(src,/fingerprint\(after\[type\]\)!==fingerprint\(before\[type\]\)/);
 assert.doesNotMatch(src,/\/edits\/'\+edit\+'\/listings\/'\+locale\+'\/phoneScreenshots'\s*,\s*\{method:'DELETE'\}/);
 assert.doesNotMatch(src,/reviewSubmissions|appStoreVersionSubmissions|\/tracks\//);
});
test('only a protected main push can mutate Google Play',()=>{
 assert.match(wf,/if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
 assert.match(wf,/environment: pack-one-mobile-release/);
 assert.match(wf,/github\.event_name == 'push'/);
 assert.match(wf,/3455473393333885257/);
 assert.match(wf,/ee1e899151c069698eab302a1936fd2237a3f0e1a692ee187fbf4687bbbc2428/);
 assert.match(src,/finally/);
 assert.match(src,/verifier.*'DELETE'/);
});
