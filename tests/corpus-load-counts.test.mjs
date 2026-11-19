import test from 'node:test';
import assert from 'node:assert/strict';
import {corpusLoadCounts} from '../scripts/corpus-load-counts.mjs';

test('bounded verification counts interleaved sets and failures on later pages without rescanning', async () => {
  const pages = new Map([
    ['', [{set_id: 'a', puzzles: 600, cursor: 'id0999', unrated: 0, wrong_version: 0},
          {set_id: 'b', puzzles: 400, cursor: 'id1000', unrated: 0, wrong_version: 0}]],
    ['id1000', [{set_id: 'a', puzzles: 2, cursor: 'id1003', unrated: 1, wrong_version: 2},
               {set_id: 'b', puzzles: 1, cursor: 'id1002', unrated: 0, wrong_version: 0}]],
    ['id1003', []],
  ]);
  const progress = [];
  const result = await corpusLoadCounts(async (sql, params) => {
    assert.equal(params[0], 'v9');
    assert.equal(params[1], 'rating-v1');
    assert.ok(pages.has(params[2]), params[2]);
    const value = pages.get(params[2]); pages.delete(params[2]);
    return {rows: value};
  }, 'v9', 'rating-v1', row => progress.push(row));
  assert.equal(pages.size, 0);
  assert.deepEqual(result.rows, [
    {set_id: 'a', puzzles: 602, unrated: 1, wrong_version: 2},
    {set_id: 'b', puzzles: 401, unrated: 0, wrong_version: 0},
  ]);
  assert.deepEqual(progress, [{puzzles_scanned: 1000, sets_seen: 2}, {puzzles_scanned: 1003, sets_seen: 2}]);
});

test('verification fails closed when a nonempty page cannot advance', async () => {
  await assert.rejects(corpusLoadCounts(async () => ({rows: [{set_id: 'a', puzzles: 1, cursor: '', unrated: 0, wrong_version: 0}]}), 'v9', 'rating-v1'), /cursor did not advance/);
});
