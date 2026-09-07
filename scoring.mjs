const EPSILON = 1e-9;

export function rankCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    const delta = Number(b.model_probability || 0) - Number(a.model_probability || 0);
    if (Math.abs(delta) > EPSILON) return delta;
    return String(a.name).localeCompare(String(b.name));
  });
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

  return {
    selected,
    selectedIds: [...selectedIds],
    consensusTop,
    consensusIds,
    overlap,
    exactPositions,
    historicalRank: historicalPosition >= 0 ? historicalPosition + 1 : null,
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
      biggestMisses: [],
    };
  }

  const pct = (count) => (count / results.length) * 100;
  const historicalAgreement = pct(results.filter((result) => result.historicalMatch).length);
  const consensusAgreement = pct(results.filter((result) => result.consensusMatch).length);
  const topThreeAgreement = pct(results.filter((result) => result.topThree).length);
  const averageGap = results.reduce((sum, result) => sum + result.gap, 0) / results.length;
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
    biggestMisses,
  };
}
