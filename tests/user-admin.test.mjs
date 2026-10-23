import test from 'node:test';
import assert from 'node:assert/strict';
import {handleUserAdmin,playActivityWindow,userAdminFilters,userAdminPage} from '../worker/user-admin.mjs';

const ADMIN='11111111-1111-4111-8111-111111111111';
const TARGET='22222222-2222-4222-8222-222222222222';
const PLAYER='33333333-3333-4333-8333-333333333333';

test('user admin filters stay account-scoped',()=>{
  const parsed=userAdminFilters(new URL('https://packone.pro/v1/admin/users?search=%20member%40example.com%20&status=patreon'));
  assert.deepEqual(parsed,{search:'member@example.com',status:'patreon'});
  assert.throws(()=>userAdminFilters(new URL('https://packone.pro/v1/admin/users?status=players')),error=>error.status===400);
  assert.throws(()=>userAdminFilters(new URL('https://packone.pro/v1/admin/users?search='+encodeURIComponent('x'.repeat(101)))),error=>error.status===400);
});


test('user search includes the linked public username without broadening beyond authenticated accounts',async()=>{
  const seen=[];
  const query=async(sql)=>{
    seen.push(sql);
    if(sql.includes('count(*)::int total FROM neon_auth."user" u'))return {rows:[{total:'0'}],rowCount:1};
    if(sql.includes('SELECT count(*)::int total,'))return {rows:[{total:'0',new_30d:'0',active_30d:'0',paid:'0',patreon:'0',admins:'0',username_attention:'0'}],rowCount:1};
    return {rows:[],rowCount:0};
  };
  const request=new Request('https://packone.pro/v1/admin/users?search=PublicName');
  await handleUserAdmin(request,query,undefined,{adminAuthUserId:ADMIN});
  const sql=seen.join('\n');
  assert.match(sql,/search_player\.display_name/);
  assert.match(sql,/FROM neon_auth\."user" u/);
  assert.match(sql,/LIMIT 100/);
});

test('signed-out activity window defaults to the last 14 Pacific dates and rejects bad ranges',()=>{
  const now=new Date('2026-10-18T05:00:00Z');
  assert.deepEqual(playActivityWindow(new URL('https://packone.pro/v1/admin/users'),now),{start:'2026-10-04',end:'2026-10-17'});
  assert.deepEqual(playActivityWindow(new URL('https://packone.pro/v1/admin/users?activity_from=2026-10-10&activity_to=2026-10-12'),now),{start:'2026-10-10',end:'2026-10-12'});
  for(const qs of ['activity_to=2026-02-30','activity_from=2026-10-13&activity_to=2026-10-12','activity_from=2024-01-01&activity_to=2026-10-12','activity_from=yesterday'])
    assert.throws(()=>playActivityWindow(new URL('https://packone.pro/v1/admin/users?'+qs),now),error=>error.status===400);
});

test('users list reports signed-out and signed-in play with the habit report exclusions',async()=>{
  let activityCall=null;
  const query=async(sql,params)=>{
    if(sql.includes("'signed_out'")) {
      activityCall={sql,params};
      return {rows:[
        {group:'signed_out',players:'4',completed_runs:'6',first_daily_people:'3',next_day_mature:'2',next_day_returned:'1',next_day_immature:'1',next_day_rate:'50.0'},
        {group:'signed_in',players:'2',completed_runs:'3',first_daily_people:'0',next_day_mature:'0',next_day_returned:'0',next_day_immature:'0',next_day_rate:null},
      ]};
    }
    if(sql.includes('SELECT count(*)::int total,'))return {rows:[{total:'0'}],rowCount:1};
    return {rows:[],rowCount:0};
  };
  const result=await handleUserAdmin(new Request('https://packone.pro/v1/admin/users?activity_from=2026-10-10&activity_to=2026-10-16'),query,undefined,{adminAuthUserId:ADMIN});
  assert.deepEqual(activityCall.params.slice(0,2),['2026-10-10','2026-10-16']);
  assert.match(activityCall.sql,/NOT s\.measurement_qa/);
  assert.match(activityCall.sql,/pack1_admins/);
  assert.match(activityCall.sql,/first_day\+1<today\.current_day/);
  assert.equal(result.play_activity.start,'2026-10-10');
  assert.deepEqual(result.play_activity.groups[0],{group:'signed_out',players:4,completed_runs:6,first_daily_people:3,next_day_mature:2,next_day_returned:1,next_day_immature:1,next_day_rate:50});
  assert.equal(result.play_activity.groups[1].next_day_rate,null);
});

test('a failed signed-out activity query does not take down the users list',async()=>{
  const query=async sql=>{
    if(sql.includes("'signed_out'"))throw Error('statement timeout');
    if(sql.includes('SELECT count(*)::int total,'))return {rows:[{total:'0'}],rowCount:1};
    return {rows:[],rowCount:0};
  };
  const errors=[],original=console.error;
  console.error=line=>errors.push(line);
  try {
    const result=await handleUserAdmin(new Request('https://packone.pro/v1/admin/users'),query,undefined,{adminAuthUserId:ADMIN});
    assert.equal(result.play_activity.unavailable,true);
    assert.deepEqual(result.users,[]);
  } finally {console.error=original;}
  assert.match(errors.join('\n'),/admin_play_activity_failed/);
});

test('account pages validate bounds and preserve a stable list order',async()=>{
  assert.equal(userAdminPage(new URL('https://packone.pro/v1/admin/users')),1);
  assert.equal(userAdminPage(new URL('https://packone.pro/v1/admin/users?page=3')),3);
  for(const invalid of ['0','-1','2.1','1e3','10000','abc'])
    assert.throws(()=>userAdminPage(new URL('https://packone.pro/v1/admin/users?page='+invalid)),error=>error.status===400);

  const calls=[];
  const query=async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('SELECT count(*)::int total FROM neon_auth."user" u'))return {rows:[{total:'245'}]};
    if(sql.includes('SELECT count(*)::int total,'))return {rows:[{total:'260'}]};
    if(sql.includes('LIMIT 100 OFFSET $3'))return {rows:[]};
    return {rows:[]};
  };
  const result=await handleUserAdmin(new Request('https://packone.pro/v1/admin/users?page=3&search=test'),query,undefined,{adminAuthUserId:ADMIN});
  assert.equal(result.page,3);
  assert.equal(result.page_size,100);
  assert.equal(result.total_matching,245);
  assert.equal(result.truncated,false);
  const listCall=calls.find(call=>call.sql.includes('LIMIT 100 OFFSET $3'));
  assert.ok(listCall);
  assert.deepEqual(listCall.params,['test','all',200]);
  assert.match(listCall.sql,/ORDER BY last_active DESC NULLS LAST,u\."createdAt" DESC,u\.id/);
  const countCall=calls.find(call=>call.sql.includes('SELECT count(*)::int total FROM neon_auth."user" u'));
  assert.deepEqual(countCall.params,['test','all']);
});

test('overview account summary skips directory and completed-run queries',async()=>{
  const calls=[];
  const query=async sql=>{
    calls.push(sql);
    return {rows:[{total:'5',new_30d:'2',active_30d:'4',patreon:'1',paid:'1',admins:'1',username_attention:'0'}]};
  };
  const result=await handleUserAdmin(new Request('https://packone.pro/v1/admin/users?summary_only=1'),query,undefined,{adminAuthUserId:ADMIN});
  assert.equal(calls.length,1);
  assert.match(calls[0],/WITH activity AS/);
  assert.equal(result.summary.total,5);
  assert.equal(result.users,undefined);
  assert.equal(result.play_activity,undefined);
});

test('account-only reads keep account summary but skip expensive play cohorts',async()=>{
  const calls=[];
  const query=async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('SELECT count(*)::int total FROM neon_auth."user" u'))return {rows:[{total:1}]};
    if(sql.includes('LIMIT 100 OFFSET $3'))return {rows:[]};
    return {rows:[{total:1}]};
  };
  const result=await handleUserAdmin(new Request('https://packone.pro/v1/admin/users?activity=0&page=1'),query,undefined,{adminAuthUserId:ADMIN});
  assert.equal(calls.length,3);
  assert.equal(calls.some(call=>call.sql.includes("'signed_out'")),false);
  assert.equal(result.play_activity,null);
  assert.equal(result.page,1);
  assert.equal(result.total_matching,1);
});
