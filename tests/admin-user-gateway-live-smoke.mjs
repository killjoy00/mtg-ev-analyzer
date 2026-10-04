// Production acceptance uses only freshly generated, registered QA identities.
// Notices go to Resend's delivered+label test addresses, never real customers.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {corpusDatabase} from '../scripts/neon-corpus-db.mjs';

const [mode,commit,connectionFile,registryFile]=process.argv.slice(2);
assert.ok(['preflight','verify','cleanup'].includes(mode));
assert.match(commit||'',/^[a-f0-9]{40}$/);
assert.ok(connectionFile&&registryFile);
const query=corpusDatabase(connectionFile);
const base='https://api.packone.pro',origin='https://packone.pro';
const directory='artifacts/admin-gateway';
fs.mkdirSync(directory,{recursive:true});
const record=value=>fs.writeFileSync(directory+'/acceptance.json',JSON.stringify(value,null,2)+'\n');

async function call(path,{body,token,method,status=[200]}={}) {
  const response=await fetch(base+path,{
    method:method||(body===undefined?'GET':'POST'),redirect:'error',signal:AbortSignal.timeout(90000),
    headers:{origin,...(body===undefined?{}:{'content-type':'application/json'}),
      ...(token?{'x-pack1-auth-session':token}:{})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const data=await response.json().catch(()=>({}));
  assert.ok(status.includes(response.status),`${path}: HTTP ${response.status}; code ${data.code||'none'}`);
  return data;
}

async function markers() {
  for(const service of ['legacy','growth','draft']) {
    const health=await call('/'+service+'/health?quick=1');
    assert.equal(health.ok,true);
    assert.equal(health.release_commit,commit,service+' must retain the accepted Function revision');
    if(service==='growth')assert.equal(health.deletion_email_configured,true);
  }
}

async function servingState() {
  const policies=(await query(`SELECT e.set_id,e.status,e.active_snapshot_id,s.corpus_version
    FROM draft_run_environment_policy e
    LEFT JOIN corpus_source_snapshots s ON s.source_snapshot_id=e.active_snapshot_id
    ORDER BY e.set_id`)).rows;
  const active=policies.filter(p=>p.corpus_version==='elite-trophy-colour-stage-v9');
  assert.equal(active.length,30,'Preserve all 30 active v9 snapshot pointers');
  const {prosrc}=(await query(`SELECT prosrc FROM pg_proc
    WHERE oid='pack1_select_serving_run_v1(bigint,bigint,text,text,text,jsonb)'::regprocedure`)).rows[0];
  const expected=fs.readFileSync('migrations/0051_exact_pick_draw_index.sql','utf8').split('AS $function$')[1].split('$function$')[0];
  assert.equal(prosrc,expected,'Retain the exact weighted selector and pick-draw optimization');
  const {revision}=(await query('SELECT revision::text FROM draft_run_serving_revision WHERE singleton')).rows[0];
  return {revision,active_v9_sets:active.length,policy_sha256:createHash('sha256').update(JSON.stringify(policies)).digest('hex'),
    selector_sha256:createHash('sha256').update(prosrc).digest('hex')};
}

function loadRegistry() {
  const registry=JSON.parse(fs.readFileSync(registryFile,'utf8'));
  assert.equal(registry.commit,commit);
  assert.match(registry.tag,/^qa-gateway-[a-f0-9]{8}$/);
  assert.ok(Array.isArray(registry.fixtures)&&registry.fixtures.length<=3);
  for(const f of registry.fixtures) {
    assert.match(f.authId,/^[a-f0-9-]{36}$/);
    assert.equal(f.email,`delivered+${registry.tag}-${f.label}@resend.dev`);
    assert.ok(['admin','notice','off'].includes(f.label));
    assert.equal(f.name,`QA Gateway ${f.label} ${registry.tag}`);
    if(f.playerId)assert.match(f.playerId,/^[a-f0-9-]{36}$/);
  }
  return registry;
}

async function cleanup() {
  const registry=loadRegistry();
  for(const f of registry.fixtures) {
    const user=(await query('SELECT email,name FROM neon_auth."user" WHERE id=$1::uuid',[f.authId])).rows[0];
    if(user) {
      assert.equal(user.email,f.email,'Only owned QA accounts may be removed');
      assert.equal(user.name,f.name);
    }
    await query('DELETE FROM pack1_admins WHERE auth_user_id=$1::uuid',[f.authId]);
    await query('DELETE FROM account_sessions WHERE auth_user_id=$1::uuid',[f.authId]);
    await query('DELETE FROM neon_auth.session WHERE "userId"=$1::uuid',[f.authId]);
    await query('DELETE FROM account_links WHERE auth_user_id=$1::uuid',[f.authId]);
    await query('DELETE FROM neon_auth."user" WHERE id=$1::uuid AND email=$2 AND name=$3',[f.authId,f.email,f.name]);
    if(f.playerId)await query('DELETE FROM players WHERE id=$1::uuid AND display_name LIKE $2',[f.playerId,'QA Gateway %']);
    const remaining=(await query(`SELECT
      (SELECT count(*) FROM pack1_admins WHERE auth_user_id=$1::uuid)::int admins,
      (SELECT count(*) FROM neon_auth."user" WHERE id=$1::uuid)::int users,
      (SELECT count(*) FROM neon_auth.session WHERE "userId"=$1::uuid)::int sessions`,[f.authId])).rows[0];
    assert.deepEqual(Object.values(remaining).map(Number),[0,0,0],'QA administrative access must be revoked');
  }
  fs.writeFileSync(directory+'/cleanup.json',JSON.stringify({passed:true,removed_fixture_count:registry.fixtures.length})+'\n');
}

async function verify() {
  const before=JSON.parse(fs.readFileSync(directory+'/before.json','utf8'));
  await markers();
  assert.deepEqual(await servingState(),before.serving,'Gateway upload must preserve serving state');
  const tag='qa-gateway-'+randomUUID().slice(0,8);
  const publicName=label=>'QA Gateway '+tag.slice(-8)+' '+label;
  const registry={commit,tag,fixtures:[]};
  const save=()=>fs.writeFileSync(registryFile,JSON.stringify(registry),{mode:0o600});
  save();
  async function fixture(label,verified=true) {
    const f={label,authId:randomUUID(),email:`delivered+${tag}-${label}@resend.dev`,
      name:`QA Gateway ${label} ${tag}`,playerId:null};
    const token=randomUUID()+randomUUID();
    console.log('::add-mask::'+token);
    registry.fixtures.push(f);save();
    await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") VALUES($1::uuid,$2,$3,$4::boolean)',[f.authId,f.name,f.email,verified]);
    await query('INSERT INTO neon_auth.session(token,"userId","expiresAt","updatedAt") VALUES($1,$2::uuid,now()+interval \'15 minutes\',now())',[token,f.authId]);
    if(label==='admin')await query('INSERT INTO pack1_admins(auth_user_id) VALUES($1::uuid)',[f.authId]);
    else {
      const guest=await call('/growth/v1/player/session',{body:{displayName:publicName(label.slice(0,3))},status:[201]});
      assert.match(guest.playerId||'',/^[a-f0-9-]{36}$/);
      f.playerId=guest.playerId;save();
      await query('INSERT INTO account_links(auth_user_id,player_id) VALUES($1::uuid,$2::uuid)',[f.authId,f.playerId]);
    }
    return {...f,token};
  }
  const path=f=>'/growth/v1/admin/users/'+f.authId;
  const report={commit,tag,passed:false,checks:[],test_recipients:[]};
  try {
    const admin=await fixture('admin'),notice=await fixture('notice'),off=await fixture('off',false);
    report.test_recipients=[notice.email,off.email];
    await call(path(notice)+'/username',{method:'PATCH',body:{displayName:publicName('deny')},status:[401]});
    await call(path(notice)+'/username',{method:'PATCH',token:notice.token,body:{displayName:publicName('deny')},status:[403]});
    report.checks.push('unauthenticated and non-admin rename denied');
    const body={displayName:publicName('new'),reason:'QA gateway notice '+tag};
    const renamed=await call(path(notice)+'/username',{method:'PATCH',token:admin.token,body});
    assert.equal(renamed.changed,true);assert.deepEqual(renamed.notification,{status:'sent'});
    const repeated=await call(path(notice)+'/username',{method:'PATCH',token:admin.token,body});
    assert.equal(repeated.changed,false);assert.equal(repeated.notification.reason,'unchanged');
    const optedOut=await call(path(notice)+'/username',{method:'PATCH',token:admin.token,
      body:{displayName:publicName('off'),notifyUser:false}});
    assert.deepEqual(optedOut.notification,{status:'skipped',reason:'not_requested'});
    const unverified=await call(path(off)+'/username',{method:'PATCH',token:admin.token,
      body:{displayName:publicName('unv')}});
    assert.deepEqual(unverified.notification,{status:'skipped',reason:'no_verified_email'});
    report.checks.push('rename notice accepted; unchanged retry, opt-out and unverified address send nothing');
    for(const f of [notice,off]) {
      const owned=(await query('SELECT email FROM neon_auth."user" WHERE id=$1::uuid',[f.authId])).rows[0];
      assert.equal(owned?.email,f.email,'Delete only the freshly registered QA target');
      const deletionBody={confirm:'DELETE',reason:'QA gateway deletion '+tag,...(f===off?{notifyUser:false}:{})};
      const deleted=await call(path(f)+'/delete',{token:admin.token,body:deletionBody,status:[200,202]});
      assert.deepEqual(deleted.notification,f===off?{status:'skipped',reason:'not_requested'}:{status:'sent'});
      const repeated=await call(path(f)+'/delete',{token:admin.token,body:deletionBody,status:[200,202]});
      assert.equal(repeated.operationId,deleted.operationId);
      assert.deepEqual(repeated.notification,{status:'skipped',reason:'already_started'});
      const status=await call(path(f)+'/deletion',{token:admin.token});
      assert.equal(status.deletion.operation_id,deleted.operationId);
      assert.ok(status.deletion.app_cleanup_completed_at);
      assert.equal(status.deletion.state,'complete','QA provider deletion must finish');
      assert.equal(Number((await query('SELECT count(*)::int n FROM neon_auth."user" WHERE id=$1::uuid',[f.authId])).rows[0].n),0);
      report.checks.push(f.label+': deletion complete, notice behavior and same-operation retry verified');
    }
    await markers();
    assert.deepEqual(await servingState(),before.serving,'Admin QA must preserve the v9 serving state');
    report.serving=before.serving;
    report.passed=true;
  } finally {
    record(report);
    await cleanup();
  }
  console.log(JSON.stringify(report));
}

try {
  if(mode==='preflight') {
    await markers();
    const state={commit,serving:await servingState()};
    fs.writeFileSync(directory+'/before.json',JSON.stringify(state,null,2)+'\n');
    console.log('Accepted v9 Functions, snapshot pointers and exact weighted SQL selector verified.');
  } else if(mode==='cleanup')await cleanup();
  else await verify();
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
}
