import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { conditionCandidatesForPath, pathTendency, poolsEqual } from '../path-model.mjs';
import { gradeFullPack } from '../worker/core.mjs';

const toyModel = {
  schema_version: 1,
  model_version: 'strong-player-counterfactual-path-v3',
  constants: {
    pair_min_seen: 8,
    pair_prior_strength: 24,
    context_strength: 0.75,
    commitment_picks: 8,
    max_log_adjustment: 0.9,
  },
  cards: ['Blue Start', 'Red Start', 'X', 'Y'],
  // [global seen, global picked, first-pack seen, first-pack picked, [[pick, seen, picked]]]
  stats: [
    [100, 50, 100, 50, [[1, 100, 50]]],
    [100, 50, 100, 50, [[1, 100, 50]]],
    [200, 100, 200, 100, [[2, 100, 50]]],
    [200, 100, 200, 100, [[2, 100, 50]]],
  ],
  pairs: [
    [2, 1, 100, 90], // X strongly follows Red Start
    [2, 0, 100, 10], // X strongly avoids Blue Start
    [3, 1, 100, 10], // Y strongly avoids Red Start
    [3, 0, 100, 90], // Y strongly follows Blue Start
  ],
};

test('identical player and historical pools preserve leakage-safe stored support exactly', () => {
  const candidates = [
    { id: 'x', name: 'X', model_probability: 0.52 },
    { id: 'y', name: 'Y', model_probability: 0.48 },
  ];
  const conditioned = conditionCandidatesForPath(candidates, {
    pickNumber: 2,
    historicalPool: { 'Red Start': 1 },
    userPool: { 'Red Start': 1 },
    pathModel: toyModel,
  });
  assert.equal(conditioned[0].model_probability, 0.52);
  assert.equal(conditioned[1].model_probability, 0.48);
  assert.ok(conditioned.every((card) => card.path_adjustment === 1));
});

test('counterfactual pool moves support toward cards strong players pair with that path', () => {
  const candidates = [
    { id: 'x', name: 'X', model_probability: 0.52 },
    { id: 'y', name: 'Y', model_probability: 0.48 },
  ];
  const conditioned = conditionCandidatesForPath(candidates, {
    pickNumber: 2,
    historicalPool: { 'Red Start': 1 },
    userPool: { 'Blue Start': 1 },
    pathModel: toyModel,
  });
  assert.ok(conditioned[0].model_probability < 0.52, 'X should lose support after moving off its Red path');
  assert.ok(conditioned[1].model_probability > 0.48, 'Y should gain support on its Blue path');
  assert.ok(Math.abs(conditioned.reduce((sum, card) => sum + card.model_probability, 0) - 1) < 1e-9);
  assert.ok(pathTendency(toyModel, 'Y', 2, { 'Blue Start': 1 }) > pathTendency(toyModel, 'Y', 2, { 'Red Start': 1 }));
});

test('worker Full Pack grading follows the player path instead of reusing the historical path', () => {
  const replay = {
    picks: [
      {
        pack_number: 1,
        pick_number: 1,
        historical_pick_id: 'red',
        pool: {},
        candidates: [
          { id: 'red', name: 'Red Start', model_probability: 0.5 },
          { id: 'blue', name: 'Blue Start', model_probability: 0.5 },
        ],
      },
      {
        pack_number: 1,
        pick_number: 2,
        historical_pick_id: 'x',
        pool: { 'Red Start': 1 },
        candidates: [
          { id: 'x', name: 'X', model_probability: 0.52 },
          { id: 'y', name: 'Y', model_probability: 0.48 },
        ],
      },
    ],
  };

  const historicalOnly = gradeFullPack(replay, ['blue', 'y']);
  const pathAware = gradeFullPack(replay, ['blue', 'y'], toyModel);
  assert.equal(historicalOnly.results[1].bestName, 'X');
  assert.equal(pathAware.results[1].bestName, 'Y');
  assert.equal(pathAware.results[1].pathDiverged, true);
  assert.ok(pathAware.results[1].score > historicalOnly.results[1].score);
});

test('pool comparison is count-aware', () => {
  assert.equal(poolsEqual({ X: 1 }, { X: 1 }), true);
  assert.equal(poolsEqual({ X: 1 }, { X: 2 }), false);
  assert.equal(poolsEqual({}, { X: 0 }), true);
});

test('browser and worker use byte-identical conditioning logic', async () => {
  const [browser, worker] = await Promise.all([
    readFile('path-model.mjs', 'utf8'),
    readFile('worker/path-model.mjs', 'utf8'),
  ]);
  assert.equal(worker, browser);
});
