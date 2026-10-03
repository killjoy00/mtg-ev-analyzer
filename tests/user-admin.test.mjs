import test from 'node:test';
import assert from 'node:assert/strict';
import {handleUserAdmin,userAdminFilters} from '../worker/user-admin.mjs';

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
