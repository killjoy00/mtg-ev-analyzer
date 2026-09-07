import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReplayPayload, rarityBucket, seededReplayPlan, sortCatalogSets, sortPackByRarity } from '../replay-data.mjs';

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

test('sortCatalogSets lists newest data first', () => {
  const sets = [
    { id: 'old', data_date: '2026-02-01' },
    { id: 'new', data_date: '2026-08-01' },
    { id: 'mid', data_date: '2026-05-01' },
  ];
  assert.deepEqual(sortCatalogSets(sets).map((set) => set.id), ['new', 'mid', 'old']);
});

test('normalizeReplayPayload sorts candidates inside every pick', () => {
  const payload = {
    replays: [{ picks: [{ candidates: [
      { name: 'C', rarity: 'common' },
      { name: 'U', rarity: 'uncommon' },
      { name: 'R', rarity: 'rare' },
    ] }] }],
  };
  const normalized = normalizeReplayPayload('/data/msh/shards/000.json', payload);
  assert.deepEqual(normalized.replays[0].picks[0].candidates.map((card) => card.name), ['R', 'U', 'C']);
});


test('seededReplayPlan deterministically identifies the exact next shard and replay', () => {
  const manifest = { shards: [
    { path: './a.json', replay_count: 2 },
    { path: './b.json', replay_count: 2 },
    { path: './c.json', replay_count: 2 },
  ] };
  const first = seededReplayPlan(manifest, 'nextpackseed123');
  const second = seededReplayPlan(manifest, 'nextpackseed123');
  assert.deepEqual(first, second);
  assert.ok(manifest.shards.includes(first.shard));
  assert.ok(first.replayIndex >= 0 && first.replayIndex < first.shard.replay_count);
});
