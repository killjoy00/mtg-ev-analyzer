import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const icon = resolve(root, 'assets/images/icon.png');

if (!existsSync(icon)) {
  throw new Error('Pack One production preflight failed. Missing mobile/assets/images/icon.png.');
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
