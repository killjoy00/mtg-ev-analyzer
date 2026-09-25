import { appendFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';

const issuerId = process.env.ASC_ISSUER_ID?.trim();
const keyId = process.env.ASC_KEY_ID?.trim();
const privateKeyText = process.env.ASC_PRIVATE_KEY;
const appId = process.env.PACKONE_ASC_APP_ID?.trim() || '6814318676';
const runNumber = Number(process.env.GITHUB_RUN_NUMBER || '0');

if (!issuerId || !keyId || !privateKeyText) {
  throw new Error('ASC_ISSUER_ID, ASC_KEY_ID, and ASC_PRIVATE_KEY are required.');
}
if (!Number.isSafeInteger(runNumber) || runNumber < 1) {
  throw new Error('GITHUB_RUN_NUMBER must be a positive integer.');
}

function base64url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.toString('base64url');
}

const now = Math.floor(Date.now() / 1000);
const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
const payload = base64url(JSON.stringify({
  iss: issuerId,
  aud: 'appstoreconnect-v1',
  iat: now,
  exp: now + 15 * 60,
}));
const signingInput = `${header}.${payload}`;
const signature = sign('sha256', Buffer.from(signingInput), {
  key: createPrivateKey(privateKeyText),
  dsaEncoding: 'ieee-p1363',
});
const token = `${signingInput}.${base64url(signature)}`;

const params = new URLSearchParams();
params.set('filter[app]', appId);
params.set('fields[builds]', 'version');
params.set('limit', '200');

let url = `https://api.appstoreconnect.apple.com/v1/builds?${params.toString()}`;
let highestStoreBuild = 0;

while (url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.text();
  let data;
  try {
    data = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(`App Store Connect returned non-JSON HTTP ${response.status}: ${body}`);
  }
  if (!response.ok) {
    throw new Error(
      `App Store Connect build query failed with HTTP ${response.status}: ${JSON.stringify(data)}`,
    );
  }

  for (const build of data.data || []) {
    const version = build.attributes?.version;
    if (typeof version !== 'string' || !/^[1-9]\d*$/.test(version)) continue;
    const number = Number(version);
    if (Number.isSafeInteger(number)) highestStoreBuild = Math.max(highestStoreBuild, number);
  }

  url = data.links?.next || '';
}

const workflowFloor = 100000 + runNumber;
const nextBuildNumber = Math.max(highestStoreBuild + 1, workflowFloor);

console.log(JSON.stringify({
  appId,
  highestStoreBuild,
  workflowFloor,
  nextBuildNumber,
}));

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `highest_store_build=${highestStoreBuild}`,
      `workflow_floor=${workflowFloor}`,
      `next_build_number=${nextBuildNumber}`,
      '',
    ].join('\n'),
  );
}
