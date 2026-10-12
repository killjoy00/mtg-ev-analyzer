import test from 'node:test';
import assert from 'node:assert/strict';
import {trophyDrafterEvidence,withSourceDraftRecord,publicDraftRunAnswer,gradeDraftRunPick,publicDraftRunPuzzle,DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';
import {trophySourceLosses,TROPHY_SOURCE_LOSSES_SQL} from '../worker/trophy-source-record.mjs';

test('a known Premier record and the win rate are both kept, separately',()=>{
  assert.deepEqual(trophyDrafterEvidence({event_match_wins:7,event_match_losses:1,player_win_rate_bucket:0.62}),{record:'7–1',winRate:62,rank:null});
  assert.deepEqual(trophyDrafterEvidence({event_match_wins:7,event_match_losses:0}),{record:'7–0',winRate:null,rank:null});
  assert.deepEqual(trophyDrafterEvidence({event_match_wins:7,event_match_losses:'2',player_win_rate_bucket:0.775}),{record:'7–2',winRate:78,rank:null});
});

test('without a record the archived win rate, else the legacy rank, remains',()=>{
  assert.deepEqual(trophyDrafterEvidence({event_match_wins:7,player_win_rate_bucket:0.62}),{record:null,winRate:62,rank:null});
  assert.deepEqual(trophyDrafterEvidence({event_match_wins:7,player_rank_tier:'mythic',player_win_rate_bucket:null}),{record:null,winRate:null,rank:'Mythic'});
  assert.deepEqual(trophyDrafterEvidence({event_match_wins:7,player_rank_tier:'diamond',player_win_rate_bucket:0.6}),{record:null,winRate:60,rank:null},'rank is only a fallback for a missing win rate');
  assert.equal(trophyDrafterEvidence({event_match_wins:7,player_rank_tier:'platinum'}),null);
});

test('a Traditional 3–0 and unknown or invalid losses are never shown as a Premier record',()=>{
  assert.deepEqual(trophyDrafterEvidence({source_event_type:'TradDraft',event_match_wins:3,event_match_losses:0,player_win_rate_bucket:0.64}),{record:null,winRate:64,rank:null});
  for(const losses of [null,undefined,'','  ',3,5,-1,1.5,'n/a'])
    assert.equal(trophyDrafterEvidence({event_match_wins:7,event_match_losses:losses})?.record??null,null,String(losses));
  assert.equal(trophyDrafterEvidence({event_match_wins:7}),null,'every trophy has 7 wins, so wins alone show nothing');
  assert.equal(trophyDrafterEvidence({event_match_wins:7,player_win_rate_bucket:'n/a'}),null);
  assert.equal(trophyDrafterEvidence({event_match_wins:7,player_win_rate_bucket:1.4}),null);
  assert.equal(trophyDrafterEvidence({event_match_wins:7,player_win_rate_bucket:''}),null);
});

test('the ledger count fills a missing payload count and a disagreement clears it',()=>{
  const payload={event_match_wins:7,player_win_rate_bucket:0.62};
  assert.equal(withSourceDraftRecord(payload,1).event_match_losses,1);
  assert.equal(payload.event_match_losses,undefined,'the stored payload is never modified');
  assert.equal(withSourceDraftRecord(payload,null),payload);
  assert.equal(withSourceDraftRecord({...payload,event_match_losses:2},2).event_match_losses,2);
  assert.equal(withSourceDraftRecord({...payload,event_match_losses:2},1).event_match_losses,null);
  const traditional={source_event_type:'TradDraft',event_match_wins:3,event_match_losses:0};
  assert.equal(withSourceDraftRecord(traditional,1),traditional);
});

test('grading carries structured drafter evidence and the public puzzle still hides it',()=>{
  const puzzle={puzzle_id:'p1',set_id:'dsk',pack_number:1,pick_number:1,prior_picks:[],corpus_version:DRAFT_RUN_CORPUS_VERSION,
    historical_pick_id:'a',event_match_wins:7,event_match_losses:2,player_win_rate_bucket:0.62,
    candidates:[{id:'a',name:'A',model_probability:0.6},{id:'b',name:'B',model_probability:0.4},{id:'c',name:'C',model_probability:0.2},{id:'d',name:'D',model_probability:0.1}]};
  const grade=gradeDraftRunPick(puzzle,'b');
  assert.deepEqual(grade.trophyDrafter,{record:'7–2',winRate:62,rank:null});
  assert.equal(Object.hasOwn(grade,'trophyRecord'),false,'new answers never store the old headline string');
  const publicPuzzle=publicDraftRunPuzzle(puzzle);
  assert.equal(publicPuzzle.event_match_wins,undefined);
  assert.equal(publicPuzzle.event_match_losses,undefined);
  assert.equal(publicPuzzle.player_win_rate_bucket,undefined);
});

test('responses replace saved legacy strings so older apps show a plain headline',()=>{
  assert.deepEqual(publicDraftRunAnswer({score:80,trophyRecord:'has a 62% win rate'}),{score:80,trophyDrafter:{record:null,winRate:62,rank:null}});
  assert.deepEqual(publicDraftRunAnswer({score:80,trophyRecord:'went 7–1'}),{score:80,trophyDrafter:{record:'7–1',winRate:null,rank:null}});
  assert.deepEqual(publicDraftRunAnswer({score:80,trophyRecord:'won 7 matches'}),{score:80,trophyDrafter:null});
  const current={score:90,trophyDrafter:{record:'7–0',winRate:64,rank:null}};
  assert.equal(publicDraftRunAnswer(current),current);
  assert.equal(publicDraftRunAnswer(null),null);
});

test('the ledger lookup requires agreeing valid entries and never blocks a pick',async()=>{
  for(const rule of ['ledger.wins=7','ledger.losses BETWEEN 0 AND 2','count(DISTINCT ledger.losses)=1','losses IS NOT NULL',"l.event_type='PremierDraft'",'s.set_id=p.set_id','v.set_id=p.set_id'])
    assert.ok(TROPHY_SOURCE_LOSSES_SQL.includes(rule),rule);
  assert.equal(await trophySourceLosses(async()=>({rows:[{losses:'1'}]}),'p1'),1);
  assert.equal(await trophySourceLosses(async()=>({rows:[{losses:null}]}),'p1'),null);
  const errors=[];const original=console.error;console.error=(...args)=>errors.push(args);
  try {assert.equal(await trophySourceLosses(async()=>{throw Error('database unavailable');},'p1'),null);}
  finally {console.error=original;}
  assert.equal(errors.length,1,'a failed lookup is logged, not thrown');
});
