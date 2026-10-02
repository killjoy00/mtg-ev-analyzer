#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const EXACT_BACKEND_FILES = new Set([
  'draft-run.mjs',
  'draft-run-policy.mjs',
  'daily-selection.mjs',
  'draft-run-difficulty.mjs',
  'data/selection-policy.json',
  'game-date.mjs',
  'scripts/verify-neon-schema.mjs',
  'scripts/load_verified_draft_run.mjs',
]);

export function requiresNeon(path) {
  if (path.startsWith('worker/') || path.startsWith('migrations/')) return true;
  if (EXACT_BACKEND_FILES.has(path)) return true;
  if (/^tests\/[^/]*backend-smoke\.mjs$/.test(path)) return true;
  if (/^scripts\/[^/]*corpus[^/]*manifest\.mjs$/.test(path)) return true;
  if (/^scripts\/load[^/]*tro[^/]*\.mjs$/.test(path)) return true;
  return false;
}

export function classify(paths) {
  const backendPaths = paths.filter(requiresNeon);
  return {
    needsNeon: backendPaths.length > 0,
    backendPaths,
  };
}

function main() {
  const paths = process.argv.slice(2);
  const result = classify(paths);
  for (const path of paths) console.log(` - ${path}`);
  console.log(result.needsNeon
    ? `Neon integration required by: ${result.backendPaths.join(', ')}`
    : 'No schema/query/worker/backend-smoke changes require a disposable Neon branch.');

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `needs_neon=${result.needsNeon}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
