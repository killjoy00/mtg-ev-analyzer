// One-shot 50-identity Daily-status read fixture, on a verified disposable clone.
// No gameplay sessions, score rows, corpus warmup, production auth writes, or provider APIs.
import fs from 'node:fs';
import {randomBytes,randomUUID,createHash,createHmac} from 'node:crypto';
import {verifyTarget} from './practice-performance.mjs';
import {PUBLIC_IDENTITY_TERMS_VERSION} from '../worker/public-identity-safety.mjs';

async function main() {
  const branch=process.env.PREVIEW_BRANCH,connection=process.env.DATABASE_URL,key=process.env.NEON_API_KEY;
  if(process.env.PREVIEW_CREATED!=='true')throw Error('fresh_disposable_branch_required');
  if(!/^br-[a-z0-9-]+$/.test(branch||'')||!key||!connection)throw Error('missing_isolated_fixture_context');
  const fetchControl=async suffix=>{
    const r=await fetch('https://console.neon.tech/api/v2/projects/patient-shadow-91417882/branches/'+branch+suffix,{
      headers:{authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(20000),
    });
    if(!r.ok)throw Error('isolated_fixture_target_unverified');
    return r.json();
  };
  const [b,e]=await Promise.all([fetchControl(''),fetchControl('/endpoints')]);
  const endpoint=verifyTarget({branch,connection,branchRecord:b.branch,endpoints:e.endpoints||[]});
  if(Number(endpoint.autoscaling_limit_min_cu)!==0.25||
     Number(endpoint.autoscaling_limit_max_cu)!==8||
     Number(endpoint.suspend_timeout_seconds??endpoint.suspend_timeout)!==300)
    throw Error('isolated_compute_profile_mismatch');
  const created=Date.parse(b.branch.created_at),expires=Date.parse(b.branch.expires_at);
  if(!Number.isFinite(created)||!Number.isFinite(expires)||expires<=Date.now()||
     expires-created>23.5*60000)throw Error('disposable_branch_lifetime_exceeded');

  const {query}=await import('../worker/growth-function.js');
  const secretResult=await query("SELECT value FROM settings WHERE key='player_secret'");
  const secret=secretResult.rows[0]?.value;
  if(typeof secret!=='string'||!secret)throw Error('player_signing_secret_unavailable');
  const tag=randomBytes(5).toString('hex');
  const digest=x=>createHash('sha256').update(x).digest('hex');
  const users=Array.from({length:50},(_,i)=>{
    const guest=i%10<5,player=randomUUID(),account=guest?null:randomBytes(32).toString('base64url'),
      csrf=guest?null:randomBytes(32).toString('base64url'),auth=guest?null:randomUUID();
    return {id:i,guest,player,auth,account,csrf,
      account_hash:account?digest(account):null,csrf_hash:csrf?digest(csrf):null,
      name:'Read'+tag+'x'+i,
      token:'p1_'+player+'.'+createHmac('sha256',secret).update(player).digest('base64url')};
  });
  if(users.length!==50||users.filter(x=>x.guest).length!==25||
     users.filter(x=>!x.guest).length!==25)throw Error('fixture_cohort_mismatch');
  const stored=JSON.stringify(users.map(({token,account,csrf,...rest})=>rest));
  await query('INSERT INTO neon_auth."user"(id,name,email,"emailVerified") SELECT (u->>\'auth\')::uuid,u->>\'name\',(u->>\'auth\')||\'@example.invalid\',true FROM jsonb_array_elements($1::jsonb) u WHERE (u->>\'guest\')::boolean=false',[stored]);
  await query('INSERT INTO players(id,display_name,username_owned,profile_public,public_identity_terms_version,public_identity_terms_accepted_at) SELECT (u->>\'player\')::uuid,u->>\'name\',true,true,$2,now() FROM jsonb_array_elements($1::jsonb) u',[stored,PUBLIC_IDENTITY_TERMS_VERSION]);
  await query('INSERT INTO account_links(auth_user_id,player_id) SELECT (u->>\'auth\')::uuid,(u->>\'player\')::uuid FROM jsonb_array_elements($1::jsonb) u WHERE (u->>\'guest\')::boolean=false',[stored]);
  await query("INSERT INTO account_sessions(session_hash,auth_user_id,csrf_hash,expires_at) SELECT u->>'account_hash',(u->>'auth')::uuid,u->>'csrf_hash',now()+interval '45 minutes' FROM jsonb_array_elements($1::jsonb) u WHERE (u->>'guest')::boolean=false",[stored]);
  const file=process.env.LOAD_FIXTURE_FILE;
  if(!file)throw Error('missing_fixture_destination');
  fs.writeFileSync(file,JSON.stringify({sha:process.env.GITHUB_SHA,branch,created_at:created,
    connection,users,configuration:{actors:50,per_generator:10,guests:25,signed_in:25}}),{mode:0o600});
  fs.mkdirSync('artifacts/daily-status-timing',{recursive:true});
  fs.writeFileSync('artifacts/daily-status-timing/fixture-summary.json',JSON.stringify({
    source_revision:process.env.GITHUB_SHA,branch_created_at:new Date(created).toISOString(),
    actors:50,guests:25,signed_in:25,synthetic_score_rows_created:0,
    original_full_fixture_preparation_used:false,compute:{min_cu:0.25,max_cu:8,suspend_seconds:300},
    branch_lifetime_minutes:(expires-created)/60000
  },null,2));
  console.log(JSON.stringify({event:'minimal_read_fixture_ready',actors:50,guests:25,signed_in:25,score_rows:0}));
}
main().catch(error=>{console.error(JSON.stringify({event:'minimal_fixture_failed',code:/^[a-z_]+$/.test(error.message)?error.message:'fixture_error'}));process.exitCode=1;});
