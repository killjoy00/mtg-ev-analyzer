import test from 'node:test';
import assert from 'node:assert/strict';
import {corpusLoadCounts} from '../scripts/corpus-load-counts.mjs';

test('bounded verification includes rating and version failures on later pages and resets each set', async () => {
  const pages = new Map([
    ['a:', {puzzles: 1000, cursor: 'id1000', unrated: 0, wrong_version: 0}],
    ['a:id1000', {puzzles: 2, cursor: 'id1002', unrated: 1, wrong_version: 2}],
    ['a:id1002', {puzzles: 0, cursor: null, unrated: 0, wrong_version: 0}],
    ['b:', {puzzles: 1, cursor: 'id0001', unrated: 0, wrong_version: 0}],
    ['b:id0001', {puzzles: 0, cursor: null, unrated: 0, wrong_version: 0}],
  ]);
  const progress = [];
  const result = await corpusLoadCounts(async (sql, params) => {
    assert.equal(params[0], 'v9');
    if (sql.startsWith('SELECT DISTINCT')) return {rows: [{set_id: 'a'}, {set_id: 'b'}]};
    assert.equal(params[1], 'rating-v1');
    const key = params[2] + ':' + params[3];
    assert.ok(pages.has(key), key);
    const value = pages.get(key); pages.delete(key);
    return {rows: [value]};
  }, 'v9', 'rating-v1', row => progress.push(row));
  assert.equal(pages.size, 0);
  assert.deepEqual(result.rows, [
    {set_id: 'a', puzzles: 1002, unrated: 1, wrong_version: 2},
    {set_id: 'b', puzzles: 1, unrated: 0, wrong_version: 0},
  ]);
  assert.deepEqual(progress, result.rows);
});

test('verification fails closed when a nonempty page cannot advance', async () => {
  let calls = 0;
  await assert.rejects(corpusLoadCounts(async () => ({rows: ++calls === 1
    ? [{set_id: 'a'}] : [{puzzles: 1, cursor: '', unrated: 0, wrong_version: 0}]}), 'v9', 'rating-v1'), /cursor did not advance/);
});
