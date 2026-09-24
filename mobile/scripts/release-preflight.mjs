import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const icon = resolve(root, 'assets/images/icon.png');

if (!existsSync(icon)) {
  throw new Error('Pack One production preflight failed. Missing mobile/assets/images/icon.png.');
}

const iconBytes = readFileSync(icon);
const pngSignature = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
if (iconBytes.length < 32 || !iconBytes.subarray(0, 8).equals(pngSignature)) {
  throw new Error('Pack One production preflight failed. Store icon is not a valid PNG.');
}
const iconWidth = iconBytes.readUInt32BE(16);
const iconHeight = iconBytes.readUInt32BE(20);
if (iconWidth !== 1024 || iconHeight !== 1024) {
  throw new Error(`Pack One production preflight failed. Store icon must be 1024x1024, got ${iconWidth}x${iconHeight}.`);
}
if (iconBytes.subarray(-8, -4).toString('ascii') !== 'IEND') {
  throw new Error('Pack One production preflight failed. Store icon PNG is truncated.');
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npx, ['expo', 'config', '--type', 'public', '--json'], {
  cwd: root,
  env: { ...process.env, PACKONE_BUILD_PROFILE: 'production' },
  encoding: 'utf8',
});

if (result.status !== 0) {
  throw new Error(result.stderr || result.stdout || 'Production Expo config failed.');
}

const config = JSON.parse(result.stdout);
if (config.ios?.bundleIdentifier !== 'pro.packone.app') {
  throw new Error('Production iOS bundle identifier must remain pro.packone.app.');
}
if (config.android?.package !== 'pro.packone.app') {
  throw new Error('Production Android package must remain pro.packone.app.');
}
if (config.extra?.eas?.projectId) {
  throw new Error('Production config must not require an Expo/EAS project ID.');
}

console.log('Pack One local/native production preflight passed.');
