#!/usr/bin/env node
// Read-only check of the checked-in corpus, not a production database audit.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { gradeDraftRunPick, validateDraftRunPuzzle } from '../draft-run.mjs';
import { gradePick } from '../scoring.mjs';

const root = process.argv[2] || 'corpus/draft-run';
const catalogBytes = readFileSync(join(root, 'catalog.json'));
const catalog = JSON.parse(catalogBytes);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const totals = { sets: 0, puzzles: 0, candidate_awards: 0, trophy_awards: 0, alternative_awards: 0 };
const sets = [];
for (const entry of catalog.sets) {
  const bytes = readFileSync(join(root, `${entry.id}.json.gz`));
  assert.equal(sha256(bytes), entry.sha256, `${entry.id}: catalog digest`);
  const puzzles = JSON.parse(gunzipSync(bytes));
  assert.equal(puzzles.length, entry.puzzles, `${entry.id}: catalog count`);
  let candidateAwards = 0;
  for (const puzzle of puzzles) {
    assert.ok(validateDraftRunPuzzle(puzzle, catalog.corpus_version), `${entry.id}: invalid puzzle`);
    const sum = puzzle.candidates.reduce((n, card) => n + Number(card.model_probability), 0);
    assert.ok(Math.abs(sum - 1) <= puzzle.candidates.length * .0000005 + 1e-12,
      `${entry.id}: support normalization`);
    for (const card of puzzle.candidates) {
      const server = gradeDraftRunPick(puzzle, card.id);
      const client = gradePick(puzzle.candidates, card.id, puzzle.historical_pick_id);
      assert.equal(server.score, client.score, `${entry.id}: award parity`);
      assert.equal(server.historicalMatch, client.historicalMatch, `${entry.id}: historical parity`);
      assert.ok(Number.isInteger(server.score), `${entry.id}: integer award`);
      if (card.id === puzzle.historical_pick_id) {
        assert.equal(server.score, 100, `${entry.id}: trophy award`);
        totals.trophy_awards++;
      } else {
        assert.ok(server.score >= 0 && server.score <= 95, `${entry.id}: alternative bounds`);
        totals.alternative_awards++;
      }
      candidateAwards++;
    }
  }
  totals.sets++;
  totals.puzzles += puzzles.length;
  totals.candidate_awards += candidateAwards;
  sets.push({ set: entry.id, puzzles: puzzles.length, candidate_awards: candidateAwards });
}
console.log(JSON.stringify({ catalog_sha256: sha256(catalogBytes), ...totals, passed: true, per_set: sets,
  scope: 'Checked-in catalog only; excludes database-only additions and frozen historical scoring profiles.' }, null, 2));
