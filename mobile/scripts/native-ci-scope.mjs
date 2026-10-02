#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const FAST_RULES = [
  { label: 'mobile app JS/TS', test: (path) => /^mobile\/app\/.*\.(?:js|jsx|ts|tsx)$/.test(path) },
  { label: 'mobile src JS/TS', test: (path) => /^mobile\/src\/.*\.(?:js|jsx|ts|tsx)$/.test(path) },
  { label: 'mobile tests', test: (path) => /^mobile\/tests\//.test(path) },
  { label: 'documentation', test: (path) => /^docs\//.test(path) },
];

const FORCE_FULL = [
  /^mobile\/(?:package\.json|package-lock\.json|\.node-version|app\.json|app\.config\.ts|store-release\.json)$/,
  /^mobile\/assets\//,
  /^mobile\/scripts\//,
  /^mobile\/(?:plugins?|config-plugins?)\//,
  /^\.github\/workflows\/(?:android-production-bundle|android-internal-testing|ios-testflight|mobile-exact-main-rc|mobile)\.yml$/,
  /^mobile\/tests\/(?:native-ci-scope|gradle-cache-key)\.test\.mjs$/,
];

export function classifyNativeChanges(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { nativeFull: true, reason: 'empty changed-file list' };
  }

  for (const raw of paths) {
    const path = String(raw ?? '').trim().replaceAll('\\', '/');
    if (!path) return { nativeFull: true, reason: 'blank changed path' };
    if (FORCE_FULL.some((pattern) => pattern.test(path))) {
      return { nativeFull: true, reason: `forced-full native input: ${path}` };
    }
    if (!FAST_RULES.some((rule) => rule.test(path))) {
      return { nativeFull: true, reason: `unknown or native-relevant path: ${path}` };
    }
  }

  return { nativeFull: false, reason: 'all changed files are in the verified JS/TS, test, or docs allowlist' };
}

function main() {
  const result = classifyNativeChanges(process.argv.slice(2));
  console.error(`native_full=${result.nativeFull}: ${result.reason}`);
  process.stdout.write(result.nativeFull ? 'true' : 'false');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
