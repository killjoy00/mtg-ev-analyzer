// End-to-end Public Identity / UGC safety gate against an isolated Neon branch.
// Usage: node tests/public-identity-backend-smoke.mjs /path/to/dev.connection --dev-fixtures
import fs from 'node:fs';
import assert from 'node:assert/strict';

if(!process.argv.includes('--dev-fixtures'))throw new Error('Use an isolated development database and --dev-fixtures.');
process.env.DATABASE_URL=fs.readFileSync(process.argv[2],'utf8').trim();

const {default:growth,query}=await import('../worker/growth-function.js');
const {default:draftRun}=await import('../worker/draft-run-function.mjs');
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

async function callAdmin(path,{body,accountToken,method,status=200}={}) {
  const response=await draftRun.fetch(new Request(origin+path,{
    method:method||(body===undefined?'GET':'POST'),
    headers:{
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
  const renamedName=`PI Renamed ${tag}`;
  const renamed=await callAdmin(`/v1/admin/users/${target.authId}/username`,{
    method:'PATCH',accountToken:adminToken,body:{displayName:`  PI   Renamed ${tag}  `,reason:'QA admin rename'},
  });
  assert.equal(renamed.display_name,renamedName);
  assert.equal(renamed.username_owned,true);
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
    method:'PATCH',accountToken:adminToken,status:409,body:{displayName:reporterName},
  });
  assert.equal(duplicate.code,'USERNAME_TAKEN');
  const releaseWhilePublic=await callAdmin(`/v1/admin/users/${target.authId}/username`,{
    method:'PATCH',accountToken:adminToken,status:409,body:{displayName:'Pack Player'},
  });
  assert.equal(releaseWhilePublic.code,'PUBLIC_PROFILE_REQUIRES_USERNAME');

  // Keep one durable gameplay record so moderation can prove it only affects
  // public identity, never career/game history.
  await query(
    `INSERT INTO scores(player_id,challenge_date,set_id,mode,score,grade,selections_json)
     VALUES($1::uuid,current_date,'qa-public-identity','top3',87,'B','[]'::jsonb)`,
    [target.playerId],
  );
  const scoreBefore=Number((await query('SELECT count(*) n FROM scores WHERE player_id=$1::uuid',[target.playerId])).rows[0].n);

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
  await query('DELETE FROM pack1_admins WHERE auth_user_id=$1::uuid',[adminId]).catch(()=>{});
  await query('DELETE FROM neon_auth.session WHERE token IN ($1,$2,$3)',[reporter.accountToken,target.accountToken,adminToken]).catch(()=>{});
  await query('DELETE FROM neon_auth."user" WHERE id IN ($1::uuid,$2::uuid,$3::uuid)',[reporter.authId,target.authId,adminId]).catch(()=>{});
}
