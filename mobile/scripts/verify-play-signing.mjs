import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const token = process.env.PLAY_ACCESS_TOKEN?.trim();
const packageName = process.env.PACKONE_ANDROID_PACKAGE?.trim() || 'pro.packone.app';
const versionCode = String(process.argv[2] || '').trim();

if (!token) throw new Error('PLAY_ACCESS_TOKEN is required.');
if (!/^[1-9][0-9]*$/.test(versionCode)) throw new Error('A valid Google Play version code is required.');

function normalize(value) {
  const raw = String(value || '').trim();
  const compact = raw.replaceAll(':', '');
  if (/^[0-9A-Fa-f]{64}$/.test(compact)) {
    return compact.match(/.{2}/g).join(':').toUpperCase();
  }
  const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
  const bytes = Buffer.from(padded.replaceAll('-', '+').replaceAll('_', '/'), 'base64');
  if (bytes.length !== 32) throw new Error(`Unrecognized SHA-256 fingerprint: ${raw}`);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(':').toUpperCase();
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}: ${text}`);
  return data;
}

const generated = await getJson(
  `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/generatedApks/${versionCode}`,
);

const discovered = [];
for (const apk of generated?.generatedApks || []) {
  if (!apk?.certificateSha256Hash) continue;
  const fingerprint = normalize(apk.certificateSha256Hash);
  if (!discovered.includes(fingerprint)) discovered.push(fingerprint);
}
if (!discovered.length) throw new Error(`Google Play returned no app-signing fingerprint for version ${versionCode}.`);

const assetPath = fileURLToPath(new URL('../../.well-known/assetlinks.json', import.meta.url));
const statements = JSON.parse(readFileSync(assetPath, 'utf8'));
const published = [];
for (const statement of statements) {
  const target = statement?.target || {};
  if (target.namespace !== 'android_app' || target.package_name !== packageName) continue;
  for (const value of target.sha256_cert_fingerprints || []) {
    const fingerprint = normalize(value);
    if (!published.includes(fingerprint)) published.push(fingerprint);
  }
}

const missing = discovered.filter((fingerprint) => !published.includes(fingerprint));
if (missing.length) {
  throw new Error(`assetlinks.json is missing Google Play app-signing fingerprint(s): ${missing.join(', ')}`);
}

process.stdout.write(JSON.stringify({
  verified: true,
  packageName,
  versionCode,
  discoveredFingerprints: discovered,
  publishedFingerprints: published,
}, null, 2));
