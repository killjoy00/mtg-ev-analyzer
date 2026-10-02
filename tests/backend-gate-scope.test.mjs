import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, requiresNeon } from '../scripts/backend-gate-scope.mjs';

test('backend scope requires Neon for schema, query, worker, loader, and integration-test changes',()=>{
  for (const path of [
    'worker/growth-function.js',
    'migrations/0047_example.sql',
    'draft-run.mjs',
    'data/selection-policy.json',
    'tests/account-session-backend-smoke.mjs',
    'scripts/verify-neon-schema.mjs',
    'scripts/load_verified_draft_run.mjs',
    'scripts/example-corpus-manifest.mjs',
    'scripts/load_new_trophies.mjs',
  ]) {
    assert.equal(requiresNeon(path), true, path);
  }
});

test('workflow maintenance and unrelated mobile/docs changes stay on the cheap precheck',()=>{
  const result = classify([
    '.github/workflows/backend-gate.yml',
    '.github/workflows/prepare-rebuild.yml',
    'mobile/app/index.tsx',
    'docs/mobile-release-config.md',
  ]);
  assert.equal(result.needsNeon, false);
  assert.deepEqual(result.backendPaths, []);
});
