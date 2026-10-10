import test from 'node:test';
import assert from 'node:assert/strict';
import {trophyDrafterRecord} from '../draft-run.mjs';

test('record displays archived losses exactly when evidence exists',()=>{
  assert.equal(trophyDrafterRecord({event_match_wins:7,event_match_losses:1}),'went 7–1');
  assert.equal(trophyDrafterRecord({event_match_wins:7,event_match_losses:0}),'went 7–0');
  assert.equal(trophyDrafterRecord({event_match_wins:3,event_match_losses:0}),'went 3–0');
});

test('missing losses are never represented as zero losses',()=>{
  assert.equal(trophyDrafterRecord({event_match_wins:7,event_match_losses:null}),'won 7 matches');
  assert.equal(trophyDrafterRecord({event_match_wins:7}),'won 7 matches');
  assert.equal(trophyDrafterRecord({event_match_wins:7,event_match_losses:5}),'won 7 matches');
  assert.equal(trophyDrafterRecord({event_match_wins:null,event_match_losses:null}),null);
});

test('record is attached to the committed answer but omitted from public unrevealed puzzle',async()=>{
  const {publicDraftRunPuzzle}=await import('../draft-run.mjs');
  const puzzle={puzzle_id:'p1',set_id:'dsk',pack_number:1,pick_number:1,
    prior_picks:[],candidates:[],event_match_wins:7,event_match_losses:2};
  const publicPuzzle=publicDraftRunPuzzle(puzzle);
  assert.equal(publicPuzzle.event_match_wins,undefined);
  assert.equal(publicPuzzle.event_match_losses,undefined);
  assert.equal(publicPuzzle.trophyRecord,undefined);
});
