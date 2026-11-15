// One-time, exactly scoped recovery of the 2026-11-15 development-only
// interrupted Habits concurrent-index migration. Never alter production, a
// changed migration identity, or an existing (even invalid) index. A later
// failure cannot reuse this timestamp-bound exception.
import {pathToFileURL} from 'node:url';
import {migrationIdentity} from './apply-release-migrations.mjs';

const MIGRATION='0071_habits_completed_covering_index.sql';
const EXPECTED_BRANCH='br-twilight-hill-ayffyd2b';
// PostgreSQL records microseconds; node-postgres JS Date truncates to milliseconds.
// Match the full observed instant in PostgreSQL, never through JS Date.
const FAILED_AT='2026-11-15T16:03:06.221368Z';
const INDEX='draft_run_habits_completed_cover_idx';
const REVIEW_TOKEN='reviewed-1272-dev-ledger-recovery-20261115';
export async function recoverDevelopmentHabitsIndex(query,{branchId,reviewToken}={}) {
 if(branchId!==EXPECTED_BRANCH||reviewToken!==REVIEW_TOKEN)
   throw Error('Reviewed development-only Habits index recovery guard missing');
 const expectedSha=migrationIdentity(MIGRATION);
 await query('BEGIN');
 try {
   const rows=(await query('SELECT name,sha256,state,method,recorded_at,recorded_at=$2::timestamptz AS timestamp_exact FROM public.pack1_applied_migrations WHERE name=$1 FOR UPDATE',[MIGRATION,FAILED_AT])).rows;
   if(rows.length>1)throw Error('Unexpected duplicate migration ledger rows');
   const row=rows[0];
   if(!row){await query('COMMIT');return 'no_failed_entry';}
   if(row.state==='applied'){
     if(row.sha256!==expectedSha)throw Error('Migration identity mismatch');
     await query('COMMIT');return 'already_applied';
   }
   if(row.state!=='failed'||row.method!=='executed'||row.sha256!==expectedSha||
       row.timestamp_exact!==true)
     throw Error('Unreviewed migration state, identity or incident timestamp');
   const present=(await query('SELECT count(*)::int AS n FROM pg_catalog.pg_class WHERE relname=$1',[INDEX])).rows[0]?.n;
   if(Number(present)!==0)throw Error('Existing index requires separately reviewed manual recovery');
   const cleared=(await query("DELETE FROM public.pack1_applied_migrations WHERE name=$1 AND sha256=$2 AND state='failed' AND method='executed' AND recorded_at=$3::timestamptz RETURNING name",[MIGRATION,expectedSha,FAILED_AT])).rows;
   if(cleared.length!==1)throw Error('Migration ledger changed during reviewed recovery');
   await query('COMMIT');return 'cleared_exact_failed_entry';
 } catch(error){await query('ROLLBACK').catch(()=>{});throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {default:pg}=await import('pg');
 const databaseUrl=process.env.DATABASE_URL;
 if(!/^postgres(?:ql)?:\/\//i.test(databaseUrl||''))throw Error('Direct database URL required');
 const client=new pg.Client({connectionString:databaseUrl,connectionTimeoutMillis:10000});
 try {
   await client.connect();
   const state=await recoverDevelopmentHabitsIndex((...a)=>client.query(...a),{
     branchId:process.env.PACK1_RECOVERY_BRANCH_ID,
     reviewToken:process.env.PACK1_RECOVERY_REVIEW_TOKEN,
   });
   console.log('Reviewed development Habits recovery: '+state);
 }catch(error){
   // Never print a connection URI, a SQL query payload or provider secrets.
   console.error('Reviewed development Habits recovery failed: '+error.message);
   process.exitCode=1;
 }finally{await client.end();}
}
