import { createPrivateKey, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const issuerId = process.env.ASC_ISSUER_ID?.trim();
const keyId = process.env.ASC_KEY_ID?.trim();
const privateKeyText = process.env.ASC_PRIVATE_KEY;
const appId = '6814318676';
const bundleId = 'pro.packone.app';
const versionString = process.argv[2]?.trim();

const outputPath = process.env.PACKONE_ASC_VERSION_OUTPUT?.trim();
let versionsBefore = [];
let version = null;
let created = false;
let creationAttempted = false;
let versionDoc = null;
let state = null;

function persistEvidence(value) {
  if (outputPath) writeFileSync(outputPath, JSON.stringify(value, null, 2) + '\n');
}

try {
if (!issuerId || !keyId || !privateKeyText) throw new Error('App Store Connect credentials are required.');
if (versionString !== '1.1') throw new Error('This guarded operation is pinned to App Store version 1.1.');

function b64(value) {
  return Buffer.from(value).toString('base64url');
}

const now = Math.floor(Date.now() / 1000);
const header = b64(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
const payload = b64(JSON.stringify({ iss: issuerId, aud: 'appstoreconnect-v1', iat: now, exp: now + 900 }));
const signingInput = `${header}.${payload}`;
const signature = sign('sha256', Buffer.from(signingInput), {
  key: createPrivateKey(privateKeyText),
  dsaEncoding: 'ieee-p1363',
});
const token = `${signingInput}.${signature.toString('base64url')}`;

async function asc(path, { method = 'GET', body } = {}) {
  const url = path.startsWith('https://') ? path : `https://api.appstoreconnect.apple.com${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(`${method} ${path} HTTP ${response.status}: ${JSON.stringify(data)}`);
    error.status = response.status;
    error.provider = data;
    throw error;
  }
  return data;
}

const app = await asc(`/v1/apps/${appId}?fields%5Bapps%5D=bundleId`);
if (app.data?.attributes?.bundleId !== bundleId) throw new Error('Unexpected App Store Connect app record.');

const listPath = `/v1/apps/${appId}/appStoreVersions?filter%5Bplatform%5D=IOS&fields%5BappStoreVersions%5D=platform,versionString,appVersionState,releaseType,createdDate&limit=200`;
const initial = await asc(listPath);
versionsBefore = (initial?.data || []).map((version) => ({
  id: version.id,
  platform: version.attributes?.platform ?? null,
  versionString: version.attributes?.versionString ?? null,
  appVersionState: version.attributes?.appVersionState ?? null,
  releaseType: version.attributes?.releaseType ?? null,
  createdDate: version.attributes?.createdDate ?? null,
}));

version = (initial?.data || []).find(
  (candidate) => candidate.attributes?.platform === 'IOS' && candidate.attributes?.versionString === versionString,
);

if (!version) {
  creationAttempted = true;
  const createdDoc = await asc('/v1/appStoreVersions', {
    method: 'POST',
    body: {
      data: {
        type: 'appStoreVersions',
        attributes: {
          platform: 'IOS',
          versionString,
        },
        relationships: {
          app: {
            data: {
              type: 'apps',
              id: appId,
            },
          },
        },
      },
    },
  });
  version = createdDoc?.data;
  created = true;
}

if (!version?.id) throw new Error(`App Store version ${versionString} is missing after ensure operation.`);

versionDoc = await asc(`/v1/appStoreVersions/${encodeURIComponent(version.id)}`);
state = versionDoc.data?.attributes?.appVersionState ?? versionDoc.data?.attributes?.appStoreState ?? null;
if (!['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW'].includes(state)) {
  throw new Error(`App Store version ${versionString} is not safely editable: ${state}`);
}

if (versionDoc.data?.attributes?.releaseType !== 'MANUAL') {
  await asc(`/v1/appStoreVersions/${encodeURIComponent(version.id)}`, {
    method: 'PATCH',
    body: {
      data: {
        type: 'appStoreVersions',
        id: version.id,
        attributes: {
          releaseType: 'MANUAL',
        },
      },
    },
  });
  versionDoc = await asc(`/v1/appStoreVersions/${encodeURIComponent(version.id)}`);
  state = versionDoc.data?.attributes?.appVersionState ?? versionDoc.data?.attributes?.appStoreState ?? null;
}

if (versionDoc.data?.attributes?.versionString !== versionString) throw new Error('App Store version verification failed.');
if (versionDoc.data?.attributes?.platform !== 'IOS') throw new Error('App Store platform verification failed.');
if (!['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW'].includes(state)) {
  throw new Error(`App Store version ${versionString} is not safely editable after verification: ${state}`);
}
if (versionDoc.data?.attributes?.releaseType !== 'MANUAL') throw new Error('App Store version is not configured for manual release.');

const result = {
  appId,
  bundleId,
  requestedVersion: versionString,
  versionId: version.id,
  created,
  appVersionState: state,
  releaseType: 'MANUAL',
  versionsBefore,
  reviewSubmissionCreated: false,
  publicReleaseCreated: false,
};

console.log(JSON.stringify(result, null, 2));
persistEvidence(result);
} catch (error) {
  const failure = {
    appId,
    bundleId,
    requestedVersion: versionString ?? null,
    versionId: version?.id ?? versionDoc?.data?.id ?? null,
    created: created ? true : creationAttempted ? null : false,
    appVersionState: state,
    releaseType: versionDoc?.data?.attributes?.releaseType ?? version?.attributes?.releaseType ?? null,
    versionsBefore,
    providerStatus: error && typeof error === 'object' && 'status' in error ? error.status : null,
    providerError: error && typeof error === 'object' && 'provider' in error ? error.provider : null,
    error: error instanceof Error ? error.message : String(error),
    reviewSubmissionCreated: false,
    publicReleaseCreated: false,
  };
  console.error(JSON.stringify(failure, null, 2));
  persistEvidence(failure);
  throw error;
}
