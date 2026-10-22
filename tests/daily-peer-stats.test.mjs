import test from 'node:test';
import assert from 'node:assert/strict';
import {DAILY_PEER_STATS_SQL,MIN_DAILY_PEERS,lockedDailyPeerAnswer,summarizeDailyPeers} from '../worker/daily-peer-stats.mjs';

test('only owned, already committed, matching Daily decisions can be compared',()=>{
  const session={day:'2026-10-10',puzzle_ids:['p1','p2'],answers:[
    {puzzle:{puzzle_id:'p1'},selectedId:'card-a',historicalId:'card-b'},
  ]};
  assert.equal(lockedDailyPeerAnswer(session,0),session.answers[0]);
  assert.equal(lockedDailyPeerAnswer(session,1),null); // future round
  assert.equal(lockedDailyPeerAnswer({...session,day:null},0),null); // practice
  assert.equal(lockedDailyPeerAnswer({...session,answers:[{...session.answers[0],puzzle:{puzzle_id:'other'}}]},0),null);
  assert.equal(lockedDailyPeerAnswer({...session,answers:[]},0),null);
  assert.equal(lockedDailyPeerAnswer(session,-1),null);
});

test('Daily peer comparison hides samples below ten distinct completed picks',()=>{
  assert.equal(MIN_DAILY_PEERS,10);
  assert.deepEqual(summarizeDailyPeers({players:'1',matching_pick:'1',trophy_pick:'1'}),{available:false});
  assert.deepEqual(summarizeDailyPeers({players:'5',matching_pick:'5',trophy_pick:'5'}),{available:false});
  assert.deepEqual(summarizeDailyPeers({players:'9',matching_pick:'9',trophy_pick:'9'}),{available:false});
  assert.deepEqual(summarizeDailyPeers({players:'NaN',matching_pick:0,trophy_pick:0}),{available:false});
});

test('Daily peer comparison becomes available at ten players and rounds percentages',()=>{
  assert.deepEqual(summarizeDailyPeers({players:'10',matching_pick:'4',trophy_pick:'2'}),
    {available:true,players:10,matching_pick_pct:40,trophy_pick_pct:20});
  assert.deepEqual(summarizeDailyPeers({players:'20',matching_pick:'8',trophy_pick:'4'}),
    {available:true,players:20,matching_pick_pct:40,trophy_pick_pct:20});
  assert.deepEqual(summarizeDailyPeers({players:22,matching_pick:9,trophy_pick:4}),
    {available:true,players:22,matching_pick_pct:41,trophy_pick_pct:18});
  assert.deepEqual(summarizeDailyPeers({players:10,matching_pick:11,trophy_pick:1}),{available:false});
  assert.deepEqual(summarizeDailyPeers({players:20,matching_pick:21,trophy_pick:1}),{available:false});
});

test('Daily peer SQL scopes date/environment/exact puzzle, locked rounds and deduped identities',()=>{
  assert.match(DAILY_PEER_STATS_SQL,/s\.day=\$1::date AND s\.environment=\$2/);
  assert.match(DAILY_PEER_STATS_SQL,/AND NOT s\.measurement_qa/,'QA sessions never enter the 10-player threshold or percentages');
  assert.match(DAILY_PEER_STATS_SQL,/FROM draft_run_decision_observations o\s+JOIN draft_run_sessions s ON s\.id=o\.session_id/);
  assert.match(DAILY_PEER_STATS_SQL,/o\.puzzle_id=\$3::text AND o\.round=\$4::int\+1 AND o\.outcome='pick'/);
  assert.doesNotMatch(DAILY_PEER_STATS_SQL,/answers/,'never read full answers documents per reveal');
  assert.match(DAILY_PEER_STATS_SQL,/DISTINCT ON \(COALESCE\(s\.daily_account_id::text,s\.player_id::text\)\)/);
});

test('per-card pick shares follow the same ten-player threshold and drop malformed breakdowns',()=>{
  assert.match(DAILY_PEER_STATS_SQL,/jsonb_object_agg\(selected_id,picks\)/);
  assert.match(DAILY_PEER_STATS_SQL,/FROM daily_decisions GROUP BY selected_id/,'shares come from the same deduped decisions');
  assert.deepEqual(summarizeDailyPeers({players:9,matching_pick:3,trophy_pick:2,card_picks:{a:3,b:6}}),{available:false});
  assert.deepEqual(summarizeDailyPeers({players:12,matching_pick:6,trophy_pick:4,card_picks:{a:6,b:4,c:2}}),
    {available:true,players:12,matching_pick_pct:50,trophy_pick_pct:33,card_pick_pct:{a:50,b:33,c:17}});
  assert.deepEqual(summarizeDailyPeers({players:10,matching_pick:5,trophy_pick:5,card_picks:'{"a":5,"b":5}'}).card_pick_pct,{a:50,b:50},'JSON text from the driver is accepted');
  for(const card_picks of [{a:11},{a:6,b:6},{a:-1},{a:'x'},[3],'not json',null,undefined]) {
    const result=summarizeDailyPeers({players:10,matching_pick:5,trophy_pick:5,card_picks});
    assert.equal(result.available,true,'the summary survives a bad breakdown');
    assert.equal('card_pick_pct' in result,false);
  }
});
