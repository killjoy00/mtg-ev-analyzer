import test from 'node:test';
import assert from 'node:assert/strict';
import {assertHistoryPreserved} from '../scripts/v5-release-state.mjs';

const before={
  game_results:[{fingerprint:'a',n:2}],
  scores:[{fingerprint:'b',n:1}],
  draft_run_sessions:[{fingerprint:'c',n:3}],
  draft_run_schedules:[{fingerprint:'d',n:1}],
};

test('v5 history preservation allows append-only activity',()=>{
  assert.doesNotThrow(()=>assertHistoryPreserved(before,{
    game_results:[{fingerprint:'a',n:2},{fingerprint:'new',n:4}],
    scores:[{fingerprint:'b',n:2}],
    draft_run_sessions:[{fingerprint:'c',n:3},{fingerprint:'later',n:1}],
    draft_run_schedules:[{fingerprint:'d',n:1},{fingerprint:'tomorrow',n:1}],
  }));
});

test('v5 history preservation rejects removal or semantic mutation',()=>{
  assert.throws(()=>assertHistoryPreserved(before,{
    game_results:[{fingerprint:'a',n:1}],
    scores:[{fingerprint:'b',n:1}],
    draft_run_sessions:[{fingerprint:'c',n:3}],
    draft_run_schedules:[{fingerprint:'d',n:1}],
  }),/game_results/);
  assert.throws(()=>assertHistoryPreserved(before,{
    game_results:[{fingerprint:'a',n:2}],
    scores:[{fingerprint:'changed',n:1}],
    draft_run_sessions:[{fingerprint:'c',n:3}],
    draft_run_schedules:[{fingerprint:'d',n:1}],
  }),/scores/);
});
