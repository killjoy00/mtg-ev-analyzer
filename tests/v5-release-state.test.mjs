import test from 'node:test';
import assert from 'node:assert/strict';
import {assertHistoryPreserved,HISTORY_SQL} from '../scripts/v5-release-state.mjs';

const before={
  game_results:[{fingerprint:'a',n:2}],
  game_result_environments:[{fingerprint:'env',n:2}],
  scores:[{fingerprint:'b',n:1}],
  draft_run_sessions:[{fingerprint:'c',n:3}],
  completed_draft_run_sessions:[{fingerprint:'done',n:2}],
  draft_run_schedules:[{fingerprint:'d',n:1}],
};

test('v5 history preservation allows append-only activity',()=>{
  assert.doesNotThrow(()=>assertHistoryPreserved(before,{
    game_results:[{fingerprint:'a',n:2},{fingerprint:'new',n:4}],
    game_result_environments:[{fingerprint:'env',n:2},{fingerprint:'new-env',n:3}],
    scores:[{fingerprint:'b',n:2}],
    draft_run_sessions:[{fingerprint:'c',n:3},{fingerprint:'later',n:1}],
    completed_draft_run_sessions:[{fingerprint:'done',n:2},{fingerprint:'new-done',n:1}],
    draft_run_schedules:[{fingerprint:'d',n:1},{fingerprint:'tomorrow',n:1}],
  }));
});

test('v5 history preservation rejects removal or semantic mutation',()=>{
  assert.throws(()=>assertHistoryPreserved(before,{
    game_results:[{fingerprint:'a',n:1}],
    game_result_environments:[{fingerprint:'env',n:2}],
    scores:[{fingerprint:'b',n:1}],
    draft_run_sessions:[{fingerprint:'c',n:3}],
    completed_draft_run_sessions:[{fingerprint:'done',n:2}],
    draft_run_schedules:[{fingerprint:'d',n:1}],
  }),/game_results/);
  assert.throws(()=>assertHistoryPreserved(before,{
    game_results:[{fingerprint:'a',n:2}],
    game_result_environments:[{fingerprint:'env',n:2}],
    scores:[{fingerprint:'changed',n:1}],
    draft_run_sessions:[{fingerprint:'c',n:3}],
    completed_draft_run_sessions:[{fingerprint:'done',n:2}],
    draft_run_schedules:[{fingerprint:'d',n:1}],
  }),/scores/);
  assert.throws(()=>assertHistoryPreserved(before,{
    game_results:[{fingerprint:'a',n:2}],
    game_result_environments:[{fingerprint:'env',n:2}],
    scores:[{fingerprint:'b',n:1}],
    draft_run_sessions:[{fingerprint:'c',n:3}],
    completed_draft_run_sessions:[{fingerprint:'changed-completion',n:2}],
    draft_run_schedules:[{fingerprint:'d',n:1}],
  }),/completed_draft_run_sessions/);
});

test('history fingerprints allow identity churn but preserve result semantics',()=>{
  assert.match(HISTORY_SQL.game_results,/challenge_id/);
  assert.match(HISTORY_SQL.game_results,/opponent_name/);
  assert.doesNotMatch(HISTORY_SQL.game_results,/ARRAY\[[^\]]*'opponent_score'/s);
  assert.doesNotMatch(HISTORY_SQL.game_results,/ARRAY\[[^\]]*'outcome'/s);
  assert.match(HISTORY_SQL.game_result_environments,/client_result_id/);
  assert.match(HISTORY_SQL.game_result_environments,/e\.score/);
  assert.match(HISTORY_SQL.completed_draft_run_sessions,/jsonb_array_length\(t\.answers\)=jsonb_array_length\(t\.puzzle_ids\)/);
  assert.doesNotMatch(HISTORY_SQL.completed_draft_run_sessions,/\['[^\]]*answers/);
  assert.doesNotMatch(HISTORY_SQL.completed_draft_run_sessions,/\['[^\]]*score/);
});
