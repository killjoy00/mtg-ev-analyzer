import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('account and profile entry modules use release-versioned imports', async () => {
  const [index, bootstrap, daily, growth, profile, progression, draft] = await Promise.all([
    readFile('index.html', 'utf8'),
    readFile('bootstrap.mjs', 'utf8'),
    readFile('daily-home.mjs', 'utf8'),
    readFile('growth.mjs', 'utf8'),
    readFile('profile-product.mjs', 'utf8'),
    readFile('progression.mjs', 'utf8'),
    readFile('draft-run-product.mjs', 'utf8'),
  ]);

  assert.match(index, /bootstrap\.mjs\?v=5/);
  assert.match(bootstrap, /growth\.mjs\?v=5/);
  assert.match(bootstrap, /daily-home\.mjs\?v=5/);
  assert.match(bootstrap, /profile-product\.mjs\?v=5/);
  assert.match(bootstrap, /draft-run-product\.mjs\?v=5/);
  assert.match(daily, /growth\.mjs\?v=5/);
  assert.match(growth, /profile-product\.mjs\?v=5/);
  assert.match(profile, /progression\.mjs\?v=5/);
  assert.match(profile, /growth\.mjs\?v=5/);
  assert.match(progression, /growth\.mjs\?v=5/);
  assert.match(draft, /growth\.mjs\?v=5/);
});
