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
let creationOutcome = 'not_attempted';
let creationProviderStatus = null;
let creationProviderError = null;
let reconciliationError = null;
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

function requireVersionResource(resource, label) {
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)
      || resource.type !== 'appStoreVersions'
      || typeof resource.id !== 'string' || !resource.id.trim()
      || !resource.attributes || typeof resource.attributes !== 'object' || Array.isArray(resource.attributes)) {
    throw new Error(`${label} response is malformed.`);
  }
  if (resource.attributes.versionString !== versionString) throw new Error('App Store version verification failed.');
  if (resource.attributes.platform !== 'IOS') throw new Error('App Store platform verification failed.');
  return resource;
}

function summarizeVersion(resource) {
  return {
    id: resource.id,
    platform: resource.attributes?.platform ?? null,
    versionString: resource.attributes?.versionString ?? null,
    appVersionState: resource.attributes?.appVersionState ?? resource.attributes?.appStoreState ?? null,
    releaseType: resource.attributes?.releaseType ?? null,
    createdDate: resource.attributes?.createdDate ?? null,
  };
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
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    const error = new Error(`${method} ${path} failed before a response was received.`);
    error.status = null;
    error.provider = null;
    error.providerRequest = true;
    error.cause = cause;
    throw error;
  }
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
    error.providerRequest = true;
    throw error;
  }
  return data;
}

const app = await asc(`/v1/apps/${appId}?fields%5Bapps%5D=bundleId`);
if (!app || typeof app !== 'object' || Array.isArray(app) || !app.data || typeof app.data !== 'object') {
  throw new Error('Unexpected App Store Connect app response.');
}
if (app.data.id !== appId || app.data.type !== 'apps' || app.data.attributes?.bundleId !== bundleId) {
  throw new Error('Unexpected App Store Connect app record.');
}

const listPath = `/v1/apps/${appId}/appStoreVersions?filter%5Bplatform%5D=IOS&filter%5BversionString%5D=${encodeURIComponent(versionString)}&fields%5BappStoreVersions%5D=platform,versionString,appVersionState,releaseType,createdDate&limit=2`;
async function lookupExactVersion() {
  const document = await asc(listPath);
  if (!document || typeof document !== 'object' || Array.isArray(document) || !Array.isArray(document.data)) {
    throw new Error('Malformed App Store version list response.');
  }
  if (document.links?.next) throw new Error('Exact App Store version lookup unexpectedly paginated.');
  if (document.data.length > 1) throw new Error('Exact App Store version lookup returned multiple matches.');
  if (document.data.length === 0) return null;
  return requireVersionResource(document.data[0], 'App Store version list');
}

version = await lookupExactVersion();
versionsBefore = version ? [summarizeVersion(version)] : [];
if (version) creationOutcome = 'existing';

if (!version) {
  creationOutcome = 'attempted';
  try {
    const createdDoc = await asc('/v1/appStoreVersions', {
      method: 'POST',
      body: {
        data: {
          type: 'appStoreVersions',
          attributes: {
            platform: 'IOS',
            versionString,
            releaseType: 'MANUAL',
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
    created = null;
    creationOutcome = 'unknown';
    if (!createdDoc || typeof createdDoc !== 'object' || Array.isArray(createdDoc) || !createdDoc.data) {
      throw new Error('Malformed App Store version creation response.');
    }
    version = requireVersionResource(createdDoc.data, 'Created App Store version');
    created = true;
    creationOutcome = 'created';
  } catch (error) {
    if (!error?.providerRequest) throw error;
    created = null;
    creationOutcome = 'unknown';
    creationProviderStatus = error.status ?? null;
    creationProviderError = error.provider ?? null;
    try {
      const reconciled = await lookupExactVersion();
      if (!reconciled) throw error;
      version = reconciled;
      creationOutcome = 'unknown_reconciled';
    } catch (reconcile) {
      if (reconcile !== error) reconciliationError = reconcile instanceof Error ? reconcile.message : String(reconcile);
      throw error;
    }
  }
}

if (!version?.id) throw new Error(`App Store version ${versionString} is missing after ensure operation.`);

versionDoc = await asc(`/v1/appStoreVersions/${encodeURIComponent(version.id)}?fields%5BappStoreVersions%5D=platform,versionString,appVersionState,releaseType,createdDate`);
if (!versionDoc || typeof versionDoc !== 'object' || Array.isArray(versionDoc) || !versionDoc.data) {
  throw new Error('Malformed App Store version detail response.');
}
version = requireVersionResource(versionDoc.data, 'App Store version detail');
state = version.attributes?.appVersionState ?? version.attributes?.appStoreState ?? null;
if (!['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW'].includes(state)) {
  throw new Error(`App Store version ${versionString} is not safely editable: ${state}`);
}

if (version.attributes?.releaseType !== 'MANUAL') {
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
  versionDoc = await asc(`/v1/appStoreVersions/${encodeURIComponent(version.id)}?fields%5BappStoreVersions%5D=platform,versionString,appVersionState,releaseType,createdDate`);
  if (!versionDoc || typeof versionDoc !== 'object' || Array.isArray(versionDoc) || !versionDoc.data) {
    throw new Error('Malformed App Store version detail response after PATCH.');
  }
  version = requireVersionResource(versionDoc.data, 'App Store version detail after PATCH');
  state = version.attributes?.appVersionState ?? version.attributes?.appStoreState ?? null;
}

if (!['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW'].includes(state)) {
  throw new Error(`App Store version ${versionString} is not safely editable after verification: ${state}`);
}
if (version.attributes?.releaseType !== 'MANUAL') throw new Error('App Store version is not configured for manual release.');

const result = {
  appId,
  bundleId,
  requestedVersion: versionString,
  versionId: version.id,
  created,
  creationOutcome,
  appVersionState: state,
  releaseType: 'MANUAL',
  versionsBefore,
  creationProviderStatus,
  creationProviderError,
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
    created,
    creationOutcome,
    appVersionState: state,
    releaseType: versionDoc?.data?.attributes?.releaseType ?? version?.attributes?.releaseType ?? null,
    versionsBefore,
    providerStatus: error && typeof error === 'object' && 'status' in error ? error.status : null,
    providerError: error && typeof error === 'object' && 'provider' in error ? error.provider : null,
    creationProviderStatus,
    creationProviderError,
    reconciliationError,
    error: error instanceof Error ? error.message : String(error),
    reviewSubmissionCreated: false,
    publicReleaseCreated: false,
  };
  console.error(JSON.stringify(failure, null, 2));
  persistEvidence(failure);
  throw error;
}
