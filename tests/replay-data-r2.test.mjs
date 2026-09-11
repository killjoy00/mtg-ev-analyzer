import test from 'node:test';
import assert from 'node:assert/strict';
import { replayResourceUrl } from '../replay-data.mjs';

test('replay shards use the R2 data domain while metadata stays on Pack One', () => {
  assert.equal(
    replayResourceUrl('./data/hob/shards/000.json').href,
    'https://data.packone.pro/data/hob/shards/000.json',
  );
  assert.equal(replayResourceUrl('./data/catalog.json').href, 'https://packone.pro/data/catalog.json');
  assert.equal(replayResourceUrl('./data/hob/manifest.json').href, 'https://packone.pro/data/hob/manifest.json');
  assert.equal(replayResourceUrl('./data/hob/path-model.json').href, 'https://packone.pro/data/hob/path-model.json');
});
