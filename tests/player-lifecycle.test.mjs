import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAYER_LIFECYCLE_SQL,playerLifecycleReport} from '../worker/player-lifecycle-report.mjs';
import {playerLifecycleMarkup} from '../admin/player-lifecycle-view.mjs';
import {adminPath} from '../edge/gateway.mjs';

const counts={registered_accounts:12,never_daily:3,one_play_day:5,returned_another_day:4,
 signed_up_after_play:9,never_after_signup:6,
 eligible_7:7,no_return_7:4,returned_7:3,eligible_14:6,no_return_14:4,returned_14:2,
 eligible_30:2,no_return_30:1,returned_30:1};

test('lifecycle is an authenticated, read-only admin route',()=>{
 assert.equal(adminPath('/v1/admin/player-lifecycle','GET'),true);
 assert.equal(adminPath('/v1/admin/player-lifecycle','POST'),false);
 assert.equal(adminPath('/v1/admin/player-lifecycle/export','GET'),false);
});
test('reports only registered accounts, linked guest history and distinct completed Pacific Daily dates',()=>{
 for(const pattern of [/WITH registered AS MATERIALIZED/,/JOIN account_links a ON a.auth_user_id=r.id/,
  /GROUP BY a.auth_user_id,s.day/,/JOIN draft_run_sessions s ON s.player_id=a.player_id/,
  /NOT s.measurement_qa/,/pack1_admins/,/account_deletion_operations/,
  /d.day>r.signup_day/,/signup_day\+7<today.current_day/,/signup_day\+14<today.current_day/,
  /signup_day\+30<today.current_day/])
  assert.match(PLAYER_LIFECYCLE_SQL,pattern);
 assert.doesNotMatch(PLAYER_LIFECYCLE_SQL,/INSERT |UPDATE |DELETE /i);
});
test('one private aggregate read returns only counts',async()=>{
 const calls=[],query=async(sql,params)=>{calls.push({sql,params});return {rows:[counts]}};
 const result=await playerLifecycleReport(query);
 assert.equal(calls.length,1);
 assert.deepEqual(result.counts,counts);
 assert.equal(Object.values(result.counts).every(Number.isFinite),true);
 assert.doesNotMatch(JSON.stringify(result),/auth_user_id|example.invalid/);
});
test('invalid aggregate fields fail instead of becoming fake zeros',async()=>{
 await assert.rejects(playerLifecycleReport(async()=>({rows:[{registered_accounts:'n/a'}]})),/could not be completed/);
});
test('dashboard separates never Daily, no post-signup return, and one lifetime play day',()=>{
 const html=playerLifecycleMarkup({counts});
 for(const value of ['Signed up, never played','Signed up after playing, never came back',
  'Played on just one day','7 days','14 days','30 days','4 (57.1%)','Not enough data'])
  if(value!=='Not enough data')assert.ok(html.includes(value),value);
 assert.match(html,/all-time/i);
 assert.match(html,/earlier guest session/);
 const empty={...counts,eligible_7:0,returned_7:0,no_return_7:0,eligible_14:0,returned_14:0,no_return_14:0,eligible_30:0,returned_30:0,no_return_30:0};
 assert.match(playerLifecycleMarkup({counts:empty}),/Not enough data/);
 assert.match(playerLifecycleMarkup({}),/unavailable/);
});
