import test from 'node:test';
import assert from 'node:assert/strict';
import { seedHash, seededRandom } from '../gameplay.mjs';

test('seededRandom is deterministic for a seed', () => {
  const a = seededRandom('pack-one');
  const b = seededRandom('pack-one');
  assert.deepEqual([a(), a(), a(), a()], [b(), b(), b(), b()]);
});

test('different seeds produce different streams', () => {
  const a = seededRandom('alpha');
  const b = seededRandom('beta');
  assert.notEqual(a(), b());
  assert.notEqual(seedHash('alpha'), seedHash('beta'));
});
