import { appendFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';

const issuerId = process.env.ASC_ISSUER_ID?.trim();
const keyId = process.env.ASC_KEY_ID?.trim();
const privateKeyText = process.env.ASC_PRIVATE_KEY;
const appId = process.env.PACKONE_ASC_APP_ID?.trim() || '6814318676';

if (!issuerId || !keyId || !privateKeyText) {
  throw new Error('ASC_ISSUER_ID, ASC_KEY_ID, and ASC_PRIVATE_KEY are required.');
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
params.set('sort', '-uploadedDate');
params.set('limit', '5');
params.set(
  'fields[builds]',
  'version,uploadedDate,processingState,usesNonExemptEncryption,buildAudienceType',
);

const response = await fetch(
  `https://api.appstoreconnect.apple.com/v1/builds?${params.toString()}`,
  { headers: { Authorization: `Bearer ${token}` } },
);

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

const builds = (data.data || []).map((build) => ({
  id: build.id,
  version: build.attributes?.version ?? null,
  uploadedDate: build.attributes?.uploadedDate ?? null,
  processingState: build.attributes?.processingState ?? null,
  usesNonExemptEncryption: build.attributes?.usesNonExemptEncryption ?? null,
  buildAudienceType: build.attributes?.buildAudienceType ?? null,
}));

if (builds.length === 0) {
  throw new Error(`No App Store Connect builds found for app ${appId}.`);
}

const latest = builds[0];
console.log(JSON.stringify({ appId, latest, builds }, null, 2));

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) {
  const compliance =
    latest.usesNonExemptEncryption === null
      ? 'not reported yet'
      : String(latest.usesNonExemptEncryption);
  appendFileSync(
    summaryPath,
    [
      '## Pack One TestFlight build status',
      '',
      `- App Store Connect app ID: \`${appId}\``,
      `- Latest build: \`${latest.version ?? 'unknown'}\``,
      `- Processing state: \`${latest.processingState ?? 'unknown'}\``,
      `- Uploaded: \`${latest.uploadedDate ?? 'unknown'}\``,
      `- Audience type: \`${latest.buildAudienceType ?? 'unknown'}\``,
      `- Uses non-exempt encryption: \`${compliance}\``,
      '',
    ].join('\n'),
  );
}
