import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isMobilePrInput, requiredWorkflows, matchingRun, assessRequiredWorkflows,
} from '../.github/scripts/pr-merge-gate.mjs';

const SHA = 'a'.repeat(40), OTHER = 'b'.repeat(40), PR = 1234;
function run(path, id, overrides = {}) {
  return {
    id, path, event: 'pull_request', head_sha: SHA, status: 'completed',
    conclusion: 'success', run_attempt: 1,
    pull_requests: [{ number: PR, head: { sha: SHA } }],
    ...overrides,
  };
}
function evidence(paths) {
  const expected = requiredWorkflows(paths);
  const runs = expected.map((spec, index) => run(spec.path, 100 + index));
  const jobs = new Map(runs.map((r, index) =>
    [String(r.id) + ':1', expected[index].jobs.map(name =>
      ({ name, status: 'completed', conclusion: 'success' }))]));
  return { expected, runs, jobs };
}

test('all PRs require current-head test and e2e, even when not mobile-related', () => {
  assert.deepEqual(requiredWorkflows(['README.md']).map(x => x.path),
    ['.github/workflows/test.yml', '.github/workflows/e2e.yml']);
  assert.throws(() => requiredWorkflows([]), /complete PR change set/);
  assert.throws(() => requiredWorkflows(['']), /complete PR change set/);
});

test('mobile and native workflow edits require unsigned checks and both screenshot platforms', () => {
  for (const file of [
    'mobile/app/draft-run.tsx', 'card-faces.mjs',
    '.github/actions/mobile-validate/action.yml',
    '.github/workflows/android-internal-testing.yml',
    '.github/workflows/ios-testflight.yml',
  ]) {
    assert.equal(isMobilePrInput(file), true, file);
    const specs = requiredWorkflows([file]);
    assert.equal(specs.length, 6, file);
    const screenshot = specs.find(x => x.path.endsWith('mobile-store-screenshots.yml'));
    assert.deepEqual(screenshot.jobs,
      ['validate screenshot fixture build', 'capture iPhone and iPad', 'capture Android phone'], file);
  }
});

test('tests-only mobile change keeps unsigned smoke and fixture validation without slow captures', () => {
  const specs = requiredWorkflows(['mobile/tests/puzzle.test.mjs']);
  assert.equal(specs.length, 6);
  assert.deepEqual(specs.find(x => x.path.endsWith('mobile-store-screenshots.yml')).jobs,
    ['validate screenshot fixture build']);
  assert.ok(specs.some(x => x.jobs.includes('validate Android upload signing config')));
  assert.ok(specs.some(x => x.jobs.includes('validate production Android bundle build')));
  assert.equal(isMobilePrInput('docs/mobile-release.md'), false);
});

test('a correct set of completed same-PR, same-head jobs passes', () => {
  const { expected, runs, jobs } = evidence(['mobile/app/draft-run.tsx']);
  assert.equal(assessRequiredWorkflows(expected, runs, jobs, SHA, PR).state, 'success');
});

test('missing, wrong PR, and stale-head runs never satisfy the gate', () => {
  const { expected, runs, jobs } = evidence(['README.md']);
  assert.equal(assessRequiredWorkflows(expected, [runs[0]], jobs, SHA, PR).state, 'pending');
  assert.equal(assessRequiredWorkflows(expected, runs, jobs, OTHER, PR).state, 'pending');
  const wrongPr = runs.map(r => ({...r, pull_requests: [{number: PR + 1}]}));
  assert.equal(assessRequiredWorkflows(expected, wrongPr, jobs, SHA, PR).state, 'pending');
  const wrongEvent = runs.map(r => ({...r, event: 'push'}));
  assert.equal(assessRequiredWorkflows(expected, wrongEvent, jobs, SHA, PR).state, 'pending');
});

test('failed or cancelled workflow is a hard failure, not a skipped success', () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped']) {
    const { expected, runs, jobs } = evidence(['README.md']);
    runs[1].conclusion = conclusion;
    assert.equal(assessRequiredWorkflows(expected, runs, jobs, SHA, PR).state,
      'failure', conclusion);
  }
});

test('successful workflow with skipped, missing or failed native job fails closed', () => {
  const { expected, runs, jobs } = evidence(['mobile/app/draft-run.tsx']);
  const screenshots = runs.find(x => x.path.endsWith('mobile-store-screenshots.yml'));
  const key = String(screenshots.id) + ':1';
  const initial = jobs.get(key);
  jobs.set(key, initial.filter(x => x.name !== 'capture iPhone and iPad'));
  assert.equal(assessRequiredWorkflows(expected, runs, jobs, SHA, PR).state, 'failure');
  jobs.set(key, initial.map(x => x.name === 'capture Android phone'
    ? {...x, conclusion: 'skipped'} : x));
  assert.equal(assessRequiredWorkflows(expected, runs, jobs, SHA, PR).state, 'failure');
  jobs.set(key, initial.map(x => x.name === 'capture Android phone'
    ? {...x, conclusion: 'failure'} : x));
  assert.equal(assessRequiredWorkflows(expected, runs, jobs, SHA, PR).state, 'failure');
});

test('successful workflow without job details is pending rather than falsely passing', () => {
  const { expected, runs, jobs } = evidence(['README.md']);
  jobs.delete(String(runs[0].id) + ':1');
  assert.equal(assessRequiredWorkflows(expected, runs, jobs, SHA, PR).state, 'pending');
});

test('the latest current-head workflow run wins over stale failed attempts', () => {
  const { expected, runs, jobs } = evidence(['README.md']);
  const old = run(expected[0].path, 1, {conclusion:'failure'});
  const chosen = matchingRun([old, ...runs], expected[0], SHA, PR);
  assert.equal(chosen.id, runs[0].id);
  assert.equal(assessRequiredWorkflows(expected, [old,...runs], jobs, SHA, PR).state, 'success');
});

test('gate runs for every PR, and native workflow triggers cover every native input', () => {
  const gate = readFileSync('.github/workflows/pr-merge-gate.yml', 'utf8');
  const trigger = gate.split('  pull_request:')[1]?.split('\n\npermissions:')[0];
  assert.ok(trigger, 'gate has a pull_request trigger');
  assert.doesNotMatch(trigger, /paths:|paths-ignore:/);
  assert.match(gate, /name: required-pr-gate/);
  assert.match(gate, /actions: read/);
  const requiredNativePaths = [
    'mobile/**', 'card-faces.mjs', 'card-faces.d.mts',
    '.github/actions/mobile-validate/**', '.github/workflows/mobile.yml',
    '.github/workflows/mobile-store-screenshots.yml',
    '.github/workflows/android-internal-testing.yml',
    '.github/workflows/android-production-bundle.yml',
    '.github/workflows/ios-testflight.yml',
    '.github/workflows/mobile-exact-main-rc.yml',
    '.github/android-internal-release-request.json',
    '.github/android-production-bundle-request.json',
  ];
  for (const name of [
    'mobile.yml', 'android-internal-testing.yml',
    'android-production-bundle.yml', 'mobile-store-screenshots.yml',
  ]) {
    const flow = readFileSync('.github/workflows/' + name, 'utf8');
    const section = flow.split('  pull_request:')[1]?.split(/\n  (?:push|workflow_dispatch):|\n\npermissions:/)[0];
    assert.ok(section, name);
    for (const input of requiredNativePaths) {
      assert.ok(section.includes("'" + input + "'"), name + ' must react to ' + input);
    }
  }
});
