import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {routeFamily} from '../edge/gateway.mjs';

const worker=fs.readFileSync('worker/draft-run-function.mjs','utf8');
const migration=fs.readFileSync('migrations/0052_decision_reports.sql','utf8');
const secureRelease=fs.readFileSync('.github/workflows/secure-auth-release.yml','utf8');
const manifest=JSON.parse(fs.readFileSync('migrations/manifest.json','utf8'));

test('decision report backend derives decision metadata from the committed run',()=>{
  assert.match(worker,/DECISION_REPORT_REASONS/);
  assert.match(worker,/round>=s\.answers\.length/);
  assert.match(worker,/body\.puzzleId!==answer\?\.puzzle\?\.puzzle_id/);
  assert.match(worker,/fullPuzzle=await puzzle\(answer\.puzzle\.puzzle_id,s\.corpus_version\)/);
  assert.match(worker,/answer\.selectedId,answer\.selectedName/);
  assert.match(worker,/answer\.ranking\)&&answer\.ranking\[0\]/);
  assert.match(worker,/fullPuzzle\.model_version\|\|null/);
  assert.match(worker,/releaseMetadata\(\)\.release_commit/);
  assert.match(worker,/environmentOf\(s\),s\.day\|\|null,s\.corpus_version/);
  assert.match(worker,/s\.difficulty_version\|\|null,s\.selection_version\|\|null/);
  assert.match(worker,/owner,answer\.puzzle\.puzzle_id/);
  assert.match(worker,/comment\.length>500/);
  assert.doesNotMatch(worker,/draft_run_decision_reports[\s\S]{0,1200}(email|authorization|token)/i);
});

test('decision report schema supports repeated-report review without storing contact data',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS draft_run_decision_reports/);
  assert.match(migration,/player_id uuid REFERENCES players\(id\) ON DELETE SET NULL/);
  assert.match(migration,/puzzle_id text NOT NULL/);
  assert.match(migration,/reason text NOT NULL CHECK/);
  assert.match(migration,/char_length\(comment\) <= 500/);
  assert.match(migration,/corpus_version text NOT NULL/);
  assert.match(migration,/model_version text/);
  assert.match(migration,/client_platform text NOT NULL/);
  assert.match(migration,/draft_run_decision_reports_puzzle_idx/);
  assert.match(migration,/draft_run_decision_reports_reason_idx/);
  assert.match(migration,/CREATE OR REPLACE VIEW draft_run_decision_report_summary/);
  assert.match(migration,/count\(DISTINCT player_id\)::int AS independent_reporters/);
  assert.match(migration,/score_recommendation_reports/);
  assert.doesNotMatch(migration,/email|auth_token|access_token|refresh_token/i);
});

test('decision report route is classified and migration is on a guarded release path',()=>{
  assert.equal(routeFamily('/draft/v1/runs/11111111-1111-4111-8111-111111111111/report'),'draft_report');
  assert.ok(manifest.ordered.includes('0052_decision_reports.sql'));
  assert.ok(manifest.release_paths['secure-auth-release'].migrations.includes('0052_decision_reports.sql'));
  assert.equal(secureRelease.split('migrations/0052_decision_reports.sql').length-1,2);
});
