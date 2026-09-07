import { conditionCandidatesForPath, poolsEqual } from './path-model.mjs';

const EPSILON = 1e-9;
const SUPPORT_EXPONENT = 0.75;
export const GAME_TIME_ZONE = 'America/New_York';

export function gameDateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: GAME_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function hashText(value) {
  let hash = 2166136261;
  for (let i = 0; i < String(value).length; i += 1) {
    hash ^= String(value).charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function dateOrdinal(dateKey) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

export function challengeIndex(dateKey, setId, mode, replayCount) {
  const count = Math.max(0, Number(replayCount) || 0);
  if (!count) return 0;
  if (count === 1) return 0;
  const base = hashText(`${setId}|${mode}|pack1-daily-base-v2`) % count;
  const step = 1 + (hashText(`${setId}|${mode}|pack1-daily-step-v2`) % (count - 1));
  return (base + (dateOrdinal(dateKey) * step)) % count;
}

export function rankCandidates(candidates) {
  return [...(candidates || [])].sort((a, b) => {
    const delta = Number(b.model_probability || 0) - Number(a.model_probability || 0);
    if (Math.abs(delta) > EPSILON) return delta;
    return String(a.name).localeCompare(String(b.name));
  });
}

function supportScore(selectedProbability, targetProbability) {
  const selected = Math.max(0, Number(selectedProbability) || 0);
  const target = Math.max(0, Number(targetProbability) || 0);
  if (target <= EPSILON) return 1;
  const ratio = Math.max(0, Math.min(1, selected / target));
  return ratio ** SUPPORT_EXPONENT;
}

export function fullPackDecisionWeight(candidateCount) {
  const count = Math.max(1, Number(candidateCount) || 1);
  return Math.log2(count);
}

export function scoreGrade(score) {
  const value = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  if (value >= 95) return { grade: 'A+', label: 'Near consensus' };
  if (value >= 90) return { grade: 'A', label: 'Excellent' };
  if (value >= 85) return { grade: 'A-', label: 'Very close' };
  if (value >= 80) return { grade: 'B+', label: 'Strong' };
  if (value >= 75) return { grade: 'B', label: 'Good' };
  if (value >= 70) return { grade: 'B-', label: 'Reasonable' };
  if (value >= 65) return { grade: 'C+', label: 'Mixed' };
  if (value >= 60) return { grade: 'C', label: 'Off consensus' };
  if (value >= 50) return { grade: 'D', label: 'Big disagreement' };
  return { grade: 'F', label: 'Far off consensus' };
}

export function gradePick(candidates, selectedId, historicalId) {
  const ranked = rankCandidates(candidates);
  const selected = ranked.find((card) => card.id === selectedId);
  if (!selected) throw new Error(`Selected card ${selectedId} is not in the pack.`);
  const best = ranked[0];
  if (!best) throw new Error('Pack has no candidates.');
  const rank = ranked.findIndex((card) => card.id === selectedId) + 1;
  const bestProbability = Number(best.model_probability || 0);
  const selectedProbability = Number(selected.model_probability || 0);
  const gap = Math.max(0, bestProbability - selectedProbability);
  const score = Math.round(supportScore(selectedProbability, bestProbability) * 100);
  const candidateCount = ranked.length;
  const decisionWeight = fullPackDecisionWeight(candidateCount);
  return {
    selectedId,
    historicalId,
    bestId: best.id,
    selectedName: selected.name,
    bestName: best.name,
    selectedProbability,
    bestProbability,
    gap,
    rank,
    score,
    candidateCount,
    decisionWeight,
    historicalMatch: selectedId === historicalId,
    consensusMatch: selectedId === best.id,
    topThree: rank <= 3,
  };
}

export function gradeTopThree(candidates, selectedIds, historicalId) {
  if (!Array.isArray(selectedIds) || selectedIds.length !== 3 || new Set(selectedIds).size !== 3) {
    throw new Error('Choose three different cards before grading the pack.');
  }
  const ranked = rankCandidates(candidates);
  const byId = new Map(ranked.map((card) => [card.id, card]));
  const selected = selectedIds.map((id) => {
    const card = byId.get(id);
    if (!card) throw new Error(`Selected card ${id} is not in the pack.`);
    return card;
  });
  const consensusTop = ranked.slice(0, 3);
  const consensusIds = consensusTop.map((card) => card.id);
  const overlap = selectedIds.filter((id) => consensusIds.includes(id)).length;
  const exactPositions = selectedIds.filter((id, index) => id === consensusIds[index]).length;
  const historicalPosition = selectedIds.indexOf(historicalId);

  const setWeights = [40, 35, 25];
  const selectedBySupport = rankCandidates(selected);
  const setSupport = selectedBySupport.reduce((total, card, index) => {
    const target = consensusTop[index];
    return total + setWeights[index] * supportScore(card.model_probability, target?.model_probability);
  }, 0);

  const orderWeights = [50, 30, 20];
  const orderSupport = selected.reduce((total, card, index) => {
    const target = consensusTop[index];
    return total + orderWeights[index] * supportScore(card.model_probability, target?.model_probability);
  }, 0);

  const score = Math.max(0, Math.min(100, Math.round((setSupport * 0.70) + (orderSupport * 0.30))));
  return {
    selected,
    selectedIds: [...selectedIds],
    consensusTop,
    consensusIds,
    overlap,
    exactPositions,
    historicalRank: historicalPosition >= 0 ? historicalPosition + 1 : null,
    setSupport: Math.round(setSupport),
    orderSupport: Math.round(orderSupport),
    score,
    ...scoreGrade(score),
  };
}

export function firstPackPicks(replay) {
  const picks = replay?.picks || [];
  if (!picks.length) return [];
  const packNumbers = picks.map((pick) => Number(pick.pack_number)).filter(Number.isFinite);
  const firstPackNumber = packNumbers.length ? Math.min(...packNumbers) : picks[0].pack_number;
  return picks
    .filter((pick) => Number(pick.pack_number) === Number(firstPackNumber))
    .sort((a, b) => Number(a.pick_number) - Number(b.pick_number));
}

export function gradeFullPack(replay, selectedIds, pathModel = null) {
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

export function featuredSetId(catalog) {
  const sets = [...(catalog?.sets || [])].filter((set) => set?.id);
  if (!sets.length) return null;
  sets.sort((a, b) => String(b.data_date || '').localeCompare(String(a.data_date || '')) || String(a.id).localeCompare(String(b.id)));
  return sets[0].id;
}

export function periodStart(period, date = new Date()) {
  if (period === 'all') return '1970-01-01';
  const key = gameDateKey(date);
  const value = new Date(`${key}T12:00:00Z`);
  const y = value.getUTCFullYear();
  const m = value.getUTCMonth();
  const d = value.getUTCDate();
  if (period === 'monthly') return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  if (period === 'weekly') {
    const copy = new Date(Date.UTC(y, m, d));
    const day = copy.getUTCDay();
    const back = day === 0 ? 6 : day - 1;
    copy.setUTCDate(copy.getUTCDate() - back);
    return copy.toISOString().slice(0, 10);
  }
  return key;
}
