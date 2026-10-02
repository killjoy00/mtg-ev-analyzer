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


test('admin username rename normalizes through the shared helper and uses the atomic database function',async()=>{
  const calls=[];
  const query=async(sql,params)=>{
    calls.push({sql,params});
    assert.match(sql,/pack1_admin_rename_public_username/);
    return {rows:[{result_status:'renamed',player_id:PLAYER,previous_display_name:'Old Name',new_display_name:'New Name',username_owned:'t'}],rowCount:1};
  };
  const request=new Request('https://packone.pro/v1/admin/users/'+TARGET+'/username',{
    method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:'  New   Name  ',reason:'requested'}),
  });
  const result=await handleUserAdmin(request,query,undefined,{readJson:req=>req.json(),adminAuthUserId:ADMIN});
  assert.equal(result.display_name,'New Name');
  assert.equal(result.username_owned,true);
  assert.deepEqual(calls[0].params,[TARGET,ADMIN,'New Name',true,'requested']);
});

test('admin username rename reuses prohibited-name and database conflict behavior',async()=>{
  const prohibited=new Request('https://packone.pro/v1/admin/users/'+TARGET+'/username',{
    method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:'Pack One Admin'}),
  });
  await assert.rejects(
    handleUserAdmin(prohibited,async()=>{throw Error('must not query');},undefined,{readJson:req=>req.json(),adminAuthUserId:ADMIN}),
    error=>error?.code==='USERNAME_NOT_ALLOWED',
  );

  const conflict=new Request('https://packone.pro/v1/admin/users/'+TARGET+'/username',{
    method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:'Already Taken'}),
  });
  await assert.rejects(
    handleUserAdmin(conflict,async()=>{throw Object.assign(Error('players_username_uq'),{pgCode:'23505',pgConstraint:'players_username_uq'});},undefined,{readJson:req=>req.json(),adminAuthUserId:ADMIN}),
    error=>error?.status===409&&error?.code==='USERNAME_TAKEN',
  );
});

test('admin username rename surfaces moderation, deletion and public-placeholder boundaries',async()=>{
  for(const [status,code] of [
    ['moderated','PUBLIC_IDENTITY_MODERATED'],
    ['deleting','ACCOUNT_DELETING'],
    ['public_profile_requires_username','PUBLIC_PROFILE_REQUIRES_USERNAME'],
  ]) {
    const query=async()=>({rows:[{result_status:status,player_id:PLAYER,previous_display_name:'Old',new_display_name:'Old',username_owned:'t'}]});
    const request=new Request('https://packone.pro/v1/admin/users/'+TARGET+'/username',{
      method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:status==='public_profile_requires_username'?'Pack Player':'Allowed Name'}),
    });
    await assert.rejects(
      handleUserAdmin(request,query,undefined,{readJson:req=>req.json(),adminAuthUserId:ADMIN}),
      error=>error?.code===code,
    );
  }
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
