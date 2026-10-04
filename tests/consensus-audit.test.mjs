import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { gradePick, rankCandidates } from '../scoring.mjs';

async function loadSet(setId) {
  const manifest = JSON.parse(await readFile(`data/${setId}/manifest.json`, 'utf8'));
  const replays = [];
  for (const shard of manifest.shards || []) {
    const payload = JSON.parse(await readFile(shard.path.replace(/^\.\//, ''), 'utf8'));
    replays.push(...(payload.replays || []));
  }
  return replays;
}

test('MSH Arc Reactor never looks like a strong opening pick', async () => {
  const replays = await loadSet('msh');
  const firstPicks = [];

  for (const replay of replays) {
    for (const pick of replay.picks || []) {
      if (Number(pick.pack_number) !== 1 || Number(pick.pick_number) !== 1) continue;
      const ranked = rankCandidates(pick.candidates || []);
      const index = ranked.findIndex((card) => card.name === 'Arc Reactor');
      if (index < 0) continue;
      const arc = ranked[index];
      const grade = gradePick(pick.candidates, arc.id, pick.historical_pick_id);
      firstPicks.push({
        draftId: replay.draft_id,
        rank: index + 1,
        support: Number(arc.model_probability || 0),
        pickScore: grade.score,
        bestName: grade.bestName,
        bestSupport: grade.bestProbability,
        verdictClass: grade.verdictClass,
      });
    }
  }

  const highestSupport = Math.max(...firstPicks.map((item) => item.support));
  const bestOrdinal = Math.min(...firstPicks.map((item) => item.rank));
  const highestScore = Math.max(...firstPicks.map((item) => item.pickScore));

  console.log('ARC_REACTOR_SANITY ' + JSON.stringify({
    replaySeats: replays.length,
    firstPickCount: firstPicks.length,
    bestOrdinal,
    highestSupport,
    highestScore,
  }));

  assert.equal(replays.length, 300);
  assert.ok(firstPicks.length > 0, 'Arc Reactor must be represented in the opening-pack audit');
  assert.ok(firstPicks.every((item) => item.rank > 1), 'Arc Reactor must never be the model first pick in the current MSH opening-pack archive');
  // Raw support and sample membership change with the qualified training pool.
  // The actual product semantics must still classify every such choice as a
  // big disagreement, rather than an in-the-mix/close/consensus opening pick.
  assert.ok(firstPicks.every(item=>item.verdictClass==='miss'), `Arc Reactor must remain a big disagreement; highest opening score ${highestScore}`);
});
