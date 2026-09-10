import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyMethodCopy } from '../legacy-product.mjs';

test('legacy sets are described as experienced high-ranked Arena cohorts', () => {
  const original = 'Generated offline. 300 high-win-rate drafts train the consensus model.';
  const revised = legacyMethodCopy(original, 'vow');
  assert.match(revised, /experienced, high-ranked Arena drafts train the consensus model/i);
  assert.doesNotMatch(revised, /high-win-rate drafts train/i);
});

test('modern sets keep the normal high-win-rate wording', () => {
  const original = '300 high-win-rate drafts train the consensus model.';
  assert.equal(legacyMethodCopy(original, 'fin'), original);
});
