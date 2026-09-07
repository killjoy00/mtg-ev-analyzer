const EPSILON = 1e-9;

export function rankCandidates(candidates) {
  return [...candidates].sort((a, b) => {
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
  // The model probabilities are comparative and uncalibrated. A square-root
  // curve keeps clear misses costly without pretending a plausible alternative
  // is proportionally "half as good" just because it has half the model support.
  return Math.sqrt(ratio);
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
  const rank = ranked.findIndex((card) => card.id === selectedId) + 1;
  const bestProbability = Number(best.model_probability || 0);
  const selectedProbability = Number(selected.model_probability || 0);
  const gap = Math.max(0, bestProbability - selectedProbability);
  const score = Math.round(supportScore(selectedProbability, bestProbability) * 100);

  let verdict;
  let verdictClass;
  if (rank === 1 || gap <= EPSILON) {
    verdict = 'Consensus pick';
    verdictClass = 'consensus';
  } else if (score >= 90) {
    verdict = 'Close call';
    verdictClass = 'close';
  } else if (score >= 75) {
    verdict = 'In the mix';
    verdictClass = 'reasonable';
  } else if (score >= 55) {
    verdict = 'Off consensus';
    verdictClass = 'reasonable';
  } else {
    verdict = 'Big disagreement';
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

  // Slot weights reflect how important the user's #1/#2/#3 opinions are, while
  // each slot receives continuous credit based on model support. This avoids the
  // old cliff where a near-tied #4 received zero credit simply for missing top 3.
  const slotWeights = [50, 30, 20];
  const score = Math.max(0, Math.min(100, Math.round(selected.reduce((total, card, index) => {
    const target = consensusTop[index];
    return total + slotWeights[index] * supportScore(card.model_probability, target?.model_probability);
  }, 0))));

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
      gradeLabel: 'Far off consensus',
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
