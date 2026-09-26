import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { rewriteIncomingPath } from '../mobile/src/linking.ts';

test('mobile linking distinguishes modern shares, historical challenges, and public profiles', () => {
  const profile='0123456789abcdef';
  const share='a'.repeat(24);
  const historical='b'.repeat(12);

  assert.equal(rewriteIncomingPath('https://packone.pro/?profile='+profile), '/profile?key='+profile);
  assert.equal(rewriteIncomingPath('packone://profile?key='+profile), '/profile?key='+profile);
  assert.equal(rewriteIncomingPath('https://packone.pro/?game=draft-run&shared='+share), '/shared-run?shared='+share);
  assert.equal(rewriteIncomingPath('https://packone.pro/?game=draft-run&challenge='+share), '/shared-run?shared='+share);
  assert.equal(rewriteIncomingPath('https://packone.pro/?challenge='+historical), '/historical-challenge?challenge='+historical);
  assert.equal(rewriteIncomingPath('https://packone.pro/?game=draft-run&challenge='+historical), '/',
    'historical 12-character IDs must never be treated as modern Draft Run shares');
});

test('verified HTTPS entry paths are narrow and validate their identifiers', () => {
  const profile='0123456789abcdef';
  const share='c'.repeat(24);
  assert.equal(rewriteIncomingPath('https://packone.pro/open/profile/?key='+profile), '/profile?key='+profile);
  assert.equal(rewriteIncomingPath('https://packone.pro/open/shared/?id='+share), '/shared-run?shared='+share);
  assert.equal(rewriteIncomingPath('https://packone.pro/open/daily/?environment=powered-cube'), '/draft-run?environment=powered-cube');
  assert.equal(rewriteIncomingPath('https://packone.pro/open/profile/?key=bad'), '/');
  assert.equal(rewriteIncomingPath('https://packone.pro/open/shared/?id=bad'), '/');
  assert.equal(rewriteIncomingPath('https://example.com/open/shared/?id='+share), '/');
});

test('native direct routes strip untrusted query material while retaining allowed profile keys', () => {
  const profile='fedcba9876543210';
  assert.equal(rewriteIncomingPath('packone://profile?key='+profile+'&token=secret'), '/profile?key='+profile);
  assert.equal(rewriteIncomingPath('packone://account?googleHandoff=secret&returnTo=practice'), '/account?returnTo=practice');
});

test('modern shares reach the implemented screen and cannot silently become a Daily', () => {
  const share='d'.repeat(24);
  for (const url of [
    'packone://shared-run?shared='+share+'&accountToken=secret',
    'packone://draft-run?shared='+share+'&mode=practice',
    '/draft-run?shared='+share+'&environment=latest',
    'https://packone.pro/?game=draft-run&daily=1&shared='+share,
  ]) assert.equal(rewriteIncomingPath(url), '/shared-run?shared='+share);
  assert.equal(rewriteIncomingPath('/draft-run?shared=invalid'), '/shared-run');
  assert.equal(rewriteIncomingPath('packone://shared-run?shared=invalid'), '/shared-run');
  assert.equal(rewriteIncomingPath('//evil.example/open/shared/?id='+share), '/');
});

test('Android app-link configuration does not capture all Pack One HTTPS traffic', () => {
  const app=JSON.parse(fs.readFileSync('mobile/app.json','utf8'));
  assert.deepEqual(app.expo.ios.associatedDomains,['applinks:packone.pro']);
  const prefixes=app.expo.android.intentFilters
    .filter((item)=>item.action==='VIEW'&&item.autoVerify===true)
    .flatMap((item)=>item.data||[])
    .filter((item)=>item.scheme==='https'&&item.host==='packone.pro')
    .map((item)=>item.pathPrefix)
    .sort();
  assert.deepEqual(prefixes,['/open/daily/','/open/profile/','/open/shared/']);
  assert.equal(prefixes.includes('/'),false);
});
