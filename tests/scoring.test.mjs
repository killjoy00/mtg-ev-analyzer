import test from 'node:test';
import assert from 'node:assert/strict';
import { fullPackDecisionWeight, gradePick, gradeTopThree, rankCandidates, scoreGrade, summarizeResults } from '../scoring.mjs';

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

test('gradePick keeps a close second close without flattening clear misses', () => {
  const result = gradePick(candidates, 'b', 'a');
  assert.equal(result.rank, 2);
  assert.equal(result.verdict, 'Close call');
  assert.equal(result.consensusMatch, false);
  assert.equal(result.historicalMatch, false);
  assert.equal(result.score, 92);
  assert.ok(Math.abs(result.gap - 0.05) < 1e-9);
});

test('gradePick gives the consensus pick 100', () => {
  const result = gradePick(candidates, 'a', 'a');
  assert.equal(result.score, 100);
  assert.equal(result.verdict, 'Consensus pick');
});

test('gradePick makes a low-support alternative clearly costly', () => {
  const result = gradePick(candidates, 'd', 'a');
  assert.equal(result.score, 19);
  assert.equal(result.verdict, 'Big disagreement');
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
  assert.equal(result.setSupport, 100);
  assert.equal(result.score, 90);
  assert.deepEqual(result.consensusIds, ['a', 'b', 'c']);
});

test('gradeTopThree gives continuous credit to a near-miss outside the model top three', () => {
  const result = gradeTopThree(candidates, ['a', 'b', 'd'], 'a');
  assert.equal(result.overlap, 2);
  assert.equal(result.score, 90);
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
  assert.equal(summary.score, 60);
  assert.equal(summary.grade, 'C');
  assert.equal(summary.biggestMisses[0].selectedId, 'd');
});
