import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gradePick, rankCandidates, summarizeResults } from '../scoring.mjs';
import { conditionCandidatesForPath, poolsEqual } from '../path-model.mjs';
import { gradeFullPack as gradeWorkerFullPack } from '../worker/core.mjs';

const SETS = ['msh', 'sos', 'tmt', 'ecl'];

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function hashText(value) {
  let hash = 2166136261;
  for (let i = 0; i < String(value).length; i += 1) {
    hash ^= String(value).charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function firstPackPicks(replay) {
  const picks = replay?.picks || [];
  if (!picks.length) return [];
  const firstPackNumber = Math.min(...picks.map((pick) => Number(pick.pack_number)));
  return picks
    .filter((pick) => Number(pick.pack_number) === firstPackNumber)
    .sort((a, b) => Number(a.pick_number) - Number(b.pick_number));
}

function addToPool(pool, cardName) {
  if (cardName) pool[cardName] = (Number(pool[cardName]) || 0) + 1;
}

function totalVariation(original, conditioned) {
  const byId = new Map(conditioned.map((card) => [card.id, Number(card.model_probability || 0)]));
  return 0.5 * original.reduce((sum, card) => sum + Math.abs(Number(card.model_probability || 0) - Number(byId.get(card.id) || 0)), 0);
}

test('counterfactual path model changes later decisions without rewriting the historical benchmark', async (t) => {
  for (const setId of SETS) {
    try {
      await access(join('data', setId, 'path-model.json'));
    } catch {
      t.skip('Generated path-model artifacts are not present on this branch yet.');
      return;
    }
  }

  const historicalScores = [];
  const randomPathScores = [];
  const rankedRandomScores = [];
  const tvEarly = [];
  const tvLate = [];
  const pathMultipliers = [];
  let replayCount = 0;
  let historicalPoolMismatches = 0;
  let historicalProbabilityChanges = 0;
  let divergentDecisions = 0;
  let changedLeaders = 0;
  let counterfactualReplays = 0;

  for (const setId of SETS) {
    const pathModel = JSON.parse(await readFile(join('data', setId, 'path-model.json'), 'utf8'));
    assert.equal(pathModel.model_version, 'strong-player-counterfactual-path-v3');
    assert.ok(Number(pathModel.training?.excluded_replay_drafts || 0) >= 250);

    const shardDir = join('data', setId, 'shards');
    const files = (await readdir(shardDir)).filter((name) => name.endsWith('.json')).sort();
    for (const file of files) {
      const shard = JSON.parse(await readFile(join(shardDir, file), 'utf8'));
      for (let replayIndex = 0; replayIndex < (shard.replays || []).length; replayIndex += 1) {
        const replay = shard.replays[replayIndex];
        const picks = firstPackPicks(replay);
        if (!picks.length) continue;
        replayCount += 1;

        // 1) Following the real drafter's path must reproduce every stored
        // historical pool and preserve the original leakage-safe support byte
        // for byte. The new model is a counterfactual delta, not a rewrite.
        const historicalPool = { ...(picks[0].pool || {}) };
        const historicalResults = [];
        for (const pick of picks) {
          if (!poolsEqual(historicalPool, pick.pool || {})) historicalPoolMismatches += 1;
          const conditioned = conditionCandidatesForPath(pick.candidates, {
            pickNumber: Number(pick.pick_number),
            historicalPool: pick.pool || {},
            userPool: historicalPool,
            pathModel,
          });
          for (let i = 0; i < conditioned.length; i += 1) {
            if (conditioned[i].model_probability !== Number(pick.candidates[i].model_probability || 0)) historicalProbabilityChanges += 1;
          }
          historicalResults.push(gradePick(conditioned, pick.historical_pick_id, pick.historical_pick_id));
          const historicalCard = conditioned.find((card) => card.id === pick.historical_pick_id);
          addToPool(historicalPool, historicalCard?.name);
        }
        historicalScores.push(summarizeResults(historicalResults).score);

        // 2) Deterministic random clicking is scored sequentially on the pool
        // those random choices actually create. We also run those exact IDs
        // through the production worker grader so replay-bound wheels get the
        // same zero-weight treatment used by ranked Daily Full Pack scores.
        const randomPool = { ...(picks[0].pool || {}) };
        const randomResults = [];
        const randomIds = [];
        for (let pickIndex = 0; pickIndex < picks.length; pickIndex += 1) {
          const pick = picks[pickIndex];
          const conditioned = conditionCandidatesForPath(pick.candidates, {
            pickNumber: Number(pick.pick_number),
            historicalPool: pick.pool || {},
            userPool: randomPool,
            pathModel,
          });
          const selected = conditioned[hashText(`${setId}|${file}|${replayIndex}|${pickIndex}|path`) % conditioned.length];
          randomIds.push(selected.id);
          randomResults.push(gradePick(conditioned, selected.id, pick.historical_pick_id));
          addToPool(randomPool, selected.name);
        }
        randomPathScores.push(summarizeResults(randomResults).score);
        rankedRandomScores.push(gradeWorkerFullPack(replay, randomIds, pathModel).score);

        // 3) Force the first observed decision away from the historical pick,
        // then follow the path-aware leader. Measure how much later support
        // and card leadership actually respond to that counterfactual history.
        if (picks[0].candidates.length < 2) continue;
        const firstRanked = rankCandidates(picks[0].candidates);
        const divergence = firstRanked.find((card) => card.id !== picks[0].historical_pick_id);
        if (!divergence) continue;
        counterfactualReplays += 1;
        const userPool = { ...(picks[0].pool || {}) };
        addToPool(userPool, divergence.name);

        for (let pickIndex = 1; pickIndex < picks.length; pickIndex += 1) {
          const pick = picks[pickIndex];
          const conditioned = conditionCandidatesForPath(pick.candidates, {
            pickNumber: Number(pick.pick_number),
            historicalPool: pick.pool || {},
            userPool,
            pathModel,
          });
          const tv = totalVariation(pick.candidates, conditioned);
          if (pickIndex <= 3) tvEarly.push(tv);
          if (pickIndex >= 7) tvLate.push(tv);
          divergentDecisions += 1;
          const historicalLeader = rankCandidates(pick.candidates)[0]?.id;
          const pathLeader = rankCandidates(conditioned)[0];
          if (pathLeader?.id && pathLeader.id !== historicalLeader) changedLeaders += 1;
          for (const card of conditioned) {
            if (Number.isFinite(card.path_adjustment)) pathMultipliers.push(card.path_adjustment);
            assert.ok(Number.isFinite(card.model_probability) && card.model_probability >= 0);
          }
          addToPool(userPool, pathLeader?.name);
        }
      }
    }
  }

  const summary = {
    replays: replayCount,
    counterfactual_replays: counterfactualReplays,
    historical_pool_mismatches: historicalPoolMismatches,
    historical_probability_changes: historicalProbabilityChanges,
    historical_score_mean: Number(average(historicalScores).toFixed(1)),
    historical_score_p50: percentile(historicalScores, 0.5),
    random_path_mean: Number(average(randomPathScores).toFixed(1)),
    random_path_p50: percentile(randomPathScores, 0.5),
    ranked_random_mean: Number(average(rankedRandomScores).toFixed(1)),
    ranked_random_p50: percentile(rankedRandomScores, 0.5),
    changed_leader_rate: Number((changedLeaders / Math.max(1, divergentDecisions) * 100).toFixed(1)),
    early_tv_mean: Number((average(tvEarly) * 100).toFixed(2)),
    late_tv_mean: Number((average(tvLate) * 100).toFixed(2)),
    multiplier_p05: Number(percentile(pathMultipliers, 0.05).toFixed(3)),
    multiplier_p95: Number(percentile(pathMultipliers, 0.95).toFixed(3)),
  };
  console.log('PATH_MODEL_DISTRIBUTION', JSON.stringify(summary));

  assert.equal(replayCount, 1200);
  assert.equal(historicalPoolMismatches, 0, 'historical selections should reconstruct the stored historical pool exactly');
  assert.equal(historicalProbabilityChanges, 0, 'matching the historical path must preserve stored support exactly');
  assert.ok(summary.historical_score_p50 >= 80, `historical benchmark regressed: ${summary.historical_score_p50}`);
  assert.ok(summary.historical_score_mean >= summary.random_path_mean + 20, 'path-aware random clicking is too close to strong historical drafting');
  assert.ok(summary.historical_score_mean >= summary.ranked_random_mean + 20, 'ranked path-aware random clicking is too close to strong historical drafting');
  assert.ok(summary.random_path_p50 < 70, `random path p50 too generous: ${summary.random_path_p50}`);
  assert.ok(summary.ranked_random_p50 < 70, `ranked random path p50 too generous: ${summary.ranked_random_p50}`);
  assert.ok(summary.changed_leader_rate >= 1, `counterfactual path almost never changes a leader: ${summary.changed_leader_rate}%`);
  assert.ok(summary.late_tv_mean >= summary.early_tv_mean, `path influence should not shrink as the pool grows: early ${summary.early_tv_mean}, late ${summary.late_tv_mean}`);
  assert.ok(Math.min(...pathMultipliers) >= Math.exp(-0.9) - 1e-9);
  assert.ok(Math.max(...pathMultipliers) <= Math.exp(0.9) + 1e-9);
});
