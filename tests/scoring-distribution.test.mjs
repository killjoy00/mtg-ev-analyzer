import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gradePick } from '../scoring.mjs';

const SETS = ['msh', 'sos', 'tmt', 'ecl'];

function oldLinearScore(candidates, selectedId) {
  const ranked = [...candidates].sort((a, b) => Number(b.model_probability || 0) - Number(a.model_probability || 0));
  const best = Number(ranked[0]?.model_probability || 0);
  const selected = Number(ranked.find((card) => card.id === selectedId)?.model_probability || 0);
  if (best <= 1e-9) return 100;
  return Math.round(Math.max(0, Math.min(1, selected / best)) * 100);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

test('consensus scoring has a sensible distribution on historical experienced-drafter picks', async () => {
  const oldPickScores = [];
  const newPickScores = [];
  const oldPackScores = [];
  const newPackScores = [];
  let consensusPicks = 0;
  let totalPicks = 0;
  let replayCount = 0;

  for (const setId of SETS) {
    const shardDir = join('data', setId, 'shards');
    const files = (await readdir(shardDir)).filter((name) => name.endsWith('.json')).sort();
    for (const file of files) {
      const shard = JSON.parse(await readFile(join(shardDir, file), 'utf8'));
      for (const replay of shard.replays || []) {
        const picks = replay.picks || [];
        if (!picks.length) continue;
        const firstPackNumber = Math.min(...picks.map((pick) => Number(pick.pack_number)));
        const firstPack = picks.filter((pick) => Number(pick.pack_number) === firstPackNumber);
        const replayOld = [];
        const replayNew = [];
        for (const pick of firstPack) {
          const selectedId = pick.historical_pick_id;
          const result = gradePick(pick.candidates || [], selectedId, selectedId);
          const oldScore = oldLinearScore(pick.candidates || [], selectedId);
          replayOld.push(oldScore);
          replayNew.push(result.score);
          oldPickScores.push(oldScore);
          newPickScores.push(result.score);
          if (result.consensusMatch) consensusPicks += 1;
          totalPicks += 1;
        }
        if (replayNew.length) {
          oldPackScores.push(Math.round(average(replayOld)));
          newPackScores.push(Math.round(average(replayNew)));
          replayCount += 1;
        }
      }
    }
  }

  const summary = {
    replays: replayCount,
    picks: totalPicks,
    consensus_pick_rate: Number((consensusPicks / totalPicks * 100).toFixed(1)),
    old_pick_mean: Number(average(oldPickScores).toFixed(1)),
    new_pick_mean: Number(average(newPickScores).toFixed(1)),
    old_pack_mean: Number(average(oldPackScores).toFixed(1)),
    new_pack_mean: Number(average(newPackScores).toFixed(1)),
    old_pack_p10: percentile(oldPackScores, 0.10),
    old_pack_p50: percentile(oldPackScores, 0.50),
    old_pack_p90: percentile(oldPackScores, 0.90),
    new_pack_p10: percentile(newPackScores, 0.10),
    new_pack_p50: percentile(newPackScores, 0.50),
    new_pack_p90: percentile(newPackScores, 0.90),
  };
  console.log('SCORING_DISTRIBUTION', JSON.stringify(summary));

  assert.equal(replayCount, 1200);
  assert.ok(totalPicks > 10000);
  assert.ok(summary.new_pick_mean >= summary.old_pick_mean);
  assert.ok(summary.new_pack_p90 <= 100);
  assert.ok(summary.new_pack_p10 >= summary.old_pack_p10);
});
