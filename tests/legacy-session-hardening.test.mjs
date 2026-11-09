import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../worker/index.js',import.meta.url),'utf8');

test('legacy HMAC tokens use SubtleCrypto verification with strict token shape',()=>{
  const verifier=source.split('async function verifyToken(token) {')[1]?.split('\nasync function authPlayer')[0]||'';
  assert.match(verifier,/crypto\.subtle\.verify\(/);
  assert.doesNotMatch(verifier,/signature\([^)]*\)\s*\) ===|=== supplied/);
  assert.match(verifier,/\[A-Za-z0-9_-\]\{43\}/);
  assert.match(verifier,/return valid \? playerId : null/);
});

test('legacy player secret is read once per cached signing key',()=>{
  const secret=source.split('async function playerSecret() {')[1]?.split('\nasync function signingKey')[0]||'';
  assert.ok(secret.includes('ON CONFLICT(key) DO NOTHING'));
  assert.ok(secret.indexOf("SELECT value FROM settings")<secret.indexOf('INSERT INTO settings'),
    'an existing secret should not be rewritten');
  const cache=source.split('async function signingKey() {')[1]?.split('\nasync function signature')[0]||'';
  assert.match(cache,/if \(!signingKeyPromise\)/);
  assert.match(cache,/signingKeyPromise = null/);
  assert.match(cache,/\['sign', 'verify'\]/);
});
