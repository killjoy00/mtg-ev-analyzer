const EPSILON = 1e-9;

export function rankCandidates(candidates) {
  return [...candidates].sort((a, b) => {
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
  const rank = ranked.findIndex((card) => card.id === selectedId) + 1;
  const bestProbability = Number(best.model_probability || 0);
  const selectedProbability = Number(selected.model_probability || 0);
  const gap = Math.max(0, bestProbability - selectedProbability);
  const score = bestProbability > EPSILON
    ? Math.round(Math.max(0, Math.min(1, selectedProbability / bestProbability)) * 100)
    : 100;

  let verdict;
  let verdictClass;
  if (rank === 1 || gap <= EPSILON) {
    verdict = 'Nailed it';
    verdictClass = 'consensus';
  } else if (gap <= 0.08) {
    verdict = 'Close call';
    verdictClass = 'close';
  } else if (gap <= 0.18) {
    verdict = 'Defensible';
    verdictClass = 'reasonable';
  } else {
    verdict = 'Worth a second look';
    verdictClass = 'miss';
  }

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
    verdict,
    verdictClass,
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

export function summarizeResults(results) {
  if (!results.length) {
    return {
      total: 0,
      historicalAgreement: 0,
      consensusAgreement: 0,
      topThreeAgreement: 0,
      averageGap: 0,
      score: 0,
      grade: 'F',
      gradeLabel: 'Run it back',
      biggestMisses: [],
    };
  }

  const pct = (count) => (count / results.length) * 100;
  const historicalAgreement = pct(results.filter((result) => result.historicalMatch).length);
  const consensusAgreement = pct(results.filter((result) => result.consensusMatch).length);
  const topThreeAgreement = pct(results.filter((result) => result.topThree).length);
  const averageGap = results.reduce((sum, result) => sum + result.gap, 0) / results.length;
  const score = Math.round(results.reduce((sum, result) => sum + Number(result.score || 0), 0) / results.length);
  const gradeInfo = scoreGrade(score);
  const biggestMisses = [...results]
    .filter((result) => result.gap > EPSILON)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 5);

  return {
    total: results.length,
    historicalAgreement,
    consensusAgreement,
    topThreeAgreement,
    averageGap,
    score,
    grade: gradeInfo.grade,
    gradeLabel: gradeInfo.label,
    biggestMisses,
  };
}
