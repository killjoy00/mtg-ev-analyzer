import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import test from 'node:test';
import { createAscTokenProvider, waitForAsset } from '../.github/scripts/app-store-asset-upload-helpers.mjs';

const asset = (state, errors = []) => ({ data: { id: 'reviewed-image', attributes: { assetDeliveryState: { state, errors } } } });

test('slow Apple processing can complete beyond the old 90-poll limit', async () => {
  let calls = 0;
  let waits = 0;
  const progress = [];
  const result = await waitForAsset({
    resourceType: 'appScreenshots', id: 'reviewed-image',
    readAsset: async () => asset(++calls === 130 ? 'COMPLETE' : 'UPLOAD_COMPLETE'),
    wait: async (ms) => { assert.equal(ms, 2000); waits += 1; },
    onProgress: (item) => progress.push(item),
  });
  assert.equal(result.id, 'reviewed-image');
  assert.equal(calls, 130);
  assert.equal(waits, 129);
  assert.equal(progress.at(-1).state, 'COMPLETE');
  assert.ok(progress.some((item) => item.attempt === 120));
});

test('Apple rejection fails immediately and retains provider errors', async () => {
  let calls = 0;
  await assert.rejects(waitForAsset({
    resourceType: 'appScreenshots', id: 'reviewed-image',
    readAsset: async () => { calls += 1; return asset('FAILED', [{ code: 'INVALID_IMAGE' }]); },
    wait: async () => assert.fail('Failed images must not wait'),
  }), /failed processing.*INVALID_IMAGE/);
  assert.equal(calls, 1);
});

test('processing stays bounded and cannot mark a pending asset complete', async () => {
  let calls = 0;
  await assert.rejects(waitForAsset({
    resourceType: 'appScreenshots', id: 'reviewed-image', maxAttempts: 3,
    readAsset: async () => { calls += 1; return asset('UPLOAD_COMPLETE'); },
    wait: async () => {},
  }), /did not finish processing.*last state: UPLOAD_COMPLETE/);
  assert.equal(calls, 3);
});

test('long uploads refresh the same scoped ES256 authorization before expiry', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  let now = 1_000_000;
  const getToken = createAscTokenProvider({ issuerId: 'issuer', keyId: 'key-id', privateKeyText: privateKey.export({ type: 'pkcs8', format: 'pem' }), nowSeconds: () => now });
  const first = getToken();
  now += 14 * 60 - 1;
  assert.equal(getToken(), first);
  now += 1;
  const refreshed = getToken();
  assert.notEqual(refreshed, first);
  const [header, payload, signature] = refreshed.split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'ES256');
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), { iss: 'issuer', aud: 'appstoreconnect-v1', iat: now, exp: now + 15 * 60 });
  assert.equal(verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
});
