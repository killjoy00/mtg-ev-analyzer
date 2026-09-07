import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gradePick, gradeTopThree, rankCandidates, summarizeResults } from '../scoring.mjs';

const SETS = ['msh', 'sos', 'tmt', 'ecl'];

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
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
  const picks = replay.picks || [];
  if (!picks.length) return [];
  const firstPackNumber = Math.min(...picks.map((pick) => Number(pick.pack_number)));
  return picks
    .filter((pick) => Number(pick.pack_number) === firstPackNumber)
    .sort((a, b) => Number(a.pick_number) - Number(b.pick_number));
}

test('consensus scoring separates strong historical seats from random clicking', async () => {
  const historicalPackScores = [];
  const randomPackScores = [];
  const worstPackScores = [];
  const reversedTopThreeScores = [];
  const missesTwoTopThreeScores = [];
  const nearFourthScores = [];
  let reversedWins = 0;
  let topThreeComparisons = 0;
  let totalPicks = 0;
  let replayCount = 0;

  for (const setId of SETS) {
    const shardDir = join('data', setId, 'shards');
    const files = (await readdir(shardDir)).filter((name) => name.endsWith('.json')).sort();
    for (const file of files) {
      const shard = JSON.parse(await readFile(join(shardDir, file), 'utf8'));
      for (let replayIndex = 0; replayIndex < (shard.replays || []).length; replayIndex += 1) {
        const replay = shard.replays[replayIndex];
        const firstPack = firstPackPicks(replay);
        if (!firstPack.length) continue;

        const historicalResults = [];
        const randomResults = [];
        const worstResults = [];

        for (let pickIndex = 0; pickIndex < firstPack.length; pickIndex += 1) {
          const pick = firstPack[pickIndex];
          const candidates = pick.candidates || [];
          if (!candidates.length) continue;
          const historicalId = pick.historical_pick_id;
          const randomIndex = hashText(`${setId}|${file}|${replayIndex}|${pickIndex}`) % candidates.length;
          const randomId = candidates[randomIndex].id;
          const worstId = rankCandidates(candidates).at(-1).id;
          historicalResults.push(gradePick(candidates, historicalId, historicalId));
          randomResults.push(gradePick(candidates, randomId, historicalId));
          worstResults.push(gradePick(candidates, worstId, historicalId));
          totalPicks += 1;
        }

        historicalPackScores.push(summarizeResults(historicalResults).score);
        randomPackScores.push(summarizeResults(randomResults).score);
        worstPackScores.push(summarizeResults(worstResults).score);
        replayCount += 1;

        const opening = firstPack[0];
        const ranked = rankCandidates(opening.candidates || []);
        if (ranked.length >= 5) {
          const consensus = ranked.slice(0, 3).map((card) => card.id);
          const reversed = gradeTopThree(ranked, [...consensus].reverse(), opening.historical_pick_id);
          const missesTwo = gradeTopThree(ranked, [ranked[0].id, ranked[3].id, ranked[4].id], opening.historical_pick_id);
          const nearFourth = gradeTopThree(ranked, [ranked[0].id, ranked[1].id, ranked[3].id], opening.historical_pick_id);
          reversedTopThreeScores.push(reversed.score);
          missesTwoTopThreeScores.push(missesTwo.score);
          nearFourthScores.push(nearFourth.score);
          if (reversed.score > missesTwo.score) reversedWins += 1;
          topThreeComparisons += 1;
        }
      }
    }
  }

  const summary = {
    replays: replayCount,
    picks: totalPicks,
    historical_pack_mean: Number(average(historicalPackScores).toFixed(1)),
    historical_pack_p50: percentile(historicalPackScores, 0.50),
    random_pack_mean: Number(average(randomPackScores).toFixed(1)),
    random_pack_p50: percentile(randomPackScores, 0.50),
    random_pack_p90: percentile(randomPackScores, 0.90),
    worst_pack_mean: Number(average(worstPackScores).toFixed(1)),
    worst_pack_p50: percentile(worstPackScores, 0.50),
    strong_random_spread: Number((average(historicalPackScores) - average(randomPackScores)).toFixed(1)),
    reversed_top3_mean: Number(average(reversedTopThreeScores).toFixed(1)),
    misses_two_top3_mean: Number(average(missesTwoTopThreeScores).toFixed(1)),
    reversed_beats_misses_two_rate: Number((reversedWins / Math.max(1, topThreeComparisons) * 100).toFixed(1)),
    near_fourth_p50: percentile(nearFourthScores, 0.50),
  };
  console.log('SCORING_DISTRIBUTION', JSON.stringify(summary));

  assert.equal(replayCount, 1200);
  assert.ok(totalPicks > 10000);

  // Quality gates are about discrimination, not whether a new formula simply
  // inflates every score. Historical strong-drafter choices should remain
  // clearly separated from uniform random clicking.
  assert.ok(summary.historical_pack_p50 >= 80, `historical p50 too low: ${summary.historical_pack_p50}`);
  assert.ok(summary.strong_random_spread >= 25, `strong/random spread too small: ${summary.strong_random_spread}`);
  assert.ok(summary.random_pack_p50 < 65, `random p50 should not grade as C+ or better: ${summary.random_pack_p50}`);
  assert.ok(summary.worst_pack_p50 < 50, `worst-card p50 should be F territory: ${summary.worst_pack_p50}`);

  // Top 3 should primarily reward finding the right group while retaining a
  // smaller ordering signal. A near-equivalent #4 can still score well.
  assert.ok(summary.reversed_beats_misses_two_rate >= 75, `reversed top 3 loses too often: ${summary.reversed_beats_misses_two_rate}%`);
  assert.ok(summary.reversed_top3_mean >= summary.misses_two_top3_mean + 10);
  assert.ok(summary.near_fourth_p50 >= 80, `near #4 replacement is too punitive: ${summary.near_fourth_p50}`);
});
