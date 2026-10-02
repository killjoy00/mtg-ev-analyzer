#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

const FAST_RULES = [
  { label: 'mobile app JS/TS', test: (path) => /^mobile\/app\/.*\.(?:js|jsx|ts|tsx)$/.test(path) },
  { label: 'mobile src JS/TS', test: (path) => /^mobile\/src\/.*\.(?:js|jsx|ts|tsx)$/.test(path) },
  { label: 'mobile tests', test: (path) => /^mobile\/tests\//.test(path) },
];

const ROOT_NATIVE_INPUTS = [
  /^scripts\/audit-android-manifest\.py$/,
  /^\.github\/scripts\/app-store-[^/]*\.mjs$/,
  /^\.github\/workflows\/(?:android-production-bundle|android-internal-testing|ios-testflight|mobile-exact-main-rc|mobile)\.yml$/,
];

const FORCE_FULL = [
  /^mobile\/(?:package\.json|package-lock\.json|\.node-version|app\.json|app\.config\.ts|store-release\.json)$/,
  /^mobile\/assets\//,
  /^mobile\/scripts\//,
  /^mobile\/(?:plugins?|config-plugins?)\//,
  ...ROOT_NATIVE_INPUTS,
  /^mobile\/tests\/(?:native-ci-scope|gradle-cache-key)\.test\.mjs$/,
];

function normalizePaths(paths) {
  if (!Array.isArray(paths)) return [];
  return [...new Set(paths.map((raw) => String(raw ?? '').trim().replaceAll('\\', '/')).filter(Boolean))];
}

export function filterNativeChangedPaths(paths) {
  return normalizePaths(paths).filter(
    (path) => path.startsWith('mobile/') || ROOT_NATIVE_INPUTS.some((pattern) => pattern.test(path)),
  );
}

export function classifyNativeChanges(paths) {
  const normalized = normalizePaths(paths);
  if (normalized.length === 0) {
    return { nativeFull: true, reason: 'empty changed-file list' };
  }
  const relevant = filterNativeChangedPaths(normalized);
  if (relevant.length === 0) {
    return { nativeFull: true, reason: 'no native-relevant changed files after filtering' };
  }
  for (const path of relevant) {
    if (FORCE_FULL.some((pattern) => pattern.test(path))) return { nativeFull: true, reason: 'forced-full native input: ' + path };
    if (!FAST_RULES.some((rule) => rule.test(path))) return { nativeFull: true, reason: 'unknown or native-relevant path: ' + path };
  }
  return { nativeFull: false, reason: 'all native-relevant files are in the verified mobile JS/TS or test allowlist' };
}

function main() {
  const result = classifyNativeChanges(process.argv.slice(2));
  console.error(`native_full=${result.nativeFull}: ${result.reason}`);
  process.stdout.write(result.nativeFull ? 'true' : 'false');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
