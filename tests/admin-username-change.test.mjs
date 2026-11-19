import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAdminUsernameChange} from '../worker/admin-username-change.mjs';
import {handleUserAdmin} from '../worker/user-admin.mjs';

const ADMIN='11111111-1111-4111-8111-111111111111';
const TARGET='22222222-2222-4222-8222-222222222222';
const PLAYER='33333333-3333-4333-8333-333333333333';
const skipNotify=async()=>({status:'skipped',reason:'not_configured'});
const renameRequest=body=>new Request('https://packone.pro/v1/admin/users/'+TARGET+'/username',{
  method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body),
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
  const result=await handleAdminUsernameChange(request,query,undefined,{readJson:req=>req.json(),adminAuthUserId:ADMIN,notify:skipNotify});
  assert.equal(result.display_name,'New Name');
  assert.equal(result.username_owned,true);
  assert.deepEqual(calls[0].params,[TARGET,ADMIN,'New Name',true,'requested']);
});

test('admin username rename reuses prohibited-name and database conflict behavior',async()=>{
  const prohibited=new Request('https://packone.pro/v1/admin/users/'+TARGET+'/username',{
    method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:'Pack One Admin'}),
  });
  await assert.rejects(
    handleAdminUsernameChange(prohibited,async()=>{throw Error('must not query');},undefined,{readJson:req=>req.json(),adminAuthUserId:ADMIN,notify:skipNotify}),
    error=>error?.code==='USERNAME_NOT_ALLOWED',
  );

  const conflict=new Request('https://packone.pro/v1/admin/users/'+TARGET+'/username',{
    method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:'Already Taken'}),
  });
  await assert.rejects(
    handleAdminUsernameChange(conflict,async()=>{throw Object.assign(Error('players_username_uq'),{pgCode:'23505',pgConstraint:'players_username_uq'});},undefined,{readJson:req=>req.json(),adminAuthUserId:ADMIN,notify:skipNotify}),
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
      handleAdminUsernameChange(request,query,undefined,{readJson:req=>req.json(),adminAuthUserId:ADMIN,notify:skipNotify}),
      error=>error?.code===code,
    );
  }
});

test('admin username placeholder releases ownership through the same atomic function',async()=>{
  const calls=[];
  const query=async(sql,params)=>{
    calls.push({sql,params});
    return {rows:[{result_status:'renamed',player_id:PLAYER,previous_display_name:'Owned Name',new_display_name:'Pack Player',username_owned:'f'}],rowCount:1};
  };
  const request=new Request('https://packone.pro/v1/admin/users/'+TARGET+'/username',{
    method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:' Pack   Player '}),
  });
  const result=await handleAdminUsernameChange(request,query,undefined,{readJson:req=>req.json(),adminAuthUserId:ADMIN,notify:skipNotify});
  assert.equal(result.display_name,'Pack Player');
  assert.equal(result.username_owned,false);
  assert.deepEqual(calls[0].params,[TARGET,ADMIN,'Pack Player',false,null]);
});

test('admin username rejects unlinked accounts cleanly',async()=>{
  const request=new Request('https://packone.pro/v1/admin/users/'+TARGET+'/username',{
    method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:'Allowed Name'}),
  });
  await assert.rejects(
    handleAdminUsernameChange(request,async()=>({rows:[{result_status:'unlinked'}]}),undefined,{readJson:req=>req.json(),adminAuthUserId:ADMIN,notify:skipNotify}),
    error=>error?.status===409&&/linked public identity/i.test(error.message),
  );
});

test('a committed admin rename emails the verified address with both names and the reason',async()=>{
  const sql=[];let notice=null;
  const query=async(text,params)=>{
    sql.push({text,params});
    if(text.includes('pack1_admin_rename_public_username'))
      return {rows:[{result_status:'renamed',player_id:PLAYER,previous_display_name:'Old Name',new_display_name:'New Name',username_owned:'t'}],rowCount:1};
    if(text.includes('FROM neon_auth."user"'))return {rows:[{email:'target@example.test',email_verified:true}],rowCount:1};
    throw Error('unexpected SQL');
  };
  const notify=async options=>{notice={...options,email:await options.resolveEmail()};return {status:'sent'};};
  const result=await handleAdminUsernameChange(
    renameRequest({displayName:'New Name',reason:'impersonation'}),
    query,undefined,{readJson:req=>req.json(),adminAuthUserId:ADMIN,notify},
  );
  assert.deepEqual(result.notification,{status:'sent'});
  assert.equal(notice.kind,'admin_rename');
  assert.equal(notice.requested,true);
  assert.equal(notice.email,'target@example.test');
  assert.match(notice.message.text,/Previous username: Old Name/);
  assert.match(notice.message.text,/New username: New Name/);
  assert.match(notice.message.text,/Reason: impersonation/);
  // The rename commits before any email lookup.
  assert.match(sql[0].text,/pack1_admin_rename_public_username/);
  assert.deepEqual(sql[1].params,[TARGET]);
});

test('an unverified address is not used for the rename notice',async()=>{
  const query=async text=>{
    if(text.includes('pack1_admin_rename_public_username'))
      return {rows:[{result_status:'renamed',player_id:PLAYER,previous_display_name:'Old',new_display_name:'New Name',username_owned:'t'}],rowCount:1};
    return {rows:[{email:'unverified@example.test',email_verified:false}],rowCount:1};
  };
  let email='unset';
  const notify=async options=>{email=await options.resolveEmail();return {status:'skipped',reason:'no_verified_email'};};
  await handleAdminUsernameChange(renameRequest({displayName:'New Name'}),query,undefined,{readJson:req=>req.json(),adminAuthUserId:ADMIN,notify});
  assert.equal(email,null);
});

test('the admin can turn the rename notice off, and an unchanged name sends nothing',async()=>{
  const renamed=async()=>({rows:[{result_status:'renamed',player_id:PLAYER,previous_display_name:'Old',new_display_name:'New Name',username_owned:'t'}],rowCount:1});
  const seen=[];
  const notify=async options=>{seen.push(options.requested);return {status:'skipped',reason:'not_requested'};};
  const off=await handleAdminUsernameChange(
    renameRequest({displayName:'New Name',notifyUser:false}),
    renamed,undefined,{readJson:req=>req.json(),adminAuthUserId:ADMIN,notify},
  );
  assert.deepEqual(seen,[false]);
  assert.equal(off.notification.reason,'not_requested');

  const unchanged=async()=>({rows:[{result_status:'unchanged',player_id:PLAYER,previous_display_name:'Same',new_display_name:'Same',username_owned:'t'}],rowCount:1});
  const result=await handleAdminUsernameChange(
    renameRequest({displayName:'Same'}),
    unchanged,undefined,{readJson:req=>req.json(),adminAuthUserId:ADMIN,notify:async()=>{throw Error('must not notify');}},
  );
  assert.equal(result.changed,false);
  assert.deepEqual(result.notification,{status:'skipped',reason:'unchanged'});
});

test('the draft-run admin router no longer accepts renames',async()=>{
  await assert.rejects(
    handleUserAdmin(renameRequest({displayName:'New Name'}),async()=>{throw Error('must not query');},undefined,{readJson:req=>req.json(),adminAuthUserId:ADMIN}),
    error=>error?.status===405,
  );
});
