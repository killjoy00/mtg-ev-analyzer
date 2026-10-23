import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {migrationPlan} from './ci-migration-plan.mjs';
import {verifyBaselineSchema} from './migration-schema.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function migrationIdentity(name,root='.') {
 const bytes=fs.readFileSync(`${root}/migrations/${name}`);
 return hash(bytes);
}
export function transactionalSQL(sql,name) {
 // Only these immutable legacy files own an outer transaction. Removing those
 // two delimiters makes the DDL and ledger commit one transaction.
 if(['0054_creator_event_idempotency.sql','0055_creator_event_write_safety.sql'].includes(name))
   return sql.replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,'');
 if(/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;\s*$/m.test(sql))throw Error('Migration has unreviewed transaction control');
 return sql;
}
export async function applyReleaseMigrations(client,{plan='secure-auth-release',root='.',baseline,
 manifest=JSON.parse(fs.readFileSync(`${root}/migrations/manifest.json`)),
 runNontransactional,verifySchema=verifyBaselineSchema}={}) {
 if(!baseline.plans.includes(plan))throw Error('Release plan requires its own reviewed baseline');
 const query=(...args)=>client.query(...args),selected=migrationPlan(manifest,plan).map(p=>p.slice(11));
 const identities=Object.fromEntries(manifest.ordered.map(n=>[n,migrationIdentity(n,root)]));
 for(const [name,identity] of Object.entries(baseline.identities))
   if(identities[name]!==identity)throw Error('Immutable migration changed: '+name);
 await query("SET lock_timeout='10s'");
 // One session owns the entire run, including concurrent-index subprocesses.
 await query('SELECT pg_advisory_lock(519,20261023)');
 let applied=0,skipped=0;
 try {
   await query(`CREATE TABLE IF NOT EXISTS public.pack1_applied_migrations(
     name text PRIMARY KEY,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
     state text NOT NULL CHECK(state IN ('applied','running','failed')),
     method text NOT NULL CHECK(method IN ('verified-baseline','executed')),
     recorded_at timestamptz NOT NULL DEFAULT now())`);
   const rows=(await query('SELECT name,sha256,state FROM public.pack1_applied_migrations')).rows;
   if(!rows.length) {
     await query('BEGIN');
     try {
       await verifySchema(query,baseline.schema);
       for(const [name,identity] of Object.entries(baseline.migrations))
         await query("INSERT INTO public.pack1_applied_migrations(name,sha256,state,method) VALUES($1,$2,'applied','verified-baseline')",[name,identity]);
       await query('COMMIT');
     } catch(error) {await query('ROLLBACK');throw error;}
   }
   const ledger=new Map((await query('SELECT name,sha256,state FROM public.pack1_applied_migrations')).rows.map(r=>[r.name,r]));
   for(const row of ledger.values()) {
     if(identities[row.name]!==row.sha256)throw Error('Applied migration identity mismatch: '+row.name);
     if(row.state!=='applied')throw Error('Incomplete migration requires reviewed recovery: '+row.name);
   }
   for(const name of selected) {
     if(ledger.has(name)){skipped++;continue;}
     const sql=fs.readFileSync(`${root}/migrations/${name}`,'utf8');
     const concurrent=/\b(?:CREATE|DROP)\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(sql)||/^\\/m.test(sql);
     if(concurrent) {
       if(!runNontransactional)throw Error('Nontransactional migration runner unavailable');
       // An interrupted concurrent build is never silently marked applied or
       // automatically rerun. A reviewed repair must validate its final state.
       await query("INSERT INTO public.pack1_applied_migrations(name,sha256,state,method) VALUES($1,$2,'running','executed')",[name,identities[name]]);
       try {await runNontransactional(`${root}/migrations/${name}`);}
       catch(error){await query("UPDATE public.pack1_applied_migrations SET state='failed' WHERE name=$1",[name]);throw error;}
       await query("UPDATE public.pack1_applied_migrations SET state='applied',recorded_at=now() WHERE name=$1",[name]);
     } else {
       await query('BEGIN');
       try {
         await query(transactionalSQL(sql,name));
         await query("INSERT INTO public.pack1_applied_migrations(name,sha256,state,method) VALUES($1,$2,'applied','executed')",[name,identities[name]]);
         await query('COMMIT');
       } catch(error){await query('ROLLBACK');throw error;}
     }
     applied++;
   }
   return {applied,skipped};
 } finally {await query('SELECT pg_advisory_unlock(519,20261023)');}
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url) {
 const {default:pg}=await import('pg');
 const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,statement_timeout:600000});
 try {
   await client.connect();
   const baseline=JSON.parse(fs.readFileSync('migrations/baseline.json'));
   const result=await applyReleaseMigrations(client,{plan:process.argv[2]||'secure-auth-release',baseline,
     runNontransactional:file=>execFileSync('psql',['-X','-v','ON_ERROR_STOP=1','-f',file],{
       env:{...process.env,PGDATABASE:process.env.DATABASE_URL},stdio:'pipe',timeout:600000})});
   console.log('Reviewed migration plan complete: '+result.applied+' applied, '+result.skipped+' already applied.');
 } catch {console.error('Reviewed migration plan failed; inspect schema or incomplete ledger state privately.');process.exitCode=1;}
 finally {await client.end();}
}
