import test from 'node:test';
import assert from 'node:assert/strict';
import {corpusHealthPicks} from '../scripts/corpus-health-picks.mjs';
import {corpusGates} from '../corpus-quality.mjs';

test('health honors pinned opening coverage without inferring missing picks from the candidate', () => {
  assert.deepEqual(corpusHealthPicks('blb', {first_pick: 1, last_pick: 11}), [1,2,3,4,5,6,7,8]);
  for (const id of ['ecl','tla','tmt']) assert.deepEqual(corpusHealthPicks(id, {first_pick: 2, last_pick: 10}), [2,3,4,5,6,7,8]);
  assert.deepEqual(corpusHealthPicks('powered-cube', {first_pick: 2, last_pick: 12}), [2,3,4,5,6,7,8,9]);
  assert.deepEqual(corpusHealthPicks('new-set'), [1,2,3,4,5,6,7,8]);
  assert.throws(() => corpusHealthPicks('ecl', {first_pick: 3, last_pick: 10}), /first pick/);
  assert.throws(() => corpusHealthPicks('ecl', {first_pick: 2, last_pick: 7}), /final served pick/);
});

test('a missing middle pick or a sparse band still fails the unchanged coverage gate', () => {
  const picks = corpusHealthPicks('ecl', {first_pick: 2, last_pick: 10});
  for (const missing of picks) {
    const minimum = Math.min(...picks.flatMap(pick => ['medium','hard'].map(band => pick === missing && band === 'hard' ? 0 : 20)));
    assert.equal(corpusGates({minimumPickBandSources: minimum}).gates.find(g => g.id === 'pick_coverage').pass, false);
  }
  assert.equal(corpusGates({minimumPickBandSources: 15}).gates.find(g => g.id === 'pick_coverage').pass, false);
  assert.equal(corpusGates({minimumPickBandSources: 16}).gates.find(g => g.id === 'pick_coverage').pass, true);
});
