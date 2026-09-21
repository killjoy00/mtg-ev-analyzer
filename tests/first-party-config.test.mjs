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
  assert.equal(config.authBase,'https://ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth');
  assert.equal(config.growthUrl,'https://api.packone.pro/growth');
  assert.equal(config.draftRunUrl,'https://api.packone.pro/draft');
});

test('the legacy leaderboard service also goes through the gateway in production',()=>{
  // Left on its direct origin it would mint a second guest player outside the
  // first-party cookie, forking the identity an account is linked to.
  assert.equal(evaluate('packone.pro').url,'https://api.packone.pro/legacy');
});

test('only the apex host is first-party, matching the gateway origin allowlist',()=>{
  // www redirects to the apex before any script runs, and the gateway answers
  // 403 for that origin, so claiming it here could only ever fail every call.
  assert.equal(evaluate('www.packone.pro').firstParty,false);
});

test('localhost keeps the direct development-compatible endpoints',()=>{
  const config=evaluate('127.0.0.1');
  assert.equal(config.firstParty,false);
  assert.equal(config.authBase,'https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth');
  assert.match(config.url,/pack1api\.compute\.c-5\.us-east-2\.aws\.neon\.tech$/);
  assert.match(config.growthUrl,/pack1growth\.compute\.c-5\.us-east-2\.aws\.neon\.tech$/);
  assert.match(config.draftRunUrl,/draftrunapi\.compute\.c-5\.us-east-2\.aws\.neon\.tech$/);
});


test('query, hash, cookies and storage are not configuration channels for Auth selection',()=>{
  const local=evaluate('localhost'),prod=evaluate('packone.pro');
  assert.equal(local.authBase,'https://ep-lively-river-b5tky50l.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth');
  assert.equal(prod.authBase,'https://ep-hidden-bonus-ayfmcpys.neonauth.c-5.us-east-2.aws.neon.tech/pack1/auth');
  assert.ok(!source.includes('searchParams')&&!source.includes('localStorage')&&!source.includes('document.cookie'));
});
