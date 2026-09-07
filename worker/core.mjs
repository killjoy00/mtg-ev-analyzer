const EPSILON = 1e-9;

export function hashText(value) {
  let hash = 2166136261;
  for (let i = 0; i < String(value).length; i += 1) {
    hash ^= String(value).charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function challengeIndex(dateKey, setId, mode, replayCount) {
  const count = Math.max(0, Number(replayCount) || 0);
  if (!count) return 0;
  return hashText(`${dateKey}|${setId}|${mode}|pack1-daily-v1`) % count;
}

export function rankCandidates(candidates) {
  return [...(candidates || [])].sort((a, b) => {
    const delta = Number(b.model_probability || 0) - Number(a.model_probability || 0);
    if (Math.abs(delta) > EPSILON) return delta;
    return String(a.name).localeCompare(String(b.name));
  });
}

export function scoreGrade(score) {
  const value = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  if (value >= 95) return { grade: 'A+', label: 'Locked in' };
  if (value >= 90) return { grade: 'A', label: 'Excellent' };
  if (value >= 85) return { grade: 'A-', label: 'Sharp' };
  if (value >= 80) return { grade: 'B+', label: 'Strong' };
  if (value >= 75) return { grade: 'B', label: 'Good' };
  if (value >= 70) return { grade: 'B-', label: 'Solid' };
  if (value >= 65) return { grade: 'C+', label: 'Competitive' };
  if (value >= 60) return { grade: 'C', label: 'Mixed' };
  if (value >= 50) return { grade: 'D', label: 'Needs a review' };
  return { grade: 'F', label: 'Run it back' };
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
  const score = bestProbability > EPSILON
    ? Math.round(Math.max(0, Math.min(1, selectedProbability / bestProbability)) * 100)
    : 100;
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
  const membershipWeights = [35, 25, 15];
  const orderBonuses = [12, 8, 5];
  let score = 0;
  selectedIds.forEach((id, userIndex) => {
    const consensusIndex = consensusIds.indexOf(id);
    if (consensusIndex < 0) return;
    score += membershipWeights[consensusIndex];
    if (userIndex === consensusIndex) score += orderBonuses[consensusIndex];
  });
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    selected,
    selectedIds: [...selectedIds],
    consensusTop,
    consensusIds,
    overlap,
    exactPositions,
    historicalRank: historicalPosition >= 0 ? historicalPosition + 1 : null,
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

export function gradeFullPack(replay, selectedIds) {
  const picks = firstPackPicks(replay);
  if (!Array.isArray(selectedIds) || selectedIds.length !== picks.length) {
    throw new Error(`Full Pack requires ${picks.length} selections.`);
  }
  const results = picks.map((pick, index) => gradePick(pick.candidates, selectedIds[index], pick.historical_pick_id));
  const score = results.length
    ? Math.round(results.reduce((sum, result) => sum + result.score, 0) / results.length)
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
  const value = new Date(date);
  const y = value.getUTCFullYear();
  const m = value.getUTCMonth();
  const d = value.getUTCDate();
  if (period === 'all') return '1970-01-01';
  if (period === 'monthly') return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  if (period === 'weekly') {
    const copy = new Date(Date.UTC(y, m, d));
    const day = copy.getUTCDay();
    const back = day === 0 ? 6 : day - 1;
    copy.setUTCDate(copy.getUTCDate() - back);
    return copy.toISOString().slice(0, 10);
  }
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
}
