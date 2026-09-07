import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSeed, gameShareUrl, seedHash, seededRandom } from '../gameplay.mjs';

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

test('cleanSeed strips unsafe characters', () => {
  assert.equal(cleanSeed('ABC-123_!!'), 'abc123');
});

test('gameShareUrl preserves the replay seed and challenge score', () => {
  const url = new URL(gameShareUrl({
    origin: 'https://magic.planitnow.us/',
    setId: 'msh',
    mode: 'full',
    seed: 'Seed-42',
    score: 87.4,
    name: 'Copper Fox 22',
  }));
  assert.equal(url.searchParams.get('set'), 'msh');
  assert.equal(url.searchParams.get('mode'), 'full');
  assert.equal(url.searchParams.get('seed'), 'seed42');
  assert.equal(url.searchParams.get('vs'), '87');
  assert.equal(url.searchParams.get('by'), 'Copper Fox 22');
});

test('gameShareUrl does not invent a zero-score challenge', () => {
  const url = new URL(gameShareUrl({
    origin: 'https://magic.planitnow.us/',
    setId: 'ecl',
    mode: 'top3',
    seed: 'normal-game',
  }));
  assert.equal(url.searchParams.get('set'), 'ecl');
  assert.equal(url.searchParams.get('mode'), 'top3');
  assert.equal(url.searchParams.has('vs'), false);
  assert.equal(url.searchParams.has('by'), false);
});
