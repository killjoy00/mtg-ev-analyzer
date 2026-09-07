import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function loadSet(setId) {
  const manifest = JSON.parse(await readFile(`data/${setId}/manifest.json`, 'utf8'));
  const replays = [];
  for (const shard of manifest.shards || []) {
    const payload = JSON.parse(await readFile(shard.path.replace(/^\.\//, ''), 'utf8'));
    replays.push(...(payload.replays || []));
  }
  return replays;
}

function rankedCandidates(pick) {
  return [...(pick.candidates || [])].sort((a, b) => {
    const delta = Number(b.model_probability || 0) - Number(a.model_probability || 0);
    if (Math.abs(delta) > 1e-12) return delta;
    return String(a.name).localeCompare(String(b.name));
  });
}

test('MSH Arc Reactor consensus audit', async () => {
  const replays = await loadSet('msh');
  const occurrences = [];
  for (const replay of replays) {
    for (const pick of replay.picks || []) {
      const ranked = rankedCandidates(pick);
      const index = ranked.findIndex((card) => card.name === 'Arc Reactor');
      if (index < 0) continue;
      const arc = ranked[index];
      occurrences.push({
        draftId: replay.draft_id,
        pack: pick.pack_number,
        pick: pick.pick_number,
        rank: index + 1,
        support: Number(arc.model_probability || 0),
        historical: pick.historical_pick_id === arc.id,
        pool: pick.pool || {},
        topFive: ranked.slice(0, 5).map((card, i) => ({ rank: i + 1, name: card.name, support: Number(card.model_probability || 0) })),
      });
    }
  }

  const topTwo = occurrences.filter((item) => item.rank <= 2);
  const firstPicks = occurrences.filter((item) => item.pack === 1 && item.pick === 1);
  console.log('ARC_REACTOR_AUDIT ' + JSON.stringify({
    replaySeats: replays.length,
    occurrences: occurrences.length,
    topTwoCount: topTwo.length,
    firstPickCount: firstPicks.length,
    firstPickRanks: firstPicks.map((item) => ({ rank: item.rank, support: item.support, topFive: item.topFive })),
    topTwo,
  }));

  assert.equal(replays.length, 300);
  assert.ok(occurrences.length > 0);
});
