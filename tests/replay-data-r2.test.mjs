import test from 'node:test';
import assert from 'node:assert/strict';
import { replayResourceUrl } from '../replay-data.mjs';

test('production replay shards use R2 while metadata stays on Pack One', () => {
  assert.equal(
    replayResourceUrl('./data/hob/shards/000.json').href,
    'https://data.packone.pro/data/hob/shards/000.json',
  );
  assert.equal(replayResourceUrl('./data/catalog.json').href, 'https://packone.pro/data/catalog.json');
  assert.equal(replayResourceUrl('./data/hob/manifest.json').href, 'https://packone.pro/data/hob/manifest.json');
  assert.equal(replayResourceUrl('./data/hob/path-model.json').href, 'https://packone.pro/data/hob/path-model.json');
});

test('local development keeps replay shards same-origin', () => {
  assert.equal(
    replayResourceUrl('http://127.0.0.1:4173/data/hob/shards/000.json').href,
    'http://127.0.0.1:4173/data/hob/shards/000.json',
  );
  assert.equal(
    replayResourceUrl('http://localhost:4173/data/powered-cube/shards/000.json').href,
    'http://localhost:4173/data/powered-cube/shards/000.json',
  );
});
