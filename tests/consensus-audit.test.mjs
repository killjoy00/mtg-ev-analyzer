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
      });
    }
  }

  const highestSupport = Math.max(...firstPicks.map((item) => item.support));
  const bestOrdinal = Math.min(...firstPicks.map((item) => item.rank));
  const secondChoiceCase = firstPicks.find((item) => item.rank === 2);

  console.log('ARC_REACTOR_SANITY ' + JSON.stringify({
    replaySeats: replays.length,
    firstPickCount: firstPicks.length,
    bestOrdinal,
    highestSupport,
    secondChoiceCase,
  }));

  assert.equal(replays.length, 300);
  assert.equal(firstPicks.length, 7);
  assert.ok(firstPicks.every((item) => item.rank > 1), 'Arc Reactor must never be the model first pick in the current MSH opening-pack archive');
  assert.ok(highestSupport < 0.10, `Arc Reactor opening-pack support unexpectedly rose to ${(highestSupport * 100).toFixed(1)}%`);
  assert.ok(secondChoiceCase, 'the known low-support #2 case should remain represented in the audit');
  assert.ok(secondChoiceCase.pickScore < 20, `a low-support Arc Reactor P1P1 should score as a major disagreement, got ${secondChoiceCase.pickScore}`);
  assert.ok(secondChoiceCase.bestSupport > 0.75, 'the known #2 case should remain a lopsided pack, not a close call');
});
