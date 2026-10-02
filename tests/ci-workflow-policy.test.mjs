import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const unit = readFileSync('.github/workflows/test.yml','utf8');
const browser = readFileSync('.github/workflows/e2e.yml','utf8');
const mobile = readFileSync('.github/workflows/mobile.yml','utf8');

for (const [name, flow] of [['test',unit],['browser',browser]]) {
  test(name+' classification is retarget-invariant and metadata edits do not rerun it',()=>{
    assert.match(flow,/pull_request:\n\s+types: \[opened, synchronize, reopened\]/);
    assert.doesNotMatch(flow,/types: \[[^\]]*edited/);
    assert.match(flow,/cancel-in-progress: true/);
    assert.match(flow,/git fetch --no-tags origin main:refs\/remotes\/origin\/main/);
    assert.match(flow,/git merge-base origin\/main "\$PR_HEAD_SHA"/);
    assert.match(flow,/git diff --name-only "\$stack_base_sha" "\$PR_HEAD_SHA"/);
    assert.doesNotMatch(flow,/PR_BASE_SHA/);
    assert.match(flow,/mobile\/\*/);
    assert.match(flow,/\.github\/workflows\/android-\*\.yml/);
    assert.match(flow,/Native-mobile\/release-only PR/);
  });
}

test('required test fast path keeps the account-deletion secret guard',()=>{
  assert.match(unit,/workflow_dispatch:/);
  assert.match(unit,/Verify account-deletion release secrets are provisioned/);
  assert.match(unit,/if: github\.event_name == 'workflow_dispatch' \|\| \(github\.event_name == 'pull_request' && github\.event\.pull_request\.head\.repo\.full_name == github\.repository\)/);
});

test('browser dependency installation is skipped on the mobile-only fast path',()=>{
  assert.match(browser,/name: Install browser test dependency\n\s+if: steps\.scope\.outputs\.run_full == 'true'/);
  assert.match(browser,/name: Run browser regression\n\s+if: steps\.scope\.outputs\.run_full == 'true'/);
});

test('targeted mobile validation ignores PR metadata edits',()=>{
  assert.match(mobile,/pull_request:\n\s+types: \[opened, synchronize, reopened\]/);
  assert.doesNotMatch(mobile,/types: \[[^\]]*edited/);
  assert.match(mobile,/group: mobile-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/);
  assert.match(mobile,/cancel-in-progress: true/);
});


test('Gradle cache is main-seeded, PR-read-only, and absent from signed jobs',()=>{
  const mainRc = readFileSync('.github/workflows/mobile-exact-main-rc.yml','utf8');
  const android = readFileSync('.github/workflows/android-production-bundle.yml','utf8');
  assert.match(mainRc,/actions\/cache\/restore@v4/);
  assert.match(mainRc,/actions\/cache\/save@v4/);
  assert.match(mainRc,/mobile\/node_modules\/\*\*\/\.cxx/);
  assert.match(mainRc,/Verify unsigned Gradle cache contains no signing material/);
  assert.match(android,/Restore main-seeded unsigned Gradle cache[\s\S]*actions\/cache\/restore@v4/);
  const signed = android.split('  signed-bundle:')[1] ?? '';
  assert.doesNotMatch(signed,/actions\/cache\/(?:restore|save)@/);
  assert.doesNotMatch(mainRc,/~\/\.gradle\/gradle\.properties/);
});

test('exact-main RC treats main movement as stale evidence, not a build failure',()=>{
  const mainRc = readFileSync('.github/workflows/mobile-exact-main-rc.yml','utf8');
  assert.match(mainRc,/id: freshness/);
  assert.match(mainRc,/echo "current=false" >> "\$GITHUB_OUTPUT"/);
  assert.match(mainRc,/::notice::RC source/);
  assert.match(mainRc,/if: steps\.freshness\.outputs\.current == 'true'/);
});
