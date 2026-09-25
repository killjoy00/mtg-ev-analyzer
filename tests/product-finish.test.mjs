import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('historical share reader is isolated from normal navigation',()=>{
 const boot=fs.readFileSync('bootstrap.mjs','utf8');
 assert.match(boot,/if \(historicalShare\)/);
 assert.doesNotMatch(boot,/cube-product\.mjs|home-today\.mjs|installCubeHome/);
 const historical=fs.readFileSync('historical-share.mjs','utf8');
 assert.match(historical,/social\.mjs/);
});
test('profile coverage links do not expose retired practice modes or bypass capabilities',()=>{
 const source=fs.readFileSync('profile-product.mjs','utf8');
 assert.match(source,/\/sets\/#\$\{encodeURIComponent\(entry.id\)\}/);
 assert.doesNotMatch(source,/\?practice=|\?game=draft-run&set=/);
});
