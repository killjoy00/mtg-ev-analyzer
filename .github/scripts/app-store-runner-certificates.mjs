// Xcode automatic signing on a fresh CI runner creates a new Apple Development
// certificate on every run, and the team's certificate limit eventually blocks
// archiving ("Your account has reached the maximum number of certificates").
//
//   snapshot <file>  record the team's certificate IDs before signing
//   revoke <file>    revoke the development certificates this runner created
//
// Only a certificate that is new since the snapshot AND present in this
// runner's keychain is revoked, so a certificate someone created elsewhere in
// the meantime is never touched. Distribution certificates are reported, never
// revoked, so a build that App Store Connect is still processing is unaffected.
import { execFileSync } from 'node:child_process';
import { createPrivateKey, sign, X509Certificate } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const API = 'https://api.appstoreconnect.apple.com/v1/certificates';

export function normalizeSerial(value) {
  return String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase().replace(/^0+(?=.)/, '');
}

export function isDevelopmentType(type) {
  const value = String(type || '');
  return /DEVELOPMENT$/.test(value) && !/DISTRIBUTION/.test(value);
}

export function pemCertificates(text) {
  return String(text || '').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
}

function fingerprintOf(der) {
  try {
    return new X509Certificate(der).fingerprint256;
  } catch {
    return null;
  }
}

// `runner` holds the fingerprints and serial numbers of certificates in this
// runner's keychain. A team certificate is this runner's when its DER content
// matches one of them (by fingerprint), or by serial number when the API omits
// the content.
export function selectRunnerCertificates({ before, after, runner }) {
  const known = new Set(before);
  const fingerprints = new Set(runner.fingerprints);
  const serials = new Set(runner.serials.map(normalizeSerial));
  const created = after.filter((certificate) => !known.has(certificate.id));
  const revoke = [];
  const keep = [];
  for (const certificate of created) {
    const fingerprint = certificate.content
      ? fingerprintOf(Buffer.from(certificate.content, 'base64'))
      : null;
    const ours = fingerprint
      ? fingerprints.has(fingerprint)
      : serials.has(normalizeSerial(certificate.serialNumber));
    if (ours && isDevelopmentType(certificate.certificateType)) revoke.push(certificate);
    else keep.push({ ...certificate, ours });
  }
  return { created, revoke, keep };
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function token() {
  const issuerId = process.env.ASC_ISSUER_ID?.trim();
  const keyId = process.env.ASC_KEY_ID?.trim();
  const privateKeyText = process.env.ASC_PRIVATE_KEY;
  if (!issuerId || !keyId || !privateKeyText) {
    throw new Error('ASC_ISSUER_ID, ASC_KEY_ID, and ASC_PRIVATE_KEY are required.');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: issuerId, aud: 'appstoreconnect-v1', iat: now, exp: now + 15 * 60 }));
  const signingInput = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: createPrivateKey(privateKeyText),
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${base64url(signature)}`;
}

async function listCertificates(bearer) {
  const certificates = [];
  let url = `${API}?limit=200`;
  while (url) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } });
    const body = await response.text();
    if (!response.ok) throw new Error(`App Store Connect certificate list failed with HTTP ${response.status}: ${body}`);
    const data = body ? JSON.parse(body) : {};
    for (const item of data.data || []) {
      certificates.push({
        id: item.id,
        certificateType: item.attributes?.certificateType || null,
        serialNumber: item.attributes?.serialNumber || null,
        name: item.attributes?.displayName || item.attributes?.name || null,
        content: item.attributes?.certificateContent || null,
      });
    }
    url = data.links?.next || '';
  }
  return certificates;
}

function runnerKeychainCertificates() {
  const pems = new Set();
  for (const name of ['Apple Development', 'iPhone Developer', 'Apple Distribution', 'iPhone Distribution']) {
    try {
      const out = execFileSync('security', ['find-certificate', '-a', '-c', name, '-p'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const pem of pemCertificates(out)) pems.add(pem);
    } catch {
      // `security` exits non-zero when nothing matches.
    }
  }
  const fingerprints = [];
  const serials = [];
  for (const pem of pems) {
    try {
      const certificate = new X509Certificate(pem);
      fingerprints.push(certificate.fingerprint256);
      serials.push(certificate.serialNumber);
    } catch {
      // Ignore unparsable keychain entries.
    }
  }
  return { fingerprints, serials };
}

function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

const label = (certificate) => `${certificate.id} (${certificate.certificateType}, ${certificate.name || 'unnamed'})`;

async function main([command, file]) {
  if (!['snapshot', 'revoke'].includes(command) || !file) {
    throw new Error('Usage: app-store-runner-certificates.mjs snapshot|revoke <file>');
  }
  if (command === 'snapshot') {
    const certificates = await listCertificates(token());
    writeFileSync(file, JSON.stringify(certificates.map((certificate) => certificate.id)));
    console.log(`Recorded ${certificates.length} team certificates before signing.`);
    return;
  }
  if (!existsSync(file)) {
    console.log('::warning::No pre-signing certificate snapshot exists; nothing was revoked.');
    return;
  }
  const bearer = token();
  const before = JSON.parse(readFileSync(file, 'utf8'));
  const after = await listCertificates(bearer);
  const { created, revoke, keep } = selectRunnerCertificates({ before, after, runner: runnerKeychainCertificates() });
  const report = ['## Runner signing certificates', ''];
  if (!created.length) {
    console.log('This run created no new team certificates.');
    report.push('- No new team certificates were created by this run.');
  }
  for (const certificate of revoke) {
    const response = await fetch(`${API}/${encodeURIComponent(certificate.id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${bearer}` },
    });
    if (response.status !== 204 && response.status !== 404) {
      throw new Error(`Revoking certificate ${certificate.id} failed with HTTP ${response.status}: ${await response.text()}`);
    }
    console.log(`Revoked this runner's development certificate ${label(certificate)}.`);
    report.push(`- Revoked this runner's development certificate \`${certificate.id}\` (${certificate.certificateType}).`);
  }
  for (const certificate of keep) {
    const why = certificate.ours
      ? 'it is a distribution certificate, so it was left for the owner to review'
      : 'it is not in this runner\'s keychain, so it was not created here';
    console.log(`::warning::Not revoked: new certificate ${label(certificate)}; ${why}.`);
    report.push(`- Not revoked: \`${certificate.id}\` (${certificate.certificateType}); ${why}.`);
  }
  summary(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2));
}
