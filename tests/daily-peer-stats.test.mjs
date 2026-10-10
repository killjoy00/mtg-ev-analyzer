import test from 'node:test';
import assert from 'node:assert/strict';
import {DAILY_PEER_STATS_SQL,MIN_DAILY_PEERS,summarizeDailyPeers} from '../worker/daily-peer-stats.mjs';

test('Daily peer comparison hides the entire sample below twenty',()=>{
  assert.equal(MIN_DAILY_PEERS,20);
  assert.deepEqual(summarizeDailyPeers({players:'1',matching_pick:'1',trophy_pick:'1'}),{available:false});
  assert.deepEqual(summarizeDailyPeers({players:'19',matching_pick:'19',trophy_pick:'19'}),{available:false});
  assert.deepEqual(summarizeDailyPeers({players:'NaN',matching_pick:0,trophy_pick:0}),{available:false});
});

test('Daily peer comparison rounds percentages for separate personal and trophy answers',()=>{
  assert.deepEqual(summarizeDailyPeers({players:'20',matching_pick:'8',trophy_pick:'4'}),
    {available:true,players:20,matching_pick_pct:40,trophy_pick_pct:20});
  assert.deepEqual(summarizeDailyPeers({players:22,matching_pick:9,trophy_pick:4}),
    {available:true,players:22,matching_pick_pct:41,trophy_pick_pct:18});
  assert.deepEqual(summarizeDailyPeers({players:20,matching_pick:21,trophy_pick:1}),{available:false});
});

test('Daily peer SQL scopes date/environment/exact puzzle, locked rounds and deduped identities',()=>{
  assert.match(DAILY_PEER_STATS_SQL,/s\.day=\$1::date AND s\.environment=\$2/);
  assert.match(DAILY_PEER_STATS_SQL,/s\.puzzle_ids -> \$4::int = to_jsonb\(\$3::text\)/);
  assert.match(DAILY_PEER_STATS_SQL,/jsonb_array_length\(s\.answers\)>\$4::int/);
  assert.match(DAILY_PEER_STATS_SQL,/DISTINCT ON \(COALESCE\(s\.daily_account_id::text,s\.player_id::text\)\)/);
});
