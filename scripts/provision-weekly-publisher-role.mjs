// One-time scoped role setup, from the protected main-branch release workflow.
// Never log a password, connection URI, verifier or result rows.
import {createHmac,createHash,pbkdf2Sync,randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {draftRunLeaderboardRows} from '../worker/draft-run-season.mjs';
import {FEATURED_SQL} from './featured-pick.mjs';
import {resultsLaunch} from '../worker/results-privacy.mjs';

export const ROLE='packone_weekly_publisher';
export const MIGRATION='0081_private_patreon_weekly_receipts.sql';
export function publisherPassword(value) {
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(value))throw Error('weekly-credential-format');
 return value;
}
export function developmentPassword(secret){
 return createHmac('sha256',publisherPassword(secret)).update('packone-weekly-development-role-v1').digest('base64url');
}
// PostgreSQL accepts a precomputed SCRAM verifier; cleartext password is not
// interpolated into DDL or sent in a query to the server's SQL logger.
export function scramVerifier(password,salt=randomBytes(16)){
 const count=16384;
 const salted=pbkdf2Sync(publisherPassword(password),salt,count,32,'sha256');
 const clientKey=createHmac('sha256',salted).update('Client Key').digest();
 const stored=createHash('sha256').update(clientKey).digest('base64');
 const server=createHmac('sha256',salted).update('Server Key').digest('base64');
 return 'SCRAM-SHA-256$'+count+':'+salt.toString('base64')+'$'+stored+':'+server;
}
export function scopedConnection(ownerUrl,password) {
 const url=new URL(ownerUrl);
 if(!['postgresql:','postgres:'].includes(url.protocol)||!url.hostname.endsWith('.neon.tech')||url.pathname!=='/pack1'||url.username!=='pack1_owner'||url.hostname.includes('-pooler.'))throw Error('weekly-owner-connection-invalid');
 url.username=ROLE;url.password=publisherPassword(password);
 url.searchParams.set('sslmode','verify-full');
 return url.toString();
}
export const VERIFY_SQL=[
 "SELECT current_user='packone_weekly_publisher' AS scoped,",
 " (SELECT NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls AND rolcanlogin FROM pg_roles WHERE rolname=current_user) AS restricted,",
 " NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS no_memberships,",
 " has_table_privilege(current_user,'public.patreon_weekly_pending_names','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AS pending_access,",
 " has_any_column_privilege(current_user,(SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='neon_auth' AND c.relname='user'),'SELECT,INSERT,UPDATE,REFERENCES') AS auth_access,",
 " has_table_privilege(current_user,'public.scores','INSERT,UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege(current_user,'public.scores','INSERT,UPDATE') AS score_write,",
 " has_table_privilege(current_user,'public.results_publications','INSERT,UPDATE,DELETE,TRUNCATE') AS publication_write,",
 " has_table_privilege(current_user,'public.results_removal_tasks','INSERT,UPDATE,DELETE,TRUNCATE') AS removal_write,",
 " has_function_privilege(current_user,'public.pack1_patreon_weekly_name(uuid)','EXECUTE') AS name_lookup,",
 " has_function_privilege(current_user,'public.pack1_patreon_weekly_admit(date,jsonb)','EXECUTE') AS admit,",
 " has_function_privilege(current_user,'public.pack1_patreon_weekly_finish(date,text,timestamptz)','EXECUTE') AS finish"
].join('\n');
export async function verifyRole(query) {
 const row=(await query(VERIFY_SQL)).rows[0];
 if(!row?.scoped||!row.restricted||!row.no_memberships||
    row.pending_access!==false||row.auth_access!==false||row.score_write!==false||
    row.publication_write!==false||row.removal_write!==false||!row.name_lookup||!row.admit||!row.finish)
   throw Error('weekly-role-verification-failed');
 // Read permissions only. No live standings, named snapshot or submission.
 const start='1900-01-01',end=start;
 await query('SELECT week_end,state,image_sha256 FROM patreon_weekly_runs LIMIT 0');
 await query('SELECT auth_user_id FROM account_links LIMIT 0');
 await query('SELECT id,set_name,start_date,end_date FROM draft_run_seasons LIMIT 0');
 await query('SELECT pack1_patreon_weekly_name($1::uuid) name',['00000000-0000-0000-0000-000000000000']);
 await draftRunLeaderboardRows(query,{start,end,environment:'mixed',limit:1});
 await query(FEATURED_SQL,[start]);
 await resultsLaunch(query);
}
export async function provisionRole(owner,connect,{password,grants,verify=verifyRole}){
 const query=(text,params=[])=>owner.query(text,params);
 const ready=(await query("SELECT state FROM public.pack1_applied_migrations WHERE name=$1",[MIGRATION])).rows[0];
 if(ready?.state!=='applied')throw Error('weekly-role-schema-not-released');
 const existing=(await query("SELECT rolname FROM pg_roles WHERE rolname=$1",[ROLE])).rows[0];
 // An existing password is never reset automatically. Repeating the same
 // reviewed grants is safe; a wrong password fails the actual login.
 await query('BEGIN');
 try {
  if(!existing)await query("CREATE ROLE packone_weekly_publisher LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '"+scramVerifier(password)+"'");
  await query(grants);
  await query('COMMIT');
 }catch(error){await query('ROLLBACK');throw error;}
 const scoped=await connect(password);
 try{await verify((text,params=[])=>scoped.query(text,params));}
 finally{await scoped.end();}
}
async function main(){
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_EVENT_NAME!=='workflow_dispatch'||process.env.PACKONE_WEEKLY_ROLE_PROVISION!=='protected-v1')
   throw Error('weekly-role-protected-workflow-required');
 const branch=process.argv[2];
 if(!['development','production'].includes(branch))throw Error('weekly-role-branch-invalid');
 const password=branch==='development'?developmentPassword(process.env.PACKONE_WEEKLY_PUBLISHER_PASSWORD):publisherPassword(process.env.PACKONE_WEEKLY_PUBLISHER_PASSWORD);
 const ownerUrl=process.env.DATABASE_URL;
 const scoped=scopedConnection(ownerUrl,password);
 const {default:pg}=await import('pg');
 const owner=new pg.Client({connectionString:ownerUrl,connectionTimeoutMillis:15000,statement_timeout:30000});
 try{
  await owner.connect();
  const grants=await readFile(new URL('./provision-weekly-publisher-grants.sql',import.meta.url),'utf8');
  await provisionRole(owner,async()=>{
   const client=new pg.Client({connectionString:scoped,connectionTimeoutMillis:15000,statement_timeout:30000});
   await client.connect();return client;
  },{password,grants});
  console.log('weekly-publisher-role:'+branch+':verified');
 }finally{await owner.end();}
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
 main().catch(()=>{console.error('weekly-publisher-role:failed-closed; inspect protected configuration privately');process.exitCode=1;});
