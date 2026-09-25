import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const unit = readFileSync('.github/workflows/test.yml','utf8');
const browser = readFileSync('.github/workflows/e2e.yml','utf8');

for (const [name, flow] of [['test',unit],['browser',browser]]) {
  test(name+' required workflow reruns after a stacked PR retarget',()=>{
    assert.match(flow,/pull_request:\n\s+types: \[opened, synchronize, reopened, edited\]/);
    assert.match(flow,/cancel-in-progress: true/);
    assert.match(flow,/git diff --name-only "\$PR_BASE_SHA" "\$PR_HEAD_SHA"/);
    assert.match(flow,/mobile\/\*/);
    assert.match(flow,/\.github\/workflows\/android-\*\.yml/);
    assert.match(flow,/Native-mobile\/release-only PR/);
  });
}

test('required test fast path keeps the account-deletion secret guard',()=>{
  assert.match(unit,/Verify account-deletion release secrets are provisioned/);
  assert.match(unit,/if: github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
});

test('browser dependency installation is skipped on the mobile-only fast path',()=>{
  assert.match(browser,/name: Install browser test dependency\n\s+if: steps\.scope\.outputs\.run_full == 'true'/);
  assert.match(browser,/name: Run browser regression\n\s+if: steps\.scope\.outputs\.run_full == 'true'/);
});
