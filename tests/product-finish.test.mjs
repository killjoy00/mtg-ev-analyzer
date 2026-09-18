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
test('profile archive keeps existing Cube entries on the current reader',()=>{
 const source=fs.readFileSync('profile-product.mjs','utf8');
 assert.match(source,/\?game=draft-run&set=powered-cube/);
});
