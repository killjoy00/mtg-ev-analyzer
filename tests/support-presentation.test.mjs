import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const product = await readFile('product.mjs', 'utf8');

test('low-support outliers are visibly flagged below 8 percent', () => {
  assert.match(product, /LOW_SUPPORT_THRESHOLD = 0\.08/);
  assert.match(product, /Low support: under 8% modeled strong-player support/);
  assert.match(product, /support-outlier-flag/);
  assert.match(product, /\.card-choice \.card-footer span/);
});

test('full-pack reveal presents support instead of ordinal consensus rank', () => {
  assert.match(product, /Your support/);
  assert.match(product, /Strong-player leader/);
  assert.match(product, /Support gap/);
  assert.match(product, /Consensus rank/);
});

test('full-pack sticky action dock carries the revealed pick score', () => {
  assert.match(product, /\.action-dock\.inline-dock/);
  assert.match(product, /#next-pick/);
  assert.match(product, /floatingScore/);
  assert.match(product, /\/100\$\{verdict/);
});
