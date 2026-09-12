import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeDraftRunPool } from '../worker/draft-run-health.mjs';

test('Draft Run health reports pullable decisions and distinct source drafts per set', () => {
  const summary = summarizeDraftRunPool([
    { set_id: 'neo', source_draft_hash: 'draft-a' },
    { set_id: 'neo', source_draft_hash: 'draft-a' },
    { set_id: 'neo', source_draft_hash: 'draft-b' },
    { set_id: 'powered-cube', source_draft_hash: 'cube-a' },
  ]);
  assert.deepEqual(summary, {
    by_set: {
      neo: { drafts: 2, decisions: 3 },
      'powered-cube': { drafts: 1, decisions: 1 },
    },
  });
});
