import test from 'node:test';
import assert from 'node:assert/strict';
import { fullPackDecisionWeight, gradePick, gradeTopThree, rankCandidates, scoreGrade, summarizeResults } from '../scoring.mjs';
import { DRAFT_RUN_CORPUS_VERSION, gradeDraftRunPick } from '../draft-run.mjs';

const candidates = [
  { id: 'a', name: 'A', model_probability: 0.45 },
  { id: 'b', name: 'B', model_probability: 0.40 },
  { id: 'c', name: 'C', model_probability: 0.10 },
  { id: 'd', name: 'D', model_probability: 0.05 },
  { id: 'e', name: 'E', model_probability: 0.02 },
];

test('rankCandidates orders by modeled likelihood', () => {
  assert.deepEqual(rankCandidates(candidates).map((card) => card.id), ['a', 'b', 'c', 'd', 'e']);
});

test('scoreGrade describes consensus alignment rather than objective correctness', () => {
  assert.deepEqual(scoreGrade(96), { grade: 'A+', label: 'Near consensus' });
  assert.deepEqual(scoreGrade(82), { grade: 'B+', label: 'Strong' });
  assert.deepEqual(scoreGrade(48), { grade: 'F', label: 'Far off consensus' });
});

test('a strong alternative earns its share of the leading support', () => {
  // 0.40 of a 0.45 leader is 89% of the support, so 95 * 0.8889 = 84. The old
  // 0.75-power curve paid 92 for the same pick; docs/SCORING-AND-DIFFICULTY.md
  // calls that inflation and is why the linear ratio was settled on.
  const result = gradePick(candidates, 'b', 'a');
  assert.equal(result.rank, 2);
  assert.equal(result.consensusMatch, false);
  assert.equal(result.historicalMatch, false);
  assert.equal(result.score, 84);
  assert.ok(Math.abs(result.gap - 0.05) < 1e-9);
});

test('gradePick gives the consensus pick 100', () => {
  const result = gradePick(candidates, 'a', 'a');
  assert.equal(result.score, 100);
  assert.equal(result.verdict, 'Consensus pick');
});

test('gradePick makes a low-support alternative clearly costly', () => {
  // 0.05 against a 0.45 leader is 11% of the support: 95 * 0.1111 = 11. The old
  // curve paid 19 for a card with an ninth of the leader's support.
  const result = gradePick(candidates, 'd', 'a');
  assert.equal(result.score, 11);
  assert.equal(result.verdict, 'Big disagreement');
});

test('the trophy pick earns 100 even when the model prefers something else', () => {
  // The settled rule: matching the drafter is what is being scored. The model
  // leader is capped at 95 in that pack, so the two outcomes stay distinct.
  const tookSecond = gradePick(candidates, 'b', 'b');
  assert.equal(tookSecond.score, 100);
  assert.equal(tookSecond.historicalMatch, true);
  assert.equal(tookSecond.consensusMatch, false);
  const tookLeaderInstead = gradePick(candidates, 'a', 'b');
  assert.equal(tookLeaderInstead.score, 95);
  assert.equal(tookLeaderInstead.consensusMatch, true);
});

test('gradePick tracks historical agreement separately from consensus', () => {
  const result = gradePick(candidates, 'b', 'b');
  assert.equal(result.historicalMatch, true);
  assert.equal(result.consensusMatch, false);
});

test('forced Full Pack decisions have zero final-score weight', () => {
  assert.equal(fullPackDecisionWeight(1), 0);
  assert.equal(fullPackDecisionWeight(2), 1);
  assert.equal(fullPackDecisionWeight(4), 2);
  assert.equal(fullPackDecisionWeight(8), 3);
});

test('gradeTopThree gives 100 for an exact consensus ranking', () => {
  const result = gradeTopThree(candidates, ['a', 'b', 'c'], 'a');
  assert.equal(result.overlap, 3);
  assert.equal(result.exactPositions, 3);
  assert.equal(result.score, 100);
  assert.equal(result.grade, 'A+');
});

test('gradeTopThree prioritizes finding the right three over exact ordering', () => {
  const result = gradeTopThree(candidates, ['c', 'b', 'a'], 'a');
  assert.equal(result.overlap, 3);
  assert.equal(result.exactPositions, 1);
  assert.equal(result.historicalRank, 3);
  // Membership is still perfect, so set support is untouched at 100; only the
  // ordering term feels the linear ratio (was 90 under the 0.75 curve).
  assert.equal(result.setSupport, 100);
  assert.equal(result.score, 88);
  assert.deepEqual(result.consensusIds, ['a', 'b', 'c']);
});

test('gradeTopThree gives continuous credit to a near-miss outside the model top three', () => {
  const result = gradeTopThree(candidates, ['a', 'b', 'd'], 'a');
  assert.equal(result.overlap, 2);
  assert.equal(result.score, 88);
});

test('right three in reverse order beats a list that misses two consensus cards', () => {
  const reversed = gradeTopThree(candidates, ['c', 'b', 'a'], 'a');
  const missesTwo = gradeTopThree(candidates, ['a', 'd', 'e'], 'a');
  assert.ok(reversed.score > missesTwo.score);
  assert.equal(missesTwo.overlap, 1);
});

test('gradeTopThree rejects duplicate choices', () => {
  assert.throws(() => gradeTopThree(candidates, ['a', 'a', 'b'], 'a'));
});

test('summarizeResults weights meaningful Full Pack decisions instead of forced picks', () => {
  const openPack = candidates;
  const forced = [{ id: 'z', name: 'Z', model_probability: 1 }];
  const results = [
    { ...gradePick(openPack, 'a', 'a'), pack_number: 1, pick_number: 1 },
    { ...gradePick(openPack, 'd', 'b'), pack_number: 1, pick_number: 2 },
    { ...gradePick(forced, 'z', 'z'), pack_number: 1, pick_number: 15 },
  ];
  const summary = summarizeResults(results);
  assert.equal(summary.total, 3);
  assert.equal(summary.scoredDecisions, 2);
  assert.ok(Math.abs(summary.consensusAgreement - (200 / 3)) < 1e-9);
  assert.ok(Math.abs(summary.historicalAgreement - (200 / 3)) < 1e-9);
  // 100 and 11 at equal log2(5) weight, the forced single-card pick at zero:
  // (100 + 11) / 2 = 55.5 -> 56. The forced pick still earns 100 and still
  // contributes nothing, which is the property this test exists for.
  assert.equal(summary.score, 56);
  assert.equal(summary.grade, 'D');
  assert.equal(summary.biggestMisses[0].selectedId, 'd');
});

test('Full Pack and Draft Run grade the same pack identically', () => {
  // These are two separate implementations - scoring.mjs for Full Pack and
  // Top 3, draft-run.mjs for Draft Run - and they drifted apart once already:
  // Draft Run moved to the settled linear rule and the other two modes were
  // left on the superseded 0.75 curve, so the same pack scored differently
  // depending on which mode opened it. Nothing in the build caught that.
  const pack = [
    { id: 'a', name: 'A', model_probability: 0.52 },
    { id: 'b', name: 'B', model_probability: 0.21 },
    { id: 'c', name: 'C', model_probability: 0.15 },
    { id: 'd', name: 'D', model_probability: 0.07 },
    { id: 'e', name: 'E', model_probability: 0.05 },
  ];
  const puzzle = {
    puzzle_id: 'parity', set_id: 'abc', pack_number: 1, pick_number: 1,
    corpus_version: DRAFT_RUN_CORPUS_VERSION, source_evidence: 'official_archive_trajectory',
    skill_evidence: 'win_rate_bucket', player_win_rate_bucket: 0.65,
    event_match_wins: 7, player_games_lower_bound: 100,
    prior_picks: [], candidates: pack, historical_pick_id: 'b',
  };
  for (const card of pack) {
    assert.equal(gradePick(pack, card.id, 'b').score,
      gradeDraftRunPick(puzzle, card.id).score,
      `${card.id} is scored differently by the two modes`);
  }
});
