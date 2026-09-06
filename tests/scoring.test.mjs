import test from 'node:test';
import assert from 'node:assert/strict';
import { gradePick, rankCandidates, summarizeResults } from '../scoring.mjs';

const candidates = [
  { id: 'a', name: 'A', model_probability: 0.45 },
  { id: 'b', name: 'B', model_probability: 0.40 },
  { id: 'c', name: 'C', model_probability: 0.10 },
  { id: 'd', name: 'D', model_probability: 0.05 },
];

test('rankCandidates orders by modeled likelihood', () => {
  assert.deepEqual(rankCandidates(candidates).map((card) => card.id), ['a', 'b', 'c', 'd']);
});

test('gradePick treats a close second as a close call', () => {
  const result = gradePick(candidates, 'b', 'a');
  assert.equal(result.rank, 2);
  assert.equal(result.verdict, 'Close call');
  assert.equal(result.consensusMatch, false);
  assert.equal(result.historicalMatch, false);
  assert.ok(Math.abs(result.gap - 0.05) < 1e-9);
});

test('gradePick tracks historical agreement separately from consensus', () => {
  const result = gradePick(candidates, 'b', 'b');
  assert.equal(result.historicalMatch, true);
  assert.equal(result.consensusMatch, false);
});

test('summarizeResults reports agreement and biggest misses', () => {
  const results = [
    { ...gradePick(candidates, 'a', 'a'), pack_number: 1, pick_number: 1 },
    { ...gradePick(candidates, 'd', 'b'), pack_number: 1, pick_number: 2 },
  ];
  const summary = summarizeResults(results);
  assert.equal(summary.total, 2);
  assert.equal(summary.consensusAgreement, 50);
  assert.equal(summary.historicalAgreement, 50);
  assert.equal(summary.biggestMisses[0].selectedId, 'd');
});
