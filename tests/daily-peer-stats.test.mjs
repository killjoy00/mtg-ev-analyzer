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
  assert.match(DAILY_PEER_STATS_SQL,/s\.puzzle_ids -> \$4::int = to_jsonb\(\$3::text\)/);
  assert.match(DAILY_PEER_STATS_SQL,/jsonb_array_length\(s\.answers\)>\$4::int/);
  assert.match(DAILY_PEER_STATS_SQL,/DISTINCT ON \(COALESCE\(s\.daily_account_id::text,s\.player_id::text\)\)/);
});
