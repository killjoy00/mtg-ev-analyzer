import { createPrivateKey, sign } from 'node:crypto';

export function createAscTokenProvider({ issuerId, keyId, privateKeyText, nowSeconds = () => Math.floor(Date.now() / 1000) }) {
  const key = createPrivateKey(privateKeyText);
  let token;
  let refreshAt = 0;
  const b64 = (value) => Buffer.from(value).toString('base64url');
  return () => {
    const now = nowSeconds();
    if (!token || now >= refreshAt) {
      const header = b64(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
      const payload = b64(JSON.stringify({ iss: issuerId, aud: 'appstoreconnect-v1', iat: now, exp: now + 15 * 60 }));
      const input = `${header}.${payload}`;
      const signature = sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
      token = `${input}.${signature.toString('base64url')}`;
      refreshAt = now + 14 * 60;
    }
    return token;
  };
}

export async function waitForAsset({ resourceType, id, readAsset, maxAttempts = 300, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), onProgress = () => {} }) {
  let lastState;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await readAsset();
    const delivery = result?.data?.attributes?.assetDeliveryState;
    const state = delivery?.state;
    if (state !== lastState || attempt === 1 || attempt % 30 === 0) {
      onProgress({ resourceType, id, attempt, state: state ?? null, errors: delivery?.errors ?? [] });
    }
    lastState = state;
    if (state === 'COMPLETE') return result.data;
    if (state === 'FAILED') {
      throw new Error(`${resourceType} ${id} failed processing: ${JSON.stringify(delivery?.errors || [])}`);
    }
    if (attempt < maxAttempts) await wait(2000);
  }
  throw new Error(`${resourceType} ${id} did not finish processing in time (last state: ${lastState ?? 'unknown'}).`);
}
