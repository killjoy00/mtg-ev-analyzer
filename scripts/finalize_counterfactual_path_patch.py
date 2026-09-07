#!/usr/bin/env python3
from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one anchor, found {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'app.js',
    "<p>Make every pick in Pack One and get a 100-point finish.</p>",
    "<p>Make every pick in Pack One. Later choices adapt to the cards you actually took.</p>",
)
replace_once(
    'app.js',
    "<span>Consensus is a model of experienced, high-win-rate 17Lands drafters. It compares how much support each card gets in the current pack and historical pool. The percentages are relative model support—not win rates, card grades, or objective truth. Your score measures how closely your choices track that model; only Daily Challenge scores rank.</span>",
    "<span>Consensus is a model of experienced, high-win-rate 17Lands drafters. Opening-pack support starts from the current pack; in Full Pack, later support also follows the cards you actually chose. Your score measures how closely your choices track that model; only Daily Challenge scores rank.</span>",
)
replace_once(
    'app.js',
    "  if (!entries.length) return '<p class=\"empty-note\">Opening pick. The replay pool is empty.</p>';",
    "  if (!entries.length) return '<p class=\"empty-note\">No cards yet.</p>';",
)
replace_once(
    'app.js',
    "      <div class=\"feedback-grid\">\n        <div><span>You took</span><strong>${esc(result.selectedName)}</strong></div>\n        <div><span>${result.pathDiverged ? 'Your-path leader' : 'Strong-player leader'}</span><strong>${esc(result.bestName)}</strong><a class=\"market-link\" href=\"${esc(tcgplayerUrl(result.bestName))}\" target=\"_blank\" rel=\"sponsored noopener\" data-tcgplayer-link=\"1\" data-tcgplayer-card=\"${esc(result.bestName)}\" data-tcgplayer-set=\"${esc(state.selectedSetId)}\" data-tcgplayer-surface=\"full_pick_consensus\">TCGplayer</a></div>\n        <div><span>Your support</span><strong>${pct(result.selectedProbability, 1)}</strong></div>\n        <div><span>Support gap</span><strong>${result.gap ? `${(result.gap * 100).toFixed(1)} pts` : '—'}</strong></div>\n        <div><span>Real drafter</span><strong>${esc(historical?.name || 'Unknown')}${result.historicalMatch ? ' ✓' : ''}</strong></div>\n      </div>",
    "      <div class=\"feedback-grid\">\n        <div><span>You took</span><strong>${esc(result.selectedName)}</strong></div>\n        <div><span>${result.pathDiverged ? 'Your-path leader' : 'Strong-player leader'}</span><strong>${esc(result.bestName)}</strong><a class=\"market-link\" href=\"${esc(tcgplayerUrl(result.bestName))}\" target=\"_blank\" rel=\"sponsored noopener\" data-tcgplayer-link=\"1\" data-tcgplayer-card=\"${esc(result.bestName)}\" data-tcgplayer-set=\"${esc(state.selectedSetId)}\" data-tcgplayer-surface=\"full_pick_consensus\">TCGplayer</a></div>\n        <div><span>Your support</span><strong>${pct(result.selectedProbability, 1)}</strong></div>\n        <div><span>Support gap</span><strong>${result.gap ? `${(result.gap * 100).toFixed(1)} pts` : '—'}</strong></div>\n        <div><span>Real drafter</span><strong>${esc(historical?.name || 'Unknown')}${result.historicalMatch ? ' ✓' : ''}</strong></div>\n      </div>\n      ${result.replayBoundWheel ? '<div class=\"challenge-status practice\"><strong>Replay-bound wheel.</strong> Your earlier choices could have changed what came back around, so this pick gets feedback but does not count toward the final score.</div>' : ''}",
)
replace_once(
    'app.js',
    "  const pick = conditionedPick();\n  const grade = gradePick(pick.candidates, state.selectedCardId, pick.historical_pick_id);\n  state.results.push({ ...grade, pack_number: 1, pick_number: state.pickIndex + 1, pathDiverged: Boolean(pick.path_diverged) });",
    "  const pick = conditionedPick();\n  const grade = gradePick(pick.candidates, state.selectedCardId, pick.historical_pick_id);\n  const actualPickNumber = Number(pick.pick_number) || state.pickIndex + 1;\n  const firstPassDiverged = state.results.some((result) => Number(result.pick_number) <= 8 && !result.historicalMatch);\n  const replayBoundWheel = actualPickNumber >= 9 && firstPassDiverged;\n  state.results.push({\n    ...grade,\n    decisionWeight: replayBoundWheel ? 0 : grade.decisionWeight,\n    pack_number: 1,\n    pick_number: actualPickNumber,\n    pathDiverged: Boolean(pick.path_diverged),\n    replayBoundWheel,\n  });",
)
replace_once(
    'app.js',
    "  return `Generated offline from ${state.setData.source?.provider || '17Lands'} public draft data. ${Number(cohort.training_drafts || 0).toLocaleString()} high-win-rate drafts train the consensus model with ${model.holdout || 'draft-level holdout'}. In Full Pack, later support is reconditioned on the cards you actually selected using separate strong-player co-pick statistics that exclude the replay seats. Available cards still follow the historical replay, so this is path-aware grading rather than a simulation of the other seven drafters.`;",
    "  return `Generated offline from ${state.setData.source?.provider || '17Lands'} public draft data. ${Number(cohort.training_drafts || 0).toLocaleString()} high-win-rate drafts train the consensus model with ${model.holdout || 'draft-level holdout'}. In Full Pack, later support is reconditioned on the cards you actually selected using separate strong-player co-pick statistics that hold out the replay seats. Picks 2–8 keep the historical candidate packs because your own earlier choices cannot change which unopened packs reach you. Once packs wheel, a divergent first pass could change what survived, so replay-bound wheel decisions receive feedback but no final-score weight.`;",
)
replace_once(
    'app.js',
    "      <p class=\"lede result-lede\">You made ${summary.total} decisions. Here's where your picks lined up with the strong-player model along the path you actually drafted.</p>",
    "      <p class=\"lede result-lede\">You made ${summary.total} decisions. ${summary.scoredDecisions < summary.total ? `${summary.scoredDecisions} had reliable replay context and counted toward the final score. ` : ''}Here's where your picks lined up with the strong-player model along the path you actually drafted.</p>",
)

replace_once(
    'product.mjs',
    "note.textContent = 'Consensus is a model of experienced, high-win-rate 17Lands drafters. It compares how much support each card gets in the current pack and historical pool. Your score measures how closely your choices track that model; only Daily Challenge scores rank.';",
    "note.textContent = 'Consensus is a model of experienced, high-win-rate 17Lands drafters. Opening-pack support starts from the current pack; in Full Pack, later support also follows the cards you actually chose. Only Daily Challenge scores rank.';",
)

old_worker = """  const userPool = { ...(picks[0]?.pool || {}) };
  const results = [];
  for (let index = 0; index < picks.length; index += 1) {
    const pick = picks[index];
    const candidates = conditionCandidatesForPath(pick.candidates, {
      pickNumber: Number(pick.pick_number),
      historicalPool: pick.pool || {},
      userPool,
      pathModel,
    });
    const result = gradePick(candidates, selectedIds[index], pick.historical_pick_id);
    results.push({ ...result, pathDiverged: !poolsEqual(pick.pool || {}, userPool) });
    const selected = candidates.find((card) => card.id === selectedIds[index]);
    if (selected?.name) userPool[selected.name] = (Number(userPool[selected.name]) || 0) + 1;
  }
"""
new_worker = """  const userPool = { ...(picks[0]?.pool || {}) };
  const results = [];
  let firstPassDiverged = false;
  for (let index = 0; index < picks.length; index += 1) {
    const pick = picks[index];
    const pickNumber = Number(pick.pick_number) || index + 1;
    const candidates = conditionCandidatesForPath(pick.candidates, {
      pickNumber,
      historicalPool: pick.pool || {},
      userPool,
      pathModel,
    });
    const result = gradePick(candidates, selectedIds[index], pick.historical_pick_id);
    const replayBoundWheel = pickNumber >= 9 && firstPassDiverged;
    results.push({
      ...result,
      decisionWeight: replayBoundWheel ? 0 : result.decisionWeight,
      pathDiverged: !poolsEqual(pick.pool || {}, userPool),
      replayBoundWheel,
      pick_number: pickNumber,
    });
    const selected = candidates.find((card) => card.id === selectedIds[index]);
    if (selected?.name) userPool[selected.name] = (Number(userPool[selected.name]) || 0) + 1;
    if (pickNumber <= 8 && selectedIds[index] !== pick.historical_pick_id) firstPassDiverged = true;
  }
"""
replace_once('worker/core.mjs', old_worker, new_worker)

replace_once(
    'worker/index.js',
    "if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'pack1-api', version: 3, date: gameDateKey(), timeZone: 'America/New_York' });",
    "if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, service: 'pack1-api', version: 4, scoring: 'counterfactual-path-v3', date: gameDateKey(), timeZone: 'America/New_York' });",
)

replace_once(
    'tests/e2e.mjs',
    "  await page.locator('[data-mode=\"full\"]').click();\n  for (let pick = 0; pick < 20; pick += 1) {",
    "  await page.locator('[data-mode=\"full\"]').click();\n  assert.match((await page.locator('.replay-sidebar').textContent()) || '', /Your pool so far/i);\n  assert.match((await page.locator('.replay-sidebar').textContent()) || '', /does not simulate|historical replay/i);\n  for (let pick = 0; pick < 20; pick += 1) {",
)

path_test = Path('tests/path-model.test.mjs')
text = path_test.read_text(encoding='utf-8')
anchor = "test('pool comparison is count-aware', () => {"
if text.count(anchor) != 1:
    raise SystemExit('path-model test anchor missing')
wheel_test = r'''test('divergent first-pass choices make historical wheel packs feedback-only', () => {
  const picks = [];
  for (let pickNumber = 1; pickNumber <= 9; pickNumber += 1) {
    if (pickNumber === 1) {
      picks.push({
        pack_number: 1,
        pick_number: 1,
        pool: {},
        historical_pick_id: 'red',
        candidates: [
          { id: 'red', name: 'Red Start', model_probability: 0.5 },
          { id: 'blue', name: 'Blue Start', model_probability: 0.5 },
        ],
      });
    } else {
      picks.push({
        pack_number: 1,
        pick_number: pickNumber,
        pool: { 'Red Start': 1 },
        historical_pick_id: `h${pickNumber}`,
        candidates: [
          { id: `h${pickNumber}`, name: `Historical ${pickNumber}`, model_probability: 0.7 },
          { id: `a${pickNumber}`, name: `Alternative ${pickNumber}`, model_probability: 0.3 },
        ],
      });
    }
  }
  const diverged = gradeFullPack({ picks }, ['blue', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9']);
  assert.equal(diverged.results[8].replayBoundWheel, true);
  assert.equal(diverged.results[8].decisionWeight, 0);

  const historical = gradeFullPack({ picks }, ['red', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9']);
  assert.equal(historical.results[8].replayBoundWheel, false);
  assert.ok(historical.results[8].decisionWeight > 0);
});

'''
path_test.write_text(text.replace(anchor, wheel_test + anchor, 1), encoding='utf-8')

print('Applied final counterfactual path polish.')
