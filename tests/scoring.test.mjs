import test from 'node:test';
import assert from 'node:assert/strict';
import { gradePick, gradeTopThree, rankCandidates, scoreGrade, summarizeResults } from '../scoring.mjs';

const candidates = [
  { id: 'a', name: 'A', model_probability: 0.45 },
  { id: 'b', name: 'B', model_probability: 0.40 },
  { id: 'c', name: 'C', model_probability: 0.10 },
  { id: 'd', name: 'D', model_probability: 0.05 },
];

test('rankCandidates orders by modeled likelihood', () => {
  assert.deepEqual(rankCandidates(candidates).map((card) => card.id), ['a', 'b', 'c', 'd']);
});

test('scoreGrade describes consensus alignment rather than objective correctness', () => {
  assert.deepEqual(scoreGrade(96), { grade: 'A+', label: 'Near consensus' });
  assert.deepEqual(scoreGrade(82), { grade: 'B+', label: 'Strong' });
  assert.deepEqual(scoreGrade(48), { grade: 'F', label: 'Far off consensus' });
});

test('gradePick treats a close second as a close call without a linear probability penalty', () => {
  const result = gradePick(candidates, 'b', 'a');
  assert.equal(result.rank, 2);
  assert.equal(result.verdict, 'Close call');
  assert.equal(result.consensusMatch, false);
  assert.equal(result.historicalMatch, false);
  assert.equal(result.score, 94);
  assert.ok(Math.abs(result.gap - 0.05) < 1e-9);
});

test('gradePick gives the consensus pick 100', () => {
  const result = gradePick(candidates, 'a', 'a');
  assert.equal(result.score, 100);
  assert.equal(result.verdict, 'Consensus pick');
});

test('gradePick still makes a low-support alternative meaningfully costly', () => {
  const result = gradePick(candidates, 'd', 'a');
  assert.equal(result.score, 33);
  assert.equal(result.verdict, 'Big disagreement');
});

test('gradePick tracks historical agreement separately from consensus', () => {
  const result = gradePick(candidates, 'b', 'b');
  assert.equal(result.historicalMatch, true);
  assert.equal(result.consensusMatch, false);
});

test('gradeTopThree gives 100 for an exact consensus ranking', () => {
  const result = gradeTopThree(candidates, ['a', 'b', 'c'], 'a');
  assert.equal(result.overlap, 3);
  assert.equal(result.exactPositions, 3);
  assert.equal(result.score, 100);
  assert.equal(result.grade, 'A+');
});

test('gradeTopThree rewards all three consensus cards while respecting order and support', () => {
  const result = gradeTopThree(candidates, ['a', 'c', 'b'], 'a');
  assert.equal(result.overlap, 3);
  assert.equal(result.exactPositions, 1);
  assert.equal(result.historicalRank, 1);
  assert.equal(result.score, 85);
  assert.deepEqual(result.consensusIds, ['a', 'b', 'c']);
});

test('gradeTopThree gives partial credit to a near-miss outside the model top three', () => {
  const result = gradeTopThree(candidates, ['a', 'b', 'd'], 'a');
  assert.equal(result.overlap, 2);
  assert.equal(result.score, 94);
});

test('gradeTopThree rejects duplicate choices', () => {
  assert.throws(() => gradeTopThree(candidates, ['a', 'a', 'b'], 'a'));
});

test('summarizeResults averages softened per-pick consensus support', () => {
  const results = [
    { ...gradePick(candidates, 'a', 'a'), pack_number: 1, pick_number: 1 },
    { ...gradePick(candidates, 'd', 'b'), pack_number: 1, pick_number: 2 },
  ];
  const summary = summarizeResults(results);
  assert.equal(summary.total, 2);
  assert.equal(summary.consensusAgreement, 50);
  assert.equal(summary.historicalAgreement, 50);
  assert.equal(summary.score, 67);
  assert.equal(summary.grade, 'C+');
  assert.equal(summary.biggestMisses[0].selectedId, 'd');
});
