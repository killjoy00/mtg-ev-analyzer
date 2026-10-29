import test from 'node:test';
import assert from 'node:assert/strict';
import { rarityBucket, sortPackByRarity } from '../replay-data.mjs';

test('rarity buckets put mythics and rares before uncommons and commons', () => {
  assert.equal(rarityBucket('mythic'), 0);
  assert.equal(rarityBucket('rare'), 0);
  assert.equal(rarityBucket('uncommon'), 1);
  assert.equal(rarityBucket('common'), 2);
});

test('sortPackByRarity groups cards by rarity while preserving order inside a rarity band', () => {
  const cards = [
    { name: 'Common A', rarity: 'common' },
    { name: 'Rare A', rarity: 'rare' },
    { name: 'Uncommon A', rarity: 'uncommon' },
    { name: 'Mythic A', rarity: 'mythic' },
    { name: 'Rare B', rarity: 'rare' },
    { name: 'Common B', rarity: 'common' },
  ];
  assert.deepEqual(sortPackByRarity(cards).map((card) => card.name), [
    'Rare A', 'Mythic A', 'Rare B', 'Uncommon A', 'Common A', 'Common B',
  ]);
});
