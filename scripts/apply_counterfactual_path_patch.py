#!/usr/bin/env python3
from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one anchor, found {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


# Browser: load the compact path model and condition each Full Pack decision on
# the player's actual prior selections rather than the replay drafter's path.
replace_once(
    'app.js',
    "import { tcgplayerUrl } from './tcgplayer.mjs';\n",
    "import { tcgplayerUrl } from './tcgplayer.mjs';\nimport { conditionCandidatesForPath, pathHasDiverged } from './path-model.mjs';\n",
)
replace_once(
    'app.js',
    "  replay: null,\n  mode: null,",
    "  replay: null,\n  pathModel: null,\n  mode: null,",
)
replace_once(
    'app.js',
    "  state.replay = null;\n  state.mode = null;",
    "  state.replay = null;\n  state.pathModel = null;\n  state.mode = null;",
)
replace_once(
    'app.js',
    "async function loadSet(setEntry) {\n  const path = setEntry.manifest_path || setEntry.data_path;\n  if (!path) throw new Error(`${setEntry.name} has no data path.`);\n  return loadJson(path, setEntry.name);\n}\n",
    "async function loadSet(setEntry) {\n  const path = setEntry.manifest_path || setEntry.data_path;\n  if (!path) throw new Error(`${setEntry.name} has no data path.`);\n  return loadJson(path, setEntry.name);\n}\n\nconst pathModelCache = new Map();\n\nasync function loadPathModel(setEntry) {\n  const setId = String(setEntry?.id || '').toLowerCase();\n  if (!setId) return null;\n  if (pathModelCache.has(setId)) return pathModelCache.get(setId);\n  const path = setEntry.path_model_path || `./data/${setId}/path-model.json`;\n  try {\n    const model = await loadJson(path, `${setEntry.name} path model`);\n    if (model?.model_version !== 'strong-player-counterfactual-path-v3') {\n      throw new Error(`Unsupported path model for ${setEntry.name}.`);\n    }\n    pathModelCache.set(setId, model);\n    return model;\n  } catch (error) {\n    console.warn('Counterfactual path model unavailable; using historical-path support.', error);\n    pathModelCache.set(setId, null);\n    return null;\n  }\n}\n",
)
replace_once(
    'app.js',
    "    const loaded = daily ? await loadChallengeReplay(entry, date, mode) : await loadRandomReplay(entry);\n    const packPicks = firstPackPicks(loaded.replay);",
    "    const [loaded, pathModel] = await Promise.all([\n      daily ? loadChallengeReplay(entry, date, mode) : loadRandomReplay(entry),\n      mode === 'full' ? loadPathModel(entry) : Promise.resolve(null),\n    ]);\n    const packPicks = firstPackPicks(loaded.replay);",
)
replace_once(
    'app.js',
    "    state.replay = loaded.replay;\n    state.mode = mode;",
    "    state.replay = loaded.replay;\n    state.pathModel = pathModel;\n    state.mode = mode;",
)
replace_once(
    'app.js',
    "function currentPick() {\n  return state.packPicks[state.pickIndex];\n}\n",
    "function currentPick() {\n  return state.packPicks[state.pickIndex];\n}\n\nfunction addPoolCard(pool, name) {\n  if (!name) return pool;\n  pool[name] = (Number(pool[name]) || 0) + 1;\n  return pool;\n}\n\nfunction userPoolBeforePick(index = state.pickIndex) {\n  // Some stored seats begin after P1P1. Unseen earlier cards are inherited from\n  // the replay's starting pool; every decision the player actually makes then\n  // replaces the historical drafter's choice in the counterfactual path.\n  const pool = { ...(state.packPicks[0]?.pool || {}) };\n  for (const result of state.results.slice(0, Math.max(0, index))) addPoolCard(pool, result.selectedName);\n  return pool;\n}\n\nfunction conditionedPick(pick = currentPick()) {\n  if (!pick) return pick;\n  const userPool = userPoolBeforePick();\n  const candidates = conditionCandidatesForPath(pick.candidates, {\n    pickNumber: Number(pick.pick_number),\n    historicalPool: pick.pool || {},\n    userPool,\n    pathModel: state.pathModel,\n  });\n  return {\n    ...pick,\n    candidates,\n    user_pool: userPool,\n    path_diverged: pathHasDiverged(pick.pool || {}, userPool),\n  };\n}\n",
)
replace_once(
    'app.js',
    "        <div><span>Consensus</span><strong>${esc(result.bestName)}</strong><a class=\"market-link\" href=\"${esc(tcgplayerUrl(result.bestName))}\" target=\"_blank\" rel=\"sponsored noopener\" data-tcgplayer-link=\"1\" data-tcgplayer-card=\"${esc(result.bestName)}\" data-tcgplayer-set=\"${esc(state.selectedSetId)}\" data-tcgplayer-surface=\"full_pick_consensus\">TCGplayer</a></div>\n        <div><span>Consensus rank</span><strong>#${esc(result.rank)}</strong></div>\n        <div><span>Consensus gap</span><strong>${result.gap ? `${(result.gap * 100).toFixed(1)} pts` : '—'}</strong></div>",
    "        <div><span>${result.pathDiverged ? 'Your-path leader' : 'Strong-player leader'}</span><strong>${esc(result.bestName)}</strong><a class=\"market-link\" href=\"${esc(tcgplayerUrl(result.bestName))}\" target=\"_blank\" rel=\"sponsored noopener\" data-tcgplayer-link=\"1\" data-tcgplayer-card=\"${esc(result.bestName)}\" data-tcgplayer-set=\"${esc(state.selectedSetId)}\" data-tcgplayer-surface=\"full_pick_consensus\">TCGplayer</a></div>\n        <div><span>Your support</span><strong>${pct(result.selectedProbability, 1)}</strong></div>\n        <div><span>Support gap</span><strong>${result.gap ? `${(result.gap * 100).toFixed(1)} pts` : '—'}</strong></div>",
)
replace_once(
    'app.js',
    "function renderFullPack() {\n  const pick = currentPick();",
    "function renderFullPack() {\n  const pick = conditionedPick();",
)
replace_once(
    'app.js',
    "      <aside class=\"replay-sidebar\"><section class=\"sidebar-card\"><p class=\"eyebrow\">Replay pool</p><h3>Cards entering this pick</h3>${renderPool(pick.pool)}</section><section class=\"sidebar-card quiet\"><h3>Why the pool is fixed</h3><p>This is a replay, not a draft simulator. Later decisions and consensus stay tied to the original seat, even when your picks differ.</p></section></aside>",
    "      <aside class=\"replay-sidebar\"><section class=\"sidebar-card\"><p class=\"eyebrow\">Your path</p><h3>Your pool so far</h3>${renderPool(pick.user_pool)}</section><section class=\"sidebar-card quiet\"><h3>What stays fixed</h3><p>The available cards still come from the historical replay. Your later-pick support now reconditions on the cards you actually chose; Pack One does not simulate how seven other drafters might change what wheels.</p></section></aside>",
)
replace_once(
    'app.js',
    "  const pick = currentPick();\n  const grade = gradePick(pick.candidates, state.selectedCardId, pick.historical_pick_id);\n  state.results.push({ ...grade, pack_number: 1, pick_number: state.pickIndex + 1 });",
    "  const pick = conditionedPick();\n  const grade = gradePick(pick.candidates, state.selectedCardId, pick.historical_pick_id);\n  state.results.push({ ...grade, pack_number: 1, pick_number: state.pickIndex + 1, pathDiverged: Boolean(pick.path_diverged) });",
)
replace_once(
    'app.js',
    "  return `Generated offline from ${state.setData.source?.provider || '17Lands'} public draft data. ${Number(cohort.training_drafts || 0).toLocaleString()} high-win-rate drafts train the consensus model with ${model.holdout || 'draft-level holdout'}. Pick scores compare your card's model support with the top-supported card in that pack. Probabilities are comparative, not calibrated odds that a choice is objectively correct.`;",
    "  return `Generated offline from ${state.setData.source?.provider || '17Lands'} public draft data. ${Number(cohort.training_drafts || 0).toLocaleString()} high-win-rate drafts train the consensus model with ${model.holdout || 'draft-level holdout'}. In Full Pack, later support is reconditioned on the cards you actually selected using separate strong-player co-pick statistics that exclude the replay seats. Available cards still follow the historical replay, so this is path-aware grading rather than a simulation of the other seven drafters.`;",
)
replace_once(
    'app.js',
    "      <p class=\"lede result-lede\">You made ${summary.total} decisions. Here's where your instincts lined up with the strong-player consensus.</p>",
    "      <p class=\"lede result-lede\">You made ${summary.total} decisions. Here's where your picks lined up with the strong-player model along the path you actually drafted.</p>",
)
replace_once(
    'app.js',
    "<div class=\"summary-stat\"><strong>${summary.consensusAgreement.toFixed(0)}%</strong><span>Consensus picks</span></div>\n        <div class=\"summary-stat\"><strong>${summary.topThreeAgreement.toFixed(0)}%</strong><span>Top-3 picks</span></div>",
    "<div class=\"summary-stat\"><strong>${summary.consensusAgreement.toFixed(0)}%</strong><span>Path-leader picks</span></div>\n        <div class=\"summary-stat\"><strong>${summary.topThreeAgreement.toFixed(0)}%</strong><span>Path top-3 picks</span></div>",
)

# Worker: apply the exact same sequential conditioning before validating ranked
# Full Pack scores.
replace_once(
    'worker/core.mjs',
    "const EPSILON = 1e-9;\n",
    "import { conditionCandidatesForPath, poolsEqual } from './path-model.mjs';\n\nconst EPSILON = 1e-9;\n",
)
old_grade_full = """export function gradeFullPack(replay, selectedIds) {
  const picks = firstPackPicks(replay);
  if (!Array.isArray(selectedIds) || selectedIds.length !== picks.length) {
    throw new Error(`Full Pack requires ${picks.length} selections.`);
  }
  const results = picks.map((pick, index) => gradePick(pick.candidates, selectedIds[index], pick.historical_pick_id));
  const totalWeight = results.reduce((sum, result) => sum + result.decisionWeight, 0);
  const score = results.length
    ? Math.round(totalWeight > EPSILON
      ? results.reduce((sum, result) => sum + result.score * result.decisionWeight, 0) / totalWeight
      : results.reduce((sum, result) => sum + result.score, 0) / results.length)
    : 0;
  const consensusAgreement = results.length ? (results.filter((r) => r.consensusMatch).length / results.length) * 100 : 0;
  const topThreeAgreement = results.length ? (results.filter((r) => r.topThree).length / results.length) * 100 : 0;
  return { score, ...scoreGrade(score), consensusAgreement, topThreeAgreement, results };
}
"""
new_grade_full = """export function gradeFullPack(replay, selectedIds, pathModel = null) {
  const picks = firstPackPicks(replay);
  if (!Array.isArray(selectedIds) || selectedIds.length !== picks.length) {
    throw new Error(`Full Pack requires ${picks.length} selections.`);
  }

  const userPool = { ...(picks[0]?.pool || {}) };
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

  const totalWeight = results.reduce((sum, result) => sum + result.decisionWeight, 0);
  const score = results.length
    ? Math.round(totalWeight > EPSILON
      ? results.reduce((sum, result) => sum + result.score * result.decisionWeight, 0) / totalWeight
      : results.reduce((sum, result) => sum + result.score, 0) / results.length)
    : 0;
  const consensusAgreement = results.length ? (results.filter((r) => r.consensusMatch).length / results.length) * 100 : 0;
  const topThreeAgreement = results.length ? (results.filter((r) => r.topThree).length / results.length) * 100 : 0;
  return { score, ...scoreGrade(score), consensusAgreement, topThreeAgreement, results };
}
"""
replace_once('worker/core.mjs', old_grade_full, new_grade_full)

replace_once(
    'worker/index.js',
    "  const setData = await staticJson(setEntry.manifest_path || setEntry.data_path);\n  if (setData.shards?.length) {",
    "  const setData = await staticJson(setEntry.manifest_path || setEntry.data_path);\n  const pathModel = mode === 'full'\n    ? await staticJson(setEntry.path_model_path || `data/${setId}/path-model.json`)\n    : null;\n  if (setData.shards?.length) {",
)
replace_once(
    'worker/index.js',
    "        return { replay: shard.replays?.[index], featured: featuredSetId(catalog) === setId };",
    "        return { replay: shard.replays?.[index], featured: featuredSetId(catalog) === setId, pathModel };",
)
replace_once(
    'worker/index.js',
    "    featured: featuredSetId(catalog) === setId,\n  };",
    "    featured: featuredSetId(catalog) === setId,\n    pathModel,\n  };",
)
replace_once(
    'worker/index.js',
    "    result = gradeFullPack(loaded.replay, selections);",
    "    result = gradeFullPack(loaded.replay, selections, loaded.pathModel);",
)

# Syntax guardrails include the new shared modules.
replace_once(
    'package.json',
    "node --check app.js && node --check bootstrap.mjs",
    "node --check app.js && node --check path-model.mjs && node --check worker/path-model.mjs && node --check bootstrap.mjs",
)

print('Applied counterfactual path patch.')
