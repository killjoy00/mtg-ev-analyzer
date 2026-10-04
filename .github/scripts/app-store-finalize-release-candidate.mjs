import { appendFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const issuerId = process.env.ASC_ISSUER_ID?.trim();
const keyId = process.env.ASC_KEY_ID?.trim();
const privateKeyText = process.env.ASC_PRIVATE_KEY;
const appId = process.env.PACKONE_ASC_APP_ID?.trim() || '6814318676';
const buildNumber = String(process.argv[2] || '').trim();
const versionString = process.env.PACKONE_ASC_VERSION?.trim() || '1.0';

if (!issuerId || !keyId || !privateKeyText) throw new Error('ASC credentials are required.');
if (!/^[1-9][0-9]*$/.test(buildNumber)) throw new Error('Expected positive App Store build number.');

function b64(value) { return Buffer.from(value).toString('base64url'); }
function ascToken() {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const p = b64(JSON.stringify({ iss: issuerId, aud: 'appstoreconnect-v1', iat: now, exp: now + 15 * 60 }));
  const input = `${h}.${p}`;
  const sig = sign('sha256', Buffer.from(input), {
    key: createPrivateKey(privateKeyText),
    dsaEncoding: 'ieee-p1363',
  });
  return `${input}.${sig.toString('base64url')}`;
}

async function asc(path, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ascToken()}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} HTTP ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

let build = null;
for (let attempt = 1; attempt <= 60; attempt += 1) {
  const params = new URLSearchParams();
  params.set('filter[app]', appId);
  params.set('sort', '-uploadedDate');
  params.set('limit', '50');
  params.set('fields[builds]', 'version,uploadedDate,processingState,usesNonExemptEncryption,buildAudienceType');
  const result = await asc(`/v1/builds?${params.toString()}`);
  build = (result.data || []).find((item) => item.attributes?.version === buildNumber) || null;

  if (build) {
    const state = build.attributes?.processingState ?? null;
    const audience = build.attributes?.buildAudienceType ?? null;
    console.log(JSON.stringify({ attempt, buildNumber, buildId: build.id, processingState: state, buildAudienceType: audience }));
    if (state === 'FAILED' || state === 'INVALID') {
      throw new Error(`App Store Connect processing ended in ${state} for build ${buildNumber}.`);
    }
    if (state === 'VALID' && audience === 'INTERNAL_ONLY') {
      throw new Error(`Build ${buildNumber} is INTERNAL_ONLY and cannot be the App Store release candidate.`);
    }
    if (state === 'VALID' && audience === 'APP_STORE_ELIGIBLE') break;
  } else {
    console.log(JSON.stringify({ attempt, buildNumber, processingState: 'NOT_VISIBLE_YET' }));
  }

  if (attempt === 60) {
    throw new Error(`Timed out waiting for App Store-eligible processing of build ${buildNumber}.`);
  }
  await sleep(20_000);
}

if (!build || build.attributes?.processingState !== 'VALID' || build.attributes?.buildAudienceType !== 'APP_STORE_ELIGIBLE') {
  throw new Error(`Build ${buildNumber} did not reach VALID / APP_STORE_ELIGIBLE.`);
}

const versions = await asc(`/v1/apps/${appId}/appStoreVersions?filter%5Bplatform%5D=IOS&limit=200`);
const version = (versions.data || []).find(
  (item) => item.attributes?.platform === 'IOS' && item.attributes?.versionString === versionString,
);
if (!version) throw new Error(`App Store version ${versionString} was not found.`);
const versionState = version.attributes?.appVersionState ?? version.attributes?.appStoreState ?? null;
if (!['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW'].includes(versionState)) {
  throw new Error(`App Store version ${versionString} is not safely editable: ${versionState}`);
}

await asc(`/v1/appStoreVersions/${encodeURIComponent(version.id)}/relationships/build`, {
  method: 'PATCH',
  body: { data: { type: 'builds', id: build.id } },
});

const attached = await asc(
  `/v1/appStoreVersions/${encodeURIComponent(version.id)}/build?fields%5Bbuilds%5D=version,processingState,buildAudienceType`,
);
if (attached.data?.id !== build.id ||
    attached.data?.attributes?.version !== buildNumber ||
    attached.data?.attributes?.processingState !== 'VALID' ||
    attached.data?.attributes?.buildAudienceType !== 'APP_STORE_ELIGIBLE') {
  throw new Error('App Store version build-attachment verification failed.');
}

// Processing and App Store attachment do not prove TestFlight availability.
// Read Apple's separate distribution state without changing testers or groups.
// API references: /documentation/appstoreconnectapi/get-v1-builds-_id_-buildbetadetail
// and /documentation/appstoreconnectapi/get-v1-betagroups (filter[builds]).
let testFlight;
try {
  const groupParams = new URLSearchParams({
    'filter[app]': appId, 'filter[builds]': build.id,
    'fields[betaGroups]': 'isInternalGroup,hasAccessToAllBuilds', limit: '200',
  });
  const [detail, groups] = await Promise.all([
    asc(`/v1/builds/${encodeURIComponent(build.id)}/buildBetaDetail`),
    asc(`/v1/betaGroups?${groupParams}`),
  ]);
  testFlight = {
    verified: true,
    internalBuildState: detail.data?.attributes?.internalBuildState ?? null,
    externalBuildState: detail.data?.attributes?.externalBuildState ?? null,
    groups: (groups.data || []).map(group => ({
      id: group.id,
      isInternalGroup: group.attributes?.isInternalGroup ?? null,
      hasAccessToAllBuilds: group.attributes?.hasAccessToAllBuilds ?? null,
    })),
    groupListComplete: !groups.links?.next,
    testersOrGroupsChanged: false,
  };
} catch (error) {
  testFlight = { verified: false, reason: error.message, testersOrGroupsChanged: false };
}

const result = {
  testFlight,
  appId,
  versionString,
  versionId: version.id,
  versionState,
  buildId: build.id,
  buildNumber,
  processingState: build.attributes.processingState,
  buildAudienceType: build.attributes.buildAudienceType,
  usesNonExemptEncryption: build.attributes?.usesNonExemptEncryption ?? null,
  attached: true,
  reviewSubmissionCreated: false,
};
console.log(JSON.stringify(result, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
    '## Pack One App Store-eligible RC',
    '',
    `- App Store version: \`${versionString}\``,
    `- Build number: \`${buildNumber}\``,
    `- Processing state: \`${result.processingState}\``,
    `- Audience: \`${result.buildAudienceType}\``,
    '- Attached to App Store version 1.0: true',
    '- App Review submission created: false',
    `- TestFlight availability read: ${testFlight.verified ? 'verified' : 'unavailable'}`,
    `- Internal testing state: ${testFlight.internalBuildState ?? 'unknown'}`,
    `- External testing state: ${testFlight.externalBuildState ?? 'unknown'}`,
    `- Existing groups associated with build: ${testFlight.groups?.length ?? 'unknown'}`,
    '',
  ].join('\n'));
}
