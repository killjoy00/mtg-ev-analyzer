import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('account and profile entry modules use release-versioned imports', async () => {
  const [index, bootstrap, daily, growth, profile, myPackOne, progression, draft, patreonHtml, patreonPage, practiceHtml, practiceJs] = await Promise.all([
    readFile('index.html', 'utf8'),
    readFile('bootstrap.mjs', 'utf8'),
    readFile('daily-home.mjs', 'utf8'),
    readFile('growth.mjs', 'utf8'),
    readFile('profile-product.mjs', 'utf8'),
    readFile('my-pack-one.mjs', 'utf8'),
    readFile('progression.mjs', 'utf8'),
    readFile('draft-run-product.mjs', 'utf8'),
    readFile('patreon/index.html', 'utf8'),
    readFile('patreon-page.mjs', 'utf8'),
    readFile('practice/index.html', 'utf8'),
    readFile('practice-page.mjs', 'utf8'),
  ]);

  assert.match(index, /bootstrap\.mjs\?v=43/);
  assert.match(bootstrap, /growth\.mjs\?v=32/);
  assert.match(bootstrap, /daily-home\.mjs\?v=25/);
  assert.match(bootstrap, /profile-product\.mjs\?v=24/);
  assert.match(bootstrap, /draft-run-product\.mjs\?v=34/);
  assert.match(daily, /growth\.mjs\?v=28/);
  assert.match(growth, /profile-product\.mjs\?v=24/);
  assert.match(growth, /draft-run-product\.mjs\?v=34/);
  assert.match(growth, /patreon-activation\.mjs\?v=2/);
  assert.match(profile, /progression\.mjs\?v=10/);
  assert.match(profile, /growth\.mjs\?v=28/);
  assert.match(profile, /my-pack-one\.mjs\?v=13/);
  assert.match(profile, /profile\.css\?v=18/);
  assert.match(profile, /daily-reminder-settings\.mjs\?v=5/);
  assert.match(await readFile('daily-reminder-settings.mjs','utf8'), /growth-api\.mjs\?v=2/);
  assert.match(myPackOne, /my-pack-insights\.mjs\?v=5/);
  assert.match(progression, /growth\.mjs\?v=10/);
  assert.match(draft, /growth\.mjs\?v=32/);
  assert.match(draft, /trophy-deck-dialog\.mjs\?v=2/);
  assert.match(draft, /share-cards\.mjs\?v=10/);
  assert.match(draft, /today-status\.mjs\?v=2/);
  assert.match(draft, /set-guides\.mjs\?v=2/);
  assert.match(draft, /draft-run-feedback\.mjs\?v=7/);
  assert.match(patreonHtml, /patreon-page\.mjs\?v=5/);
  assert.match(patreonPage, /patreon-activation\.mjs\?v=2/);
  assert.match(practiceHtml, /bootstrap\.mjs\?v=43/);
  assert.match(practiceHtml, /growth\.mjs\?v=28/);
  assert.match(practiceHtml, /draft-run-product\.mjs\?v=34/);
  assert.match(practiceHtml, /draft-run\.css\?v=23/);
  assert.match(practiceJs, /growth\.mjs\?v=28/);
  assert.match(patreonPage, /growth\.mjs\?v=10/);
});
