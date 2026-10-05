// End-to-end Public Identity / UGC safety gate against an isolated Neon branch.
// Usage: node tests/public-identity-backend-smoke.mjs /path/to/dev.connection --dev-fixtures
import fs from 'node:fs';
import assert from 'node:assert/strict';

if(!process.argv.includes('--dev-fixtures'))throw new Error('Use an isolated development database and --dev-fixtures.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();

const {default:growth,query}=await import('../worker/growth-function.js');
const {default:draftRun}=await import('../worker/draft-run-function.mjs');
const {beginAdminDeletion}=await import('../worker/account-deletion.mjs');
const {PUBLIC_IDENTITY_TERMS_VERSION}=await import('../worker/public-identity-safety.mjs');

const tag=crypto.randomUUID().slice(0,8);
const origin='https://packone.pro';

async function responseJson(response,status,path) {
  const data=await response.json();
  assert.equal(response.status,status,`${path}: ${JSON.stringify(data)}`);
  return data;
}

async function callGrowth(path,{body,playerToken,accountToken,method,status=200}={}) {
  const resolvedMethod=method||(body===undefined?'GET':'POST');
  const response=await growth.fetch(new Request(origin+path,{
    method:resolvedMethod,
    headers:{
      ...(body===undefined?{}:{'content-type':'application/json'}),
      ...(playerToken?{authorization:'Bearer '+playerToken}:{}),
      ...(accountToken?{'x-pack1-auth-session':accountToken}:{}),
    },
    body:body===undefined?undefined:JSON.stringify(body),
  }));
  return responseJson(response,status,path);
}

// Admin renames are served by pack1growth (it sends the account notice); the
// other admin user routes stay on the draft-run function.
async function callAdminRaw(path,{body,accountToken,method}={}) {
  const growthRoute=/\/username$/.test(path);
  const response=await (growthRoute?growth:draftRun).fetch(new Request(origin+path,{
    method:method||(body===undefined?'GET':'POST'),
    headers:{
      ...(growthRoute?{origin}:{}),
      ...(body===undefined?{}:{'content-type':'application/json'}),
      ...(accountToken?{'x-pack1-auth-session':accountToken}:{}),
    },
    body:body===undefined?undefined:JSON.stringify(body),
  }));
  return {status:response.status,data:await response.json()};
}

async function callAdmin(path,{body,accountToken,method,status=200}={}) {
  const result=await callAdminRaw(path,{body,accountToken,method});
  assert.equal(result.status,status,`${path}: ${JSON.stringify(result.data)}`);
  return result.data;
}

async function callAdminGrowth(path,{body,accountToken,method,status=200}={}) {
  const response=await growth.fetch(new Request(origin+path,{
    method:method||(body===undefined?'GET':'POST'),
    headers:{
      origin,
      ...(body===undefined?{}:{'content-type':'application/json'}),
      ...(accountToken?{'x-pack1-auth-session':accountToken}:{}),
    },
    body:body===undefined?undefined:JSON.stringify(body),
  }));
  return responseJson(response,status,path);
}

async function account(label) {
  const guest=await callGrowth('/v1/session',{body:{displayName:`QA PI ${label} ${tag}`}});
  const authId=crypto.randomUUID(),accountToken=crypto.randomUUID()+crypto.randomUUID();
  await query(
    'INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,true)',
    [authId,`QA PI ${label}`,`qa-pi-${label}-${tag}@example.invalid`],
  );
  await query(
    'INSERT INTO neon_auth.session(id,"userId",token,"updatedAt","expiresAt") VALUES($1::uuid,$2::uuid,$3,now(),now()+interval \'1 hour\')',
    [crypto.randomUUID(),authId,accountToken],
  );
  await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[authId,guest.playerId]);
  return {...guest,authId,accountToken};
}

const reporter=await account('reporter');
const target=await account('target');
const hideRaceTarget=await account('hide-race');
const deletionRaceTarget=await account('del-race');
const adminId=crypto.randomUUID(),adminToken=crypto.randomUUID()+crypto.randomUUID();

try {
  await query(
    'INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,true)',
    [adminId,'QA PI admin',`qa-pi-admin-${tag}@example.invalid`],
  );
  await query(
    'INSERT INTO neon_auth.session(id,"userId",token,"updatedAt","expiresAt") VALUES($1::uuid,$2::uuid,$3,now(),now()+interval \'1 hour\')',
    [crypto.randomUUID(),adminId,adminToken],
  );
  await query('INSERT INTO pack1_admins(auth_user_id) VALUES($1::uuid)',[adminId]);

  const reporterName=`PI Reporter ${tag}`;
  let targetName=`PI Target ${tag}`;
  const unauthRename=await callAdmin(`/v1/admin/users/${target.authId}/username`,{
    method:'PATCH',status:401,body:{displayName:'Denied Rename'},
  });
  assert.match(unauthRename.error,/session/i);
  const nonAdminRename=await callAdmin(`/v1/admin/users/${target.authId}/username`,{
    method:'PATCH',accountToken:target.accountToken,status:403,body:{displayName:'Denied Rename'},
  });
  assert.match(nonAdminRename.error,/admin access/i);
  const unauthDelete=await callAdminGrowth(`/v1/admin/users/${target.authId}/delete`,{
    status:401,body:{confirm:'DELETE'},
  });
  assert.match(unauthDelete.error,/session/i);
  const nonAdminDelete=await callAdminGrowth(`/v1/admin/users/${target.authId}/delete`,{
    accountToken:target.accountToken,status:403,body:{confirm:'DELETE'},
  });
  assert.match(nonAdminDelete.error,/admin access/i);
  const prohibited=await callGrowth('/v1/profile',{
    method:'PATCH',playerToken:target.token,accountToken:target.accountToken,status:400,
    body:{displayName:'Pack One Support'},
  });
  assert.equal(prohibited.code,'USERNAME_NOT_ALLOWED','server rejects prohibited public identity before publication');
  assert.equal((await query('SELECT public_identity_terms_accepted_at FROM players WHERE id=$1::uuid',[target.playerId])).rows[0].public_identity_terms_accepted_at,null,'failed prohibited publication does not record terms acceptance');
  await callGrowth('/v1/profile',{
    method:'PATCH',playerToken:reporter.token,accountToken:reporter.accountToken,
    body:{displayName:reporterName},
  });
  const published=await callGrowth('/v1/profile',{
    method:'PATCH',playerToken:target.token,accountToken:target.accountToken,
    body:{displayName:targetName,profilePublic:true},
  });
  const key=published.player.profile_key;
  assert.match(key,/^[a-f0-9]{16}$/);
  // Saving a name next to the rules notice records acceptance; no checkbox flag.
  assert.equal(published.player.public_identity_terms_current,true);
  assert.equal((await query('SELECT public_identity_terms_version FROM players WHERE id=$1::uuid',[target.playerId])).rows[0].public_identity_terms_version,PUBLIC_IDENTITY_TERMS_VERSION);

  const authNameBefore=(await query('SELECT name FROM neon_auth."user" WHERE id=$1::uuid',[target.authId])).rows[0].name;
  const termsBefore=(await query(
    'SELECT public_identity_terms_version,public_identity_terms_accepted_at,profile_public FROM players WHERE id=$1::uuid',
    [target.playerId],
  )).rows[0];

  // Force the audit INSERT to fail after the rename UPDATE starts. PostgreSQL
  // must roll the entire function statement back, proving rename + audit are atomic.
  const auditFailFunction=`qa_fail_rename_audit_${tag}`;
  const auditFailTrigger=`qa_fail_rename_audit_trigger_${tag}`;
  await query(`CREATE FUNCTION ${auditFailFunction}() RETURNS trigger LANGUAGE plpgsql AS $qa$
    BEGIN
      IF NEW.action='rename' AND NEW.reason='QA force audit rollback' THEN
        RAISE EXCEPTION 'QA forced rename audit failure';
      END IF;
      RETURN NEW;
    END
  $qa$;`);
  await query(`CREATE TRIGGER ${auditFailTrigger}
    BEFORE INSERT ON public_identity_moderation_actions
    FOR EACH ROW EXECUTE FUNCTION ${auditFailFunction}()`);
  try {
    const failedRename=await callAdminRaw(`/v1/admin/users/${target.authId}/username`,{
      method:'PATCH',accountToken:adminToken,
      body:{displayName:`PI Rollback ${tag}`,reason:'QA force audit rollback'},
    });
    assert.equal(failedRename.status,500,JSON.stringify(failedRename.data));
    const rolledBack=(await query(
      'SELECT display_name,username_owned,profile_public FROM players WHERE id=$1::uuid',
      [target.playerId],
    )).rows[0];
    assert.equal(rolledBack.display_name,`PI Target ${tag}`,'failed audit insert rolls back the player rename');
    assert.equal(rolledBack.username_owned===true||rolledBack.username_owned==='t',true);
    assert.equal(rolledBack.profile_public===true||rolledBack.profile_public==='t',true);
    assert.equal(Number((await query(
      "SELECT count(*)::int n FROM public_identity_moderation_actions WHERE target_player_id=$1::uuid AND reason='QA force audit rollback'",
      [target.playerId],
    )).rows[0].n),0,'failed audit insert leaves no partial audit row');
  } finally {
    await query(`DROP TRIGGER IF EXISTS ${auditFailTrigger} ON public_identity_moderation_actions`);
    await query(`DROP FUNCTION IF EXISTS ${auditFailFunction}()`);
  }

  const renamedName=`PI Renamed ${tag}`;
  const renamed=await callAdmin(`/v1/admin/users/${target.authId}/username`,{
    method:'PATCH',accountToken:adminToken,body:{displayName:`  PI   Renamed ${tag}  `,reason:'QA admin rename'},
  });
  assert.equal(renamed.display_name,renamedName);
  assert.equal(renamed.username_owned,true);
  assert.ok(['sent','skipped','failed'].includes(renamed.notification?.status),'admin rename reports the account notice outcome');
  const draftRename=await draftRun.fetch(new Request(origin+`/v1/admin/users/${target.authId}/username`,{
    method:'PATCH',
    headers:{'content-type':'application/json','x-pack1-auth-session':adminToken},
    body:JSON.stringify({displayName:`PI Draft Path ${tag}`}),
  }));
  assert.equal(draftRename.status,405,'draft-run no longer accepts admin renames that would skip the account notice');
  targetName=renamedName;
  const renameRow=(await query(
    'SELECT display_name,username_owned,profile_public,public_identity_terms_version,public_identity_terms_accepted_at FROM players WHERE id=$1::uuid',
    [target.playerId],
  )).rows[0];
  assert.equal(renameRow.display_name,renamedName);
  assert.equal(renameRow.username_owned===true||renameRow.username_owned==='t',true);
  assert.equal(renameRow.profile_public,termsBefore.profile_public,'admin rename preserves public-profile publication');
  assert.equal(renameRow.public_identity_terms_version,termsBefore.public_identity_terms_version,'admin rename does not record target terms acceptance');
  assert.equal(String(renameRow.public_identity_terms_accepted_at),String(termsBefore.public_identity_terms_accepted_at),'admin rename preserves target terms timestamp');
  assert.equal((await query('SELECT name FROM neon_auth."user" WHERE id=$1::uuid',[target.authId])).rows[0].name,authNameBefore,'admin rename does not change Auth account name');
  const audit=(await query(
    "SELECT action,reason,previous_display_name,new_display_name,target_auth_user_id::text target_auth_user_id,admin_auth_user_id::text admin_auth_user_id FROM public_identity_moderation_actions WHERE target_player_id=$1::uuid AND action='rename' ORDER BY id DESC LIMIT 1",
    [target.playerId],
  )).rows[0];
  assert.deepEqual(audit,{
    action:'rename',reason:'QA admin rename',previous_display_name:`PI Target ${tag}`,new_display_name:renamedName,
    target_auth_user_id:target.authId,admin_auth_user_id:adminId,
  });
  const duplicate=await callAdmin(`/v1/admin/users/${target.authId}/username`,{
    method:'PATCH',accountToken:adminToken,status:409,body:{displayName:'  '+reporterName.toUpperCase().replaceAll(' ','   ')+'  '},
  });
  assert.equal(duplicate.code,'USERNAME_TAKEN');
  const releaseWhilePublic=await callAdmin(`/v1/admin/users/${target.authId}/username`,{
    method:'PATCH',accountToken:adminToken,status:409,body:{displayName:'Pack Player'},
  });
  assert.equal(releaseWhilePublic.code,'PUBLIC_PROFILE_REQUIRES_USERNAME');

  // Rename versus hide is serialized by the player row lock. Either rename
  // commits first and hide removes publication, or hide wins and rename sees
  // the moderated state. The final identity must always be hidden.
  await callGrowth('/v1/profile',{
    method:'PATCH',playerToken:hideRaceTarget.token,accountToken:hideRaceTarget.accountToken,
    body:{displayName:`PI Hide Race ${tag}`,profilePublic:true},
  });
  const [renameVsHide,hideVsRename]=await Promise.all([
    callAdminRaw(`/v1/admin/users/${hideRaceTarget.authId}/username`,{
      method:'PATCH',accountToken:adminToken,
      body:{displayName:`PI Hide Renamed ${tag}`,reason:'QA rename-hide race'},
    }),
    callAdminRaw(`/v1/admin/users/${hideRaceTarget.authId}/public-identity`,{
      accountToken:adminToken,
      body:{action:'hide',reason:'QA rename-hide race'},
    }),
  ]);
  assert.equal(hideVsRename.status,200,JSON.stringify(hideVsRename.data));
  assert.ok([200,403].includes(renameVsHide.status),JSON.stringify(renameVsHide.data));
  if(renameVsHide.status===403)assert.equal(renameVsHide.data.code,'PUBLIC_IDENTITY_MODERATED');
  const hideRaceFinal=(await query(
    'SELECT username_owned,profile_public,public_identity_hidden_at FROM players WHERE id=$1::uuid',
    [hideRaceTarget.playerId],
  )).rows[0];
  assert.ok(hideRaceFinal.public_identity_hidden_at,'rename/hide race must finish hidden');
  assert.equal(hideRaceFinal.username_owned===true||hideRaceFinal.username_owned==='t',false);
  assert.equal(hideRaceFinal.profile_public===true||hideRaceFinal.profile_public==='t',false);
  assert.equal(Number((await query(
    "SELECT count(*)::int n FROM public_identity_moderation_actions WHERE target_player_id=$1::uuid AND action='hide'",
    [hideRaceTarget.playerId],
  )).rows[0].n),1);
  const hideRaceRenameCount=Number((await query(
    "SELECT count(*)::int n FROM public_identity_moderation_actions WHERE target_player_id=$1::uuid AND action='rename' AND reason='QA rename-hide race'",
    [hideRaceTarget.playerId],
  )).rows[0].n);
  assert.equal(hideRaceRenameCount,renameVsHide.status===200?1:0,
    'rename/hide audit outcome must match the serialized winner');

  // Rename versus admin deletion shares the per-Auth advisory lock. Rename can
  // commit completely before the tombstone, or deletion wins and rename must
  // reject without an audit row.
  await callGrowth('/v1/profile',{
    method:'PATCH',playerToken:deletionRaceTarget.token,accountToken:deletionRaceTarget.accountToken,
    body:{displayName:`PI Del Race ${tag}`,profilePublic:false},
  });
  const [renameVsDelete,deleteVsRename]=await Promise.all([
    callAdminRaw(`/v1/admin/users/${deletionRaceTarget.authId}/username`,{
      method:'PATCH',accountToken:adminToken,
      body:{displayName:`PI Del Rename ${tag}`,reason:'QA rename-delete race'},
    }),
    beginAdminDeletion(query,{
      authUserId:deletionRaceTarget.authId,
      adminAuthUserId:adminId,
      reason:'QA rename-delete race',
      acknowledgeAdmin:false,
    }),
  ]);
  assert.equal(deleteVsRename.start_status,'created');
  assert.ok([200,409].includes(renameVsDelete.status),JSON.stringify(renameVsDelete.data));
  if(renameVsDelete.status===409)assert.equal(renameVsDelete.data.code,'ACCOUNT_DELETING');
  const deleteRaceOperation=(await query(
    'SELECT operation_id::text operation_id FROM account_deletion_operations WHERE auth_user_id=$1::uuid',
    [deletionRaceTarget.authId],
  )).rows[0];
  assert.equal(deleteRaceOperation.operation_id,deleteVsRename.operation_id);
  const deleteRaceAudit=(await query(
    "SELECT id FROM public_identity_moderation_actions WHERE target_player_id=$1::uuid AND action='rename' AND reason='QA rename-delete race' ORDER BY id DESC LIMIT 1",
    [deletionRaceTarget.playerId],
  )).rows[0]||null;
  assert.equal(Boolean(deleteRaceAudit),renameVsDelete.status===200,
    'rename/deletion audit outcome must match the serialized winner');

  // Keep one durable gameplay record so moderation can prove it only affects
  // public identity, never career/game history.
  await query(
    `INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json)
     VALUES($1::uuid,current_date,'qa-public-identity','top3',87,'B','[]'::jsonb)`,
    [target.playerId],
  );
  const scoreBefore=Number((await query('SELECT count(*) n FROM scores WHERE player_id=$1::uuid',[target.playerId])).rows[0].n);
  const publishedCreatorChallenge=crypto.randomUUID(),draftCreatorChallenge=crypto.randomUUID();
  const publishingCreatorChallenge=crypto.randomUUID(),publishingOperation=crypto.randomUUID();
  await query(`INSERT INTO creator_challenges(
      id,slug,source_session_id,source_owner_player_id,source_owner_auth_user_id,
      source_type,source_day,source_environment,creator_public_name,creator_handle,headline,
      creator_post_run_note,acquisition_source,acquisition_campaign,status,
      created_by_admin_auth_user_id,published_at,publication_operation_ref,publication_detail
    ) VALUES
      ($1::uuid,$2,NULL,$3::uuid,$4::uuid,'practice',NULL,'mixed',$5,'@target','Beat the target',
       'Creator note','creator',$2,'published',$6::uuid,now(),NULL,'{"live_verified":true}'::jsonb),
      ($7::uuid,$8,NULL,$3::uuid,$4::uuid,'practice',NULL,'mixed',$5,'@target','Draft creator challenge',
       'Draft note','creator',$8,'draft',$6::uuid,NULL,NULL,'{}'::jsonb),
      ($9::uuid,$10,NULL,$3::uuid,$4::uuid,'practice',NULL,'mixed',$5,'@target','Publishing creator challenge',
       'Publishing note','creator',$10,'publishing',$6::uuid,NULL,$11::uuid,
       jsonb_build_object(
         'action','publish','dispatch',jsonb_build_object('state','accepted','attempts',1),
         'live_verified',false
       ))`,[
    publishedCreatorChallenge,`pi-published-${tag}`,target.playerId,target.authId,targetName,adminId,
    draftCreatorChallenge,`pi-draft-${tag}`,
    publishingCreatorChallenge,`pi-publishing-${tag}`,publishingOperation,
  ]);

  const firstReport=await callGrowth(`/v1/profile/${key}/report`,{
    playerToken:reporter.token,accountToken:reporter.accountToken,
    body:{reason:'harassment',details:'QA contextual identity report'},
  });
  assert.ok(firstReport.report_id);
  const secondReport=await callGrowth(`/v1/profile/${key}/report`,{
    playerToken:reporter.token,accountToken:reporter.accountToken,
    body:{reason:'impersonation',details:'QA updated report detail'},
  });
  assert.equal(secondReport.report_id,firstReport.report_id,'repeat report updates the one open report instead of spamming rows');
  let reports=(await query(
    'SELECT reason,details,status FROM public_identity_reports WHERE reporter_player_id=$1::uuid AND target_player_id=$2::uuid',
    [reporter.playerId,target.playerId],
  )).rows;
  assert.equal(reports.length,1);
  assert.deepEqual(reports[0],{reason:'impersonation',details:'QA updated report detail',status:'open'});

  await callGrowth(`/v1/profile/${key}/block`,{
    playerToken:reporter.token,accountToken:reporter.accountToken,body:{},
  });
  assert.equal(Number((await query(
    'SELECT count(*) n FROM public_identity_blocks WHERE blocker_player_id=$1::uuid AND target_player_id=$2::uuid',
    [reporter.playerId,target.playerId],
  )).rows[0].n),1);
  await callGrowth(`/v1/profile/${key}`,{playerToken:reporter.token,status:404});
  const anonymousView=await callGrowth(`/v1/profile/${key}`);
  assert.equal(anonymousView.player.display_name,targetName,'blocking is viewer-specific, not a global takedown');

  const hidden=await callAdmin(`/v1/admin/users/${target.authId}/public-identity`,{
    accountToken:adminToken,
    body:{action:'hide',reason:'QA moderation hide'},
  });
  assert.equal(hidden.action,'hide');
  assert.equal(hidden.player_id,target.playerId);

  const hiddenRow=(await query(
    'SELECT username_owned,profile_public,public_identity_hidden_at,public_identity_hidden_reason FROM players WHERE id=$1::uuid',
    [target.playerId],
  )).rows[0];
  assert.equal(hiddenRow.username_owned===true||hiddenRow.username_owned==='t',false);
  assert.equal(hiddenRow.profile_public===true||hiddenRow.profile_public==='t',false);
  assert.ok(hiddenRow.public_identity_hidden_at);
  assert.equal(hiddenRow.public_identity_hidden_reason,'QA moderation hide');

  const creatorPrivacyRows=(await query(`SELECT id::text id,status,creator_public_name,creator_handle,headline,
      creator_post_run_note,source_owner_auth_user_id::text source_owner_auth_user_id,
      privacy_removed_at,publication_operation_ref::text publication_operation_ref,publication_detail
    FROM creator_challenges WHERE id IN ($1::uuid,$2::uuid,$3::uuid) ORDER BY id`,[
    publishedCreatorChallenge,draftCreatorChallenge,publishingCreatorChallenge,
  ])).rows;
  const creatorPrivacyById=new Map(creatorPrivacyRows.map(row=>[row.id,row]));
  for(const challengeId of [publishedCreatorChallenge,draftCreatorChallenge,publishingCreatorChallenge]) {
    const row=creatorPrivacyById.get(challengeId);
    assert.equal(row.status,'retired');
    assert.equal(row.creator_public_name,'A creator');
    assert.equal(row.creator_handle,null);
    assert.equal(row.headline,'Creator challenge unavailable');
    assert.equal(row.creator_post_run_note,null);
    assert.equal(row.source_owner_auth_user_id,null);
    assert.ok(row.privacy_removed_at,'moderation scrubs dynamic creator identity immediately');
    assert.equal(row.publication_operation_ref,null,'moderation never blocks on or starts GitHub publication synchronously');
  }
  const publishedPrivacyRaw=creatorPrivacyById.get(publishedCreatorChallenge).publication_detail;
  const draftPrivacyRaw=creatorPrivacyById.get(draftCreatorChallenge).publication_detail;
  const publishingPrivacyRaw=creatorPrivacyById.get(publishingCreatorChallenge).publication_detail;
  const publishedPrivacy=typeof publishedPrivacyRaw==='string'?JSON.parse(publishedPrivacyRaw):publishedPrivacyRaw;
  const draftPrivacy=typeof draftPrivacyRaw==='string'?JSON.parse(draftPrivacyRaw):draftPrivacyRaw;
  const publishingPrivacy=typeof publishingPrivacyRaw==='string'?JSON.parse(publishingPrivacyRaw):publishingPrivacyRaw;
  assert.equal(publishedPrivacy.action,'retire');
  assert.equal(publishedPrivacy.reason,'public_identity_hidden');
  assert.equal(publishedPrivacy.live_verified,false);
  assert.equal(publishedPrivacy.static_cleanup,'required');
  assert.equal(publishedPrivacy.dispatch.state,'pending',
    'a previously published creator route is queued for resumable protected retirement');
  assert.equal(draftPrivacy.live_verified,true);
  assert.equal(draftPrivacy.static_cleanup,'not_required',
    'an unpublished draft is privacy-complete without waiting for a static page that never existed');
  assert.equal(publishingPrivacy.action,'retire');
  assert.equal(publishingPrivacy.live_verified,false);
  assert.equal(publishingPrivacy.static_cleanup,'required');
  assert.equal(publishingPrivacy.dispatch.state,'pending',
    'privacy retirement preserves static-cleanup work when an accepted publish may still land after moderation');

  const renameHidden=await callAdmin(`/v1/admin/users/${target.authId}/username`,{
    method:'PATCH',accountToken:adminToken,status:403,body:{displayName:'Cannot Rename Hidden'},
  });
  assert.equal(renameHidden.code,'PUBLIC_IDENTITY_MODERATED');
  reports=(await query(
    'SELECT status,resolved_by::text resolved_by,resolved_at FROM public_identity_reports WHERE reporter_player_id=$1::uuid AND target_player_id=$2::uuid',
    [reporter.playerId,target.playerId],
  )).rows;
  assert.equal(reports[0].status,'resolved');
  assert.equal(reports[0].resolved_by,adminId);
  assert.ok(reports[0].resolved_at);
  assert.equal(Number((await query('SELECT count(*) n FROM scores WHERE player_id=$1::uuid',[target.playerId])).rows[0].n),scoreBefore,'moderation preserves gameplay history');
  assert.equal(Number((await query(
    "SELECT count(*) n FROM public_identity_moderation_actions WHERE target_player_id=$1::uuid AND admin_auth_user_id=$2::uuid AND action='hide'",
    [target.playerId,adminId],
  )).rows[0].n),1);
  await callGrowth(`/v1/profile/${key}`,{status:404});

  const denied=await callGrowth('/v1/profile',{
    method:'PATCH',playerToken:target.token,accountToken:target.accountToken,status:403,
    body:{displayName:targetName,profilePublic:true},
  });
  assert.equal(denied.code,'PUBLIC_IDENTITY_MODERATED','hidden identity cannot immediately republish');

  const restored=await callAdmin(`/v1/admin/users/${target.authId}/public-identity`,{
    accountToken:adminToken,
    body:{action:'restore',reason:'QA moderation restore'},
  });
  assert.equal(restored.action,'restore');
  const restoredRow=(await query(
    'SELECT username_owned,profile_public,public_identity_hidden_at FROM players WHERE id=$1::uuid',
    [target.playerId],
  )).rows[0];
  assert.equal(restoredRow.public_identity_hidden_at,null);
  assert.equal(restoredRow.username_owned===true||restoredRow.username_owned==='t',false);
  assert.equal(restoredRow.profile_public===true||restoredRow.profile_public==='t',false);
  await callGrowth(`/v1/profile/${key}`,{status:404});
  assert.equal(Number((await query(
    "SELECT count(*) n FROM public_identity_moderation_actions WHERE target_player_id=$1::uuid AND admin_auth_user_id=$2::uuid AND action='restore'",
    [target.playerId,adminId],
  )).rows[0].n),1);
  // Sign-in normally claims a free nickname, but never re-owns a restored one.
  const relinked=await callGrowth('/v1/account/link',{playerToken:target.token,accountToken:target.accountToken,body:{}});
  assert.equal(relinked.rankingIdentity.eligible,false,'signing in again does not re-own a restored identity');
  const relinkedRow=(await query('SELECT username_owned FROM players WHERE id=$1::uuid',[target.playerId])).rows[0];
  assert.equal(relinkedRow.username_owned===true||relinkedRow.username_owned==='t',false);

  const republished=await callGrowth('/v1/profile',{
    method:'PATCH',playerToken:target.token,accountToken:target.accountToken,
    body:{displayName:targetName,profilePublic:true},
  });
  assert.equal(republished.player.username_owned,true);
  assert.equal(republished.player.profile_public,true);
  assert.equal((await callGrowth(`/v1/profile/${key}`)).player.display_name,targetName);

  console.log('PASS: Public Identity rename/audit/search rules, report/block persistence, authenticated moderation, gameplay preservation, republish prevention, restore, and explicit republish.');
} finally {
  // The backend gate uses a disposable branch, but leave fixtures tidy so this
  // test is safe to rerun within the same branch.
  await query('DELETE FROM account_deletion_operations WHERE auth_user_id=$1::uuid',[deletionRaceTarget.authId]).catch(()=>{});
  await query('DELETE FROM pack1_admins WHERE auth_user_id=$1::uuid',[adminId]).catch(()=>{});
  await query('DELETE FROM neon_auth.session WHERE token IN ($1,$2,$3,$4,$5)',[
    reporter.accountToken,target.accountToken,hideRaceTarget.accountToken,deletionRaceTarget.accountToken,adminToken,
  ]).catch(()=>{});
  await query('DELETE FROM neon_auth."user" WHERE id IN ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid)',[
    reporter.authId,target.authId,hideRaceTarget.authId,deletionRaceTarget.authId,adminId,
  ]).catch(()=>{});
}
