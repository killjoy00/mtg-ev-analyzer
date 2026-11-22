import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAYER_LIFECYCLE_SQL,playerLifecycleReport} from '../worker/player-lifecycle-report.mjs';
import {playerLifecycleMarkup} from '../admin/player-lifecycle-view.mjs';
import {adminPath} from '../edge/gateway.mjs';

const row={all_time:{registered_accounts:10,registered_without_daily:3,daily_people:17,
 one_play_day:11,returned_later:6},cohort:{first_daily_people:9,seven_day_eligible:7,
 seven_day_one_day_only:4,seven_day_returned:3,thirty_day_eligible:2,
 thirty_day_one_day_only:1,thirty_day_returned:1},pacific_day:'2026-11-22'};

test('read-only lifecycle API is admitted only as an authenticated admin GET',()=>{
 assert.equal(adminPath('/v1/admin/player-lifecycle','GET'),true);
 for(const method of ['POST','PATCH','DELETE'])
  assert.equal(adminPath('/v1/admin/player-lifecycle',method),false);
 assert.equal(adminPath('/v1/admin/player-lifecycle/export','GET'),false);
});

test('same distinct-day and QA/account-merge definitions as Habits, with current covering index',()=>{
 assert.match(PLAYER_LIFECYCLE_SQL,/coalesce\(a\.auth_user_id::text,'guest:'/);
 assert.match(PLAYER_LIFECYCLE_SQL,/GROUP BY person_id,day/);
 assert.match(PLAYER_LIFECYCLE_SQL,/FROM completed_days GROUP BY person_id/);
 assert.match(PLAYER_LIFECYCLE_SQL,/NOT s\.measurement_qa/);
 assert.match(PLAYER_LIFECYCLE_SQL,/pack1_admins/);
 assert.match(PLAYER_LIFECYCLE_SQL,/jsonb_array_length\(s\.answers\)=jsonb_array_length\(s\.puzzle_ids\)/);
 assert.match(PLAYER_LIFECYCLE_SQL,/first_day\+7<today\.current_day/);
 assert.match(PLAYER_LIFECYCLE_SQL,/first_day\+30<today\.current_day/);
 assert.match(PLAYER_LIFECYCLE_SQL,/BETWEEN \$1::date AND \$2::date/);
 assert.doesNotMatch(PLAYER_LIFECYCLE_SQL,/INSERT |UPDATE |DELETE /i);
});

test('report returns only aggregated counts, not identities',async()=>{
 const calls=[],query=async(sql,params)=>{calls.push({sql,params});return {rows:[row]}};
 const result=await playerLifecycleReport(query,'2026-10-24','2026-11-22');
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].params,['2026-10-24','2026-11-22']);
 assert.deepEqual(result.all_time,row.all_time);
 assert.deepEqual(result.cohort,row.cohort);
 assert.equal(result.scope.includes('linked accounts'),true);
 assert.ok(!JSON.stringify(result).includes('auth_user_id'));
});

test('bad or overly long dates are rejected before querying',async()=>{
 let calls=0,query=()=>{calls++;return {rows:[]}};
 for(const [from,to] of [['2026-12-01','2026-11-01'],['2026-01-01','2026-11-22'],
  ['2026-02-30','2026-03-01'],['bad','2026-11-22'],['2026-11-22',null]]){
  await assert.rejects(playerLifecycleReport(query,from,to),error=>error.status===400);
 }
 assert.equal(calls,0);
});

test('overview and matured cohort table use readable denominators and do not compare unrelated counts',()=>{
 const markup=playerLifecycleMarkup(row);
 for(const term of ['Registered, no completed Daily','Played on one day only','Returned another day',
  'Three Dailies completed on Monday still count as one day','7 days after first Daily',
  '30 days after first Daily','4<small>57.1% one-day-only','1<small>50.0% one-day-only'])
  assert.ok(markup.includes(term),term);
 assert.match(markup,/Out of 10 registered accounts/);
 assert.match(markup,/Out of 17 people who completed a Daily/);
 assert.match(markup,/eligible people/i);
 assert.match(playerLifecycleMarkup({all_time:{},cohort:{}}),/unavailable/);
});

test('no mature cohort is not inaccurately shown as 0% one-day-only',()=>{
 const none={all_time:row.all_time,cohort:{...row.cohort,seven_day_eligible:0,seven_day_one_day_only:0,
  seven_day_returned:0,thirty_day_eligible:0,thirty_day_one_day_only:0,thirty_day_returned:0}};
 const markup=playerLifecycleMarkup(none);
 assert.match(markup,/Not enough data/);
 assert.doesNotMatch(markup,/0\.0% one-day-only/);
});
