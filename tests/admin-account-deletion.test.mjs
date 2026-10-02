import test from 'node:test';
import assert from 'node:assert/strict';

import {adminDeletionStatus,handleAdminAccountDeletion} from '../worker/admin-account-deletion.mjs';

const ADMIN='11111111-1111-4111-8111-111111111111';
const TARGET='22222222-2222-4222-8222-222222222222';
const PLAYER='33333333-3333-4333-8333-333333333333';
const OP='44444444-4444-4444-8444-444444444444';

const request=(path,{method='GET',body}={})=>new Request('https://packone.pro'+path,{
  method,
  headers:{'content-type':'application/json'},
  body:body===undefined?undefined:JSON.stringify(body),
});
const readJson=req=>req.json();
const row=(overrides={})=>({
  operation_id:OP,
  auth_user_id:TARGET,
  player_id:PLAYER,
  state:'provider_delete_pending',
  attempts:'2',
  last_error_code:'PROVIDER_TIMEOUT',
  created_at:'2026-10-02T10:00:00Z',
  updated_at:'2026-10-02T10:01:00Z',
  app_cleanup_completed_at:'2026-10-02T10:00:30Z',
  provider_deleted_at:null,
  completed_at:null,
  initiation_source:'admin',
  initiated_by_admin_auth_user_id:ADMIN,
  deletion_reason:'temporary operator context',
  target_was_admin:'f',
  ...overrides,
});

test('admin deletion status exposes bounded operational fields but not free-text reason',()=>{
  const view=adminDeletionStatus(row({last_error_code:'bad error text'}));
  assert.equal(view.operation_id,OP);
  assert.equal(view.initiation_source,'admin');
  assert.equal(view.initiated_by_admin_auth_user_id,ADMIN);
  assert.equal(view.attempts,2);
  assert.equal(view.error_code,null);
  assert.match(view.message,/provider deletion/i);
  assert.equal('deletion_reason' in view,false);
});

test('status remains readable from the retained operation after target account cleanup',async()=>{
  let sawOperation=false;
  const query=async(sql,params)=>{
    assert.deepEqual(params,[TARGET]);
    assert.doesNotMatch(sql,/neon_auth\."user"/);
    sawOperation=true;
    return {rows:[row()],rowCount:1};
  };
  const result=await handleAdminAccountDeletion(
    request('/v1/admin/users/'+TARGET+'/deletion'),
    query,
    undefined,
    {readJson,adminAuthUserId:ADMIN,deletionEnabled:()=>true,resumeDeletionOperation:async x=>x},
  );
  assert.equal(sawOperation,true);
  assert.equal(result.status,200);
  assert.equal(result.body.deletion.operation_id,OP);
});

test('admin deletion requires literal destructive confirmation and prohibits self-delete before mutation',async()=>{
  const noQuery=async()=>{throw Error('must not query');};
  await assert.rejects(
    handleAdminAccountDeletion(
      request('/v1/admin/users/'+ADMIN+'/delete',{method:'POST',body:{confirm:'DELETE'}}),
      noQuery,undefined,{readJson,adminAuthUserId:ADMIN,deletionEnabled:()=>true,resumeDeletionOperation:async x=>x},
    ),
    error=>error?.code==='ADMIN_SELF_DELETE',
  );
  await assert.rejects(
    handleAdminAccountDeletion(
      request('/v1/admin/users/'+TARGET+'/delete',{method:'POST',body:{confirm:'delete'}}),
      noQuery,undefined,{readJson,adminAuthUserId:ADMIN,deletionEnabled:()=>true,resumeDeletionOperation:async x=>x},
    ),
    error=>error?.code==='DELETE_CONFIRMATION',
  );
});

test('target-admin acknowledgement is enforced by the atomic database initializer',async()=>{
  const query=async(sql)=>{
    if(sql.includes('SELECT email FROM neon_auth."user"'))return {rows:[{email:'target@example.test'}],rowCount:1};
    if(sql.includes('pack1_begin_admin_account_deletion'))return {rows:[{start_status:'admin_ack_required'}],rowCount:1};
    throw Error('unexpected SQL');
  };
  await assert.rejects(
    handleAdminAccountDeletion(
      request('/v1/admin/users/'+TARGET+'/delete',{method:'POST',body:{confirm:'DELETE'}}),
      query,undefined,{readJson,adminAuthUserId:ADMIN,deletionEnabled:()=>true,resumeDeletionOperation:async x=>x},
    ),
    error=>error?.code==='ADMIN_TARGET_CONFIRMATION',
  );
});

test('admin initiation needs no target credential and runs the supplied complete deletion lifecycle',async()=>{
  const calls=[];let resumed=null;
  const created=row({state:'pending',attempts:'0',last_error_code:null,app_cleanup_completed_at:null,deletion_reason:'spam cleanup'});
  const query=async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.includes('SELECT email FROM neon_auth."user"'))return {rows:[{email:'target@example.test'}],rowCount:1};
    if(sql.includes('pack1_begin_admin_account_deletion'))return {rows:[{start_status:'created',...created}],rowCount:1};
    throw Error('unexpected SQL');
  };
  const result=await handleAdminAccountDeletion(
    request('/v1/admin/users/'+TARGET+'/delete',{method:'POST',body:{confirm:'DELETE',reason:'spam cleanup'}}),
    query,undefined,{
      readJson,adminAuthUserId:ADMIN,deletionEnabled:()=>true,
      resumeDeletionOperation:async(operation,options)=>{
        resumed={operation,options};
        return row({state:'complete',last_error_code:null,completed_at:'2026-10-02T10:02:00Z',deletion_reason:null});
      },
    },
  );
  assert.equal(result.status,200);
  assert.equal(result.body.deletion,'complete');
  assert.equal(resumed.operation.initiation_source,'admin');
  assert.equal(resumed.operation.initiated_by_admin_auth_user_id,ADMIN);
  assert.equal(resumed.options.knownEmail,'target@example.test');
  assert.equal(calls.some(call=>/verify-password|account_deletion_verifications|account_credential_rate_limits|neon_auth\.account/i.test(call.sql)),false);
});

test('admin deletion lifecycle failures propagate after the durable start so normal route logging can report them',async()=>{
  const created=row({state:'pending',attempts:'0',last_error_code:null,app_cleanup_completed_at:null});
  const query=async(sql)=>{
    if(sql.includes('SELECT email FROM neon_auth."user"'))return {rows:[{email:'target@example.test'}],rowCount:1};
    if(sql.includes('pack1_begin_admin_account_deletion'))return {rows:[{start_status:'created',...created}],rowCount:1};
    if(sql.includes('FROM account_deletion_operations WHERE auth_user_id='))return {rows:[created],rowCount:1};
    throw Error('unexpected SQL');
  };
  const logged=[];const originalError=console.error;console.error=(...args)=>logged.push(args.join(' '));
  try {
    await assert.rejects(
      handleAdminAccountDeletion(
        request('/v1/admin/users/'+TARGET+'/delete',{method:'POST',body:{confirm:'DELETE'}}),
        query,undefined,{
          readJson,adminAuthUserId:ADMIN,deletionEnabled:()=>true,
          resumeDeletionOperation:async()=>{throw Object.assign(Error('synthetic resume failure'),{code:'PROVIDER_NETWORK'});},
        },
      ),
      error=>{
        assert.equal(error?.code,'PROVIDER_NETWORK');
        assert.equal(error?.deletionCommitted,true);
        assert.equal(error?.operationId,OP);
        assert.equal(error?.deletion?.operation_id,OP);
        assert.equal(error?.deletion?.state,'pending');
        assert.equal('deletion_reason' in error.deletion,false);
        return true;
      },
    );
  } finally {
    console.error=originalError;
  }
  assert.match(logged.join('\n'),/admin_account_deletion_resume_error/);
  assert.match(logged.join('\n'),/PROVIDER_NETWORK/);
});

test('retrying an existing self-service operation preserves its original attribution',async()=>{
  const existing=row({state:'provider_delete_pending',initiation_source:'self_service',initiated_by_admin_auth_user_id:null,target_was_admin:false});
  const query=async(sql)=>{
    if(sql.includes('SELECT email FROM neon_auth."user"'))return {rows:[],rowCount:0};
    if(sql.includes('pack1_begin_admin_account_deletion'))return {rows:[{start_status:'existing',...existing}],rowCount:1};
    throw Error('unexpected SQL');
  };
  const result=await handleAdminAccountDeletion(
    request('/v1/admin/users/'+TARGET+'/delete',{method:'POST',body:{confirm:'DELETE'}}),
    query,undefined,{readJson,adminAuthUserId:ADMIN,deletionEnabled:()=>true,resumeDeletionOperation:async x=>x},
  );
  assert.equal(result.status,202);
  assert.equal(result.body.operation.initiation_source,'self_service');
  assert.equal(result.body.operation.initiated_by_admin_auth_user_id,null);
});


test('admin deletion rejects malformed and unknown target identities',async()=>{
  await assert.rejects(
    handleAdminAccountDeletion(
      request('/v1/admin/users/aaaaaaaa-aaaa-0aaa-aaaa-aaaaaaaaaaaa/delete',{method:'POST',body:{confirm:'DELETE'}}),
      async()=>{throw Error('must not query');},undefined,
      {readJson,adminAuthUserId:ADMIN,deletionEnabled:()=>true,resumeDeletionOperation:async x=>x},
    ),
    error=>error?.status===400,
  );
  const query=async(sql)=>{
    if(sql.includes('SELECT email FROM neon_auth."user"'))return {rows:[],rowCount:0};
    if(sql.includes('pack1_begin_admin_account_deletion'))return {rows:[{start_status:'unknown_target'}],rowCount:1};
    throw Error('unexpected SQL');
  };
  await assert.rejects(
    handleAdminAccountDeletion(
      request('/v1/admin/users/'+TARGET+'/delete',{method:'POST',body:{confirm:'DELETE'}}),
      query,undefined,{readJson,adminAuthUserId:ADMIN,deletionEnabled:()=>true,resumeDeletionOperation:async x=>x},
    ),
    error=>error?.status===404,
  );
});
