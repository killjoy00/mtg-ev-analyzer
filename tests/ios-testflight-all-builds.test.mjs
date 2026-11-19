import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync('.github/scripts/app-store-build-status.mjs', 'utf8');
const workflow = readFileSync('.github/workflows/ios-testflight-status.yml', 'utf8');
const request = JSON.parse(readFileSync('.github/testflight-status-request.json', 'utf8'));

test('cross-build Apple crash scan is explicit and read only', () => {
  assert.equal(request.operation, 'read-pack-one-testflight-status');
  assert.equal(request.crash_scope, 'all_builds');
  assert.match(workflow, /Invalid read-only crash scope/);
  assert.match(workflow, /PACKONE_CRASH_SCAN_ALL_BUILDS: \$\{\{ steps.request.outputs.scan_all_builds \}\}/);
  assert.match(script, /process\.env\.PACKONE_CRASH_SCAN_ALL_BUILDS === '1'/);
  assert.match(script, /betaFeedbackCrashSubmissions\?/);
  assert.match(script, /include: 'build'/);
  assert.match(script, /readTestFlightDistribution/);
});

test('public Actions artifacts retain sanitized crash signatures, never raw logs', () => {
  assert.match(script, /function safeCrashSignature\(logText\)/);
  assert.match(script, /createHash\('sha256'\)/);
  assert.match(script, /allBuildCrashEvidence/);
  assert.match(script, /JSON\.stringify\(result, null, 2\)/);
  assert.doesNotMatch(script, /JSON\.stringify\(\{\s*\.\.\.result,\s*testFlightCrashes:\s*crashEvidence\s*\}/);
  assert.match(script, /diagnostic: safeCrashSignature\(logText\)/);
  assert.doesNotMatch(script, /email:\s*(row|submission)\./);
});
