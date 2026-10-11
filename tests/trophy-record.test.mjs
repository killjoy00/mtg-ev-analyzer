import test from 'node:test';
import assert from 'node:assert/strict';
import {trophyDrafterRecord} from '../draft-run.mjs';

test('a known Premier record is shown exactly',()=>{
  assert.equal(trophyDrafterRecord({event_match_wins:7,event_match_losses:1,player_win_rate_bucket:0.62}),'went 7–1');
  assert.equal(trophyDrafterRecord({event_match_wins:7,event_match_losses:0}),'went 7–0');
  assert.equal(trophyDrafterRecord({event_match_wins:7,event_match_losses:'2'}),'went 7–2');
});

test('without losses the archived win rate describes the drafter',()=>{
  assert.equal(trophyDrafterRecord({event_match_wins:7,player_win_rate_bucket:0.62}),'has a 62% win rate');
  assert.equal(trophyDrafterRecord({event_match_wins:7,event_match_losses:null,player_win_rate_bucket:0.775}),'has a 78% win rate');
  // A Traditional trophy is always 3-0, so its record says nothing about the drafter.
  assert.equal(trophyDrafterRecord({source_event_type:'TradDraft',event_match_wins:3,event_match_losses:0,
    player_win_rate_bucket:0.64}),'has a 64% win rate');
});

test('legacy rank evidence is used when there is no win rate',()=>{
  assert.equal(trophyDrafterRecord({event_match_wins:7,player_rank_tier:'mythic',player_win_rate_bucket:null}),'reached Mythic rank');
  assert.equal(trophyDrafterRecord({event_match_wins:7,player_rank_tier:'diamond'}),'reached Diamond rank');
  assert.equal(trophyDrafterRecord({event_match_wins:7,player_rank_tier:'platinum'}),null);
});

test('unknown losses are never shown as zero and wins alone show nothing',()=>{
  assert.equal(trophyDrafterRecord({event_match_wins:7}),null,'every trophy has 7 wins, so it is not shown');
  assert.equal(trophyDrafterRecord({event_match_wins:7,event_match_losses:5}),null);
  assert.equal(trophyDrafterRecord({event_match_wins:7,event_match_losses:'  '}),null);
  assert.equal(trophyDrafterRecord({event_match_wins:7,player_win_rate_bucket:'n/a'}),null);
  assert.equal(trophyDrafterRecord({event_match_wins:7,player_win_rate_bucket:1.4}),null);
  assert.equal(trophyDrafterRecord({event_match_wins:null,event_match_losses:null}),null);
  for(const value of [trophyDrafterRecord({event_match_wins:7,player_win_rate_bucket:0.62}),'went 7–1'])
    assert.doesNotMatch(value,/7–0/);
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
