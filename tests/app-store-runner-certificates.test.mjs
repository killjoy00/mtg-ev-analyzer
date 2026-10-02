import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import test from 'node:test';

import {
  isDevelopmentType,
  normalizeSerial,
  pemCertificates,
  selectRunnerCertificates,
} from '../.github/scripts/app-store-runner-certificates.mjs';

test('certificate serials compare without case, separators or leading zeros', () => {
  assert.equal(normalizeSerial('0a:1B:2c'), 'A1B2C');
  assert.equal(normalizeSerial('00A1B2C'), 'A1B2C');
  assert.equal(normalizeSerial(''), '');
});

test('only development certificate types are revocable', () => {
  for (const type of ['DEVELOPMENT', 'IOS_DEVELOPMENT', 'MAC_APP_DEVELOPMENT']) assert.equal(isDevelopmentType(type), true, type);
  for (const type of ['DISTRIBUTION', 'IOS_DISTRIBUTION', 'MAC_APP_DISTRIBUTION', 'DEVELOPER_ID_APPLICATION', '', null]) {
    assert.equal(isDevelopmentType(type), false, String(type));
  }
});

test('PEM blocks are split from security output', () => {
  const block = '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----';
  assert.deepEqual(pemCertificates(`noise\n${block}\n${block}\n`), [block, block]);
  assert.deepEqual(pemCertificates(''), []);
});

test('revokes only new development certificates found in this runner keychain', () => {
  const before = ['old-dev', 'old-dist'];
  const after = [
    { id: 'old-dev', certificateType: 'DEVELOPMENT', serialNumber: '01' },
    { id: 'old-dist', certificateType: 'DISTRIBUTION', serialNumber: '02' },
    { id: 'runner-dev', certificateType: 'DEVELOPMENT', serialNumber: '0A0B' },
    { id: 'runner-dist', certificateType: 'DISTRIBUTION', serialNumber: '0C0D' },
    { id: 'someone-else', certificateType: 'DEVELOPMENT', serialNumber: '0E0F' },
  ];
  const { created, revoke, keep } = selectRunnerCertificates({
    before,
    after,
    runner: { fingerprints: [], serials: ['A0B', 'c0d', '01'] },
  });
  assert.deepEqual(created.map((c) => c.id), ['runner-dev', 'runner-dist', 'someone-else']);
  assert.deepEqual(revoke.map((c) => c.id), ['runner-dev']);
  assert.deepEqual(keep.map((c) => [c.id, c.ours]), [['runner-dist', true], ['someone-else', false]]);
});

// Self-signed fixture; only its DER bytes matter here.
const FIXTURE_PEM = `-----BEGIN CERTIFICATE-----
MIIBtjCCAV2gAwIBAgIUN+egNSphuw7QJ5XiLjonbNgVGZcwCgYIKoZIzj0EAwIw
MTEvMC0GA1UEAwwmQXBwbGUgRGV2ZWxvcG1lbnQ6IFRlc3QgRml4dHVyZSAoVEVT
VCkwHhcNMjYxMDAyMDAwOTQyWhcNMzYwOTI5MDAwOTQyWjAxMS8wLQYDVQQDDCZB
cHBsZSBEZXZlbG9wbWVudDogVGVzdCBGaXh0dXJlIChURVNUKTBZMBMGByqGSM49
AgEGCCqGSM49AwEHA0IABHw11PRDFg1vXfobDG3fU0tPIBZgxW/lZnqPkhWWttbb
FvLJ3t6QUxHmZbKzs22h+2NA/o4WiZgTt80z/3dEgfqjUzBRMB0GA1UdDgQWBBRF
gkWN6T84rLYaMtB9HIys1oElLjAfBgNVHSMEGDAWgBRFgkWN6T84rLYaMtB9HIys
1oElLjAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0cAMEQCIH5D6hr0zoVg
o4+CuGdcGdbtaIQ18rgPG+bH7zi5YzEdAiAmMFoM9pH8jCdPvVEoH6yAm2k3kLvs
5XJt0K4Hvz/25Q==
-----END CERTIFICATE-----`;

test('certificate content is matched to the runner keychain by fingerprint, not serial', () => {
  const certificate = new X509Certificate(FIXTURE_PEM);
  const content = certificate.raw.toString('base64');
  const after = [{ id: 'runner-dev', certificateType: 'DEVELOPMENT', serialNumber: 'FFFF', content }];
  const match = selectRunnerCertificates({ before: [], after, runner: { fingerprints: [certificate.fingerprint256], serials: [] } });
  assert.deepEqual(match.revoke.map((c) => c.id), ['runner-dev']);
  // A serial collision alone is not enough once the API returned the content.
  const serialOnly = selectRunnerCertificates({ before: [], after, runner: { fingerprints: [], serials: ['FFFF'] } });
  assert.deepEqual(serialOnly.revoke, []);
  assert.deepEqual(serialOnly.keep.map((c) => [c.id, c.ours]), [['runner-dev', false]]);
});

test('nothing is revoked when the run created no certificates', () => {
  const after = [{ id: 'a', certificateType: 'DEVELOPMENT', serialNumber: '01' }];
  const { created, revoke } = selectRunnerCertificates({ before: ['a'], after, runner: { fingerprints: [], serials: ['01'] } });
  assert.equal(created.length, 0);
  assert.equal(revoke.length, 0);
});
