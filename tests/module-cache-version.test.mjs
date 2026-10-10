import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('account and profile entry modules use release-versioned imports', async () => {
  const [index, bootstrap, daily, growth, profile, progression, draft, patreonHtml, patreonPage, practiceHtml, practiceJs] = await Promise.all([
    readFile('index.html', 'utf8'),
    readFile('bootstrap.mjs', 'utf8'),
    readFile('daily-home.mjs', 'utf8'),
    readFile('growth.mjs', 'utf8'),
    readFile('profile-product.mjs', 'utf8'),
    readFile('progression.mjs', 'utf8'),
    readFile('draft-run-product.mjs', 'utf8'),
    readFile('patreon/index.html', 'utf8'),
    readFile('patreon-page.mjs', 'utf8'),
    readFile('practice/index.html', 'utf8'),
    readFile('practice-page.mjs', 'utf8'),
  ]);

  assert.match(index, /bootstrap\.mjs\?v=14/);
  assert.match(bootstrap, /growth\.mjs\?v=10/);
  assert.match(bootstrap, /daily-home\.mjs\?v=11/);
  assert.match(bootstrap, /profile-product\.mjs\?v=10/);
  assert.match(bootstrap, /draft-run-product\.mjs\?v=14/);
  assert.match(daily, /growth\.mjs\?v=10/);
  assert.match(growth, /profile-product\.mjs\?v=10/);
  assert.match(growth, /draft-run-product\.mjs\?v=14/);
  assert.match(growth, /patreon-activation\.mjs\?v=2/);
  assert.match(profile, /progression\.mjs\?v=10/);
  assert.match(profile, /growth\.mjs\?v=10/);
  assert.match(progression, /growth\.mjs\?v=10/);
  assert.match(draft, /growth\.mjs\?v=10/);
  assert.match(draft, /share-cards\.mjs\?v=7/);
  assert.match(patreonHtml, /patreon-page\.mjs\?v=4/);
  assert.match(patreonPage, /patreon-activation\.mjs\?v=2/);
  assert.match(practiceHtml, /bootstrap\.mjs\?v=14/);
  assert.match(practiceHtml, /growth\.mjs\?v=10/);
  assert.match(practiceHtml, /draft-run-product\.mjs\?v=14/);
  assert.match(practiceHtml, /draft-run\.css\?v=13/);
  assert.match(practiceJs, /growth\.mjs\?v=10/);
  assert.match(patreonPage, /growth\.mjs\?v=10/);
});
