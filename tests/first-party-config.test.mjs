import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../leaderboard-config.js',import.meta.url),'utf8');
const evaluate=hostname=>{
  const context={location:{hostname},window:{}};
  vm.runInNewContext(source,context,{filename:'leaderboard-config.js'});
  return context.window.PACK1_API;
};

test('production host uses the first-party gateway for account and Draft Run traffic',()=>{
  const config=evaluate('packone.pro');
  assert.equal(config.firstParty,true);
  assert.equal(config.growthUrl,'https://api.packone.pro/growth');
  assert.equal(config.draftRunUrl,'https://api.packone.pro/draft');
});

test('localhost keeps the direct development-compatible endpoints',()=>{
  const config=evaluate('127.0.0.1');
  assert.equal(config.firstParty,false);
  assert.match(config.growthUrl,/pack1growth\.compute\.c-5\.us-east-2\.aws\.neon\.tech$/);
  assert.match(config.draftRunUrl,/draftrunapi\.compute\.c-5\.us-east-2\.aws\.neon\.tech$/);
});
