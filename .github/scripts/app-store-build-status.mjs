import { appendFileSync, writeFileSync } from 'node:fs';
import { readTestFlightDistribution } from './testflight-distribution.mjs';
import { createPrivateKey, sign } from 'node:crypto';

const issuerId = process.env.ASC_ISSUER_ID?.trim();
const keyId = process.env.ASC_KEY_ID?.trim();
const privateKeyText = process.env.ASC_PRIVATE_KEY;
const appId = process.env.PACKONE_ASC_APP_ID?.trim() || '6814318676';
const requestedBuild = process.argv[2]?.trim();
if (requestedBuild && !/^[1-9][0-9]*$/.test(requestedBuild)) throw new Error('Invalid exact build number.');

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
if (requestedBuild) params.set('filter[version]', requestedBuild);
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

const latest = requestedBuild ? builds.find(build => build.version === requestedBuild) : builds[0];
if (!latest) throw new Error(`App ${appId} does not contain requested build ${requestedBuild}.`);
const ascRead = async (path) => {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method: 'GET', headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`GET ${path} HTTP ${response.status}: ${body}`);
  return JSON.parse(body);
};
const testFlight = await readTestFlightDistribution(ascRead, latest.id);
const crashParams = new URLSearchParams({
  'filter[build]': latest.id,
  sort: '-createdDate',
  limit: '50',
  'fields[betaFeedbackCrashSubmissions]': [
    'createdDate','deviceModel','osVersion','locale','timeZone','architecture',
    'connectionType','pairedAppleWatch','appUptimeInMilliseconds',
    'diskBytesAvailable','diskBytesTotal','batteryPercentage',
    'screenWidthInPoints','screenHeightInPoints','appPlatform','devicePlatform',
    'deviceFamily','buildBundleId','crashLog','build',
  ].join(','),
});
let crashEvidence;
try {
  const submissionsResponse = await ascRead(
    `/v1/apps/${encodeURIComponent(appId)}/betaFeedbackCrashSubmissions?${crashParams.toString()}`,
  );
  const submissions = [];
  for (const submission of submissionsResponse?.data || []) {
    let crashLog = null;
    let crashLogError = null;
    try {
      crashLog = await ascRead(
        `/v1/betaFeedbackCrashSubmissions/${encodeURIComponent(submission.id)}/crashLog`,
      );
    } catch (error) {
      crashLogError = error instanceof Error ? error.message : 'Crash log read failed.';
    }
    submissions.push({
      id: submission.id,
      attributes: submission.attributes ?? {},
      crashLog,
      crashLogError,
    });
  }
  crashEvidence = { available: true, count: submissions.length, submissions };
} catch (error) {
  crashEvidence = {
    available: false,
    count: null,
    reason: error instanceof Error ? error.message : 'Crash submissions read failed.',
    submissions: [],
  };
}
const testFlightCrashes = {
  available: crashEvidence.available,
  count: crashEvidence.count,
  reason: crashEvidence.reason ?? null,
  submissions: crashEvidence.submissions.map(({ id, attributes, crashLog, crashLogError }) => ({
    id,
    createdDate: attributes?.createdDate ?? null,
    deviceModel: attributes?.deviceModel ?? null,
    osVersion: attributes?.osVersion ?? null,
    architecture: attributes?.architecture ?? null,
    deviceFamily: attributes?.deviceFamily ?? null,
    appUptimeInMilliseconds: attributes?.appUptimeInMilliseconds ?? null,
    crashLogAvailable: Boolean(crashLog?.data),
    crashLogError,
  })),
};
const result = {
  appId,
  sourceSha: process.env.GITHUB_SHA ?? null,
  requestedBuild: requestedBuild ?? null,
  latest,
  builds,
  testFlight,
  testFlightCrashes,
};
console.log(JSON.stringify(result, null, 2));
if (process.env.PACKONE_STATUS_OUTPUT) {
  writeFileSync(
    process.env.PACKONE_STATUS_OUTPUT,
    JSON.stringify({ ...result, testFlightCrashes: crashEvidence }, null, 2) + '\n',
  );
}

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
      `- Availability read: ${testFlight.verified ? 'verified' : 'unavailable'}`,
      `- Internal state: ${testFlight.internalBuildState ?? 'unknown'}`,
      `- External state: ${testFlight.externalBuildState ?? 'unknown'}`,
      `- Associated groups: ${testFlight.groups?.length ?? 'unknown'}`,
      '',
      `- App Store Connect app ID: \`${appId}\``,
      `- Latest build: \`${latest.version ?? 'unknown'}\``,
      `- Processing state: \`${latest.processingState ?? 'unknown'}\``,
      `- Uploaded: \`${latest.uploadedDate ?? 'unknown'}\``,
      `- Audience type: \`${latest.buildAudienceType ?? 'unknown'}\``,
      `- Uses non-exempt encryption: \`${compliance}\``,
      '',
      '## TestFlight crash evidence',
      `- Crash API read: ${testFlightCrashes.available ? 'available' : 'unavailable'}`,
      `- Crash submissions for exact build: ${testFlightCrashes.count ?? 'unknown'}`,
      ...(testFlightCrashes.reason ? [`- Crash read reason: \`${testFlightCrashes.reason}\``] : []),
      '',
    ].join('\n'),
  );
}

if (!testFlight.verified) throw new Error('Exact-build TestFlight availability could not be read; see retained evidence.');
