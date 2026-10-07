import test from 'node:test';
import assert from 'node:assert/strict';
import {needsNativeScreenshots} from '../scripts/screenshot-ci-scope.mjs';
test('test and validation-only changes skip native capture while keeping mobile validation',()=>{
  assert.equal(needsNativeScreenshots(['mobile/tests/review-refresh-races.test.cjs','mobile/scripts/run-unit-tests.mjs']),false);
  const before={dependencies:{expo:'57'},scripts:{test:'old'}},after={...before,scripts:{test:'new'}};
  assert.equal(needsNativeScreenshots(['mobile/package.json'],{packageBefore:before,packageAfter:after}),false);
  assert.equal(needsNativeScreenshots(['mobile/package.json'],{packageBefore:before,packageAfter:{...after,dependencies:{expo:'58'}}}),true);
});
test('screen, native, fixture, dependency and unknown mobile changes retain device coverage',()=>{
  for(const path of ['mobile/app/draft-run.tsx','mobile/assets/icon.png','mobile/src/screenshots/fixtures.ts','mobile/package-lock.json','mobile/unknown-file','.github/workflows/mobile-store-screenshots.yml'])assert.equal(needsNativeScreenshots([path]),true,path);
  assert.equal(needsNativeScreenshots([]),true);
  assert.equal(needsNativeScreenshots(['mobile/tests/fake.test.cjs','mobile/app/index.tsx']),true);
});
