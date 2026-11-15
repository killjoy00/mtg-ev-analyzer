import test from 'node:test';
import assert from 'node:assert/strict';
import {migrationIdentity,runNontransactionalPsql} from '../scripts/apply-release-migrations.mjs';
import {recoverDevelopmentHabitsIndex} from '../scripts/recover-habits-development-migration.mjs';

const migration='0071_habits_completed_covering_index.sql';
const sha=migrationIdentity(migration);
const guard={branchId:'br-twilight-hill-ayffyd2b',reviewToken:'reviewed-1272-dev-ledger-recovery-20261115'};
const failure={name:migration,sha256:sha,state:'failed',method:'executed',recorded_at:new Date('2026-11-15T16:03:06.221Z')};
const fake=(row,existing=0)=>{
 const calls=[];
 const query=async(sql,params=[])=>{
   calls.push({sql,params});
   if(sql.includes('FOR UPDATE'))return {rows:row?[row]:[]};
   if(sql.includes('pg_catalog.pg_class'))return {rows:[{n:existing}]};
   if(sql.startsWith('DELETE FROM'))return {rows:[{name:migration}]};
   return {rows:[]};
 };
 return {query,calls};
};
test('one-time exact failed development ledger recovery requires both explicit guards',async()=>{
 for(const options of [{...guard,branchId:'br-orange-feather-ayps8kep'},
   {...guard,reviewToken:'unreviewed'},
   {branchId:null,reviewToken:null}]){
   const {query,calls}=fake(failure);
   await assert.rejects(recoverDevelopmentHabitsIndex(query,options),/guard/);
   assert.equal(calls.length,0);
 }
});
test('exact reviewed failure and absent index permit one development-only retry',async()=>{
 const {query,calls}=fake(failure);
 assert.equal(await recoverDevelopmentHabitsIndex(query,guard),'cleared_exact_failed_entry');
 assert.deepEqual(calls.map(x=>x.sql.startsWith('SELECT count')?'index_check':x.sql.startsWith('DELETE')?'delete':x.sql.startsWith('SELECT name')?'lock':x.sql),
   ['BEGIN','lock','index_check','delete','COMMIT']);
 assert.equal(calls.find(x=>x.sql.startsWith('DELETE')).params[1],sha);
 // PostgreSQL retains six-digit fractional seconds even though a JS Date
 // returns only three. Recovery must compare the exact stored timestamp.
 assert.equal(calls.find(x=>x.sql.startsWith('DELETE')).params[2],'2026-11-15T16:03:06.221368Z');
 assert.match(calls.find(x=>x.sql.startsWith('DELETE')).sql,/recorded_at=\$3::timestamptz/);
});
test('recovery refuses changed migration identities, later failure and existing invalid index',async()=>{
 for(const changed of [{...failure,sha256:'b'.repeat(64)},
   {...failure,state:'running'},
   {...failure,recorded_at:new Date('2026-11-15T16:03:07Z')},
   {...failure,method:'verified-baseline'}]){
   const {query,calls}=fake(changed);
   await assert.rejects(recoverDevelopmentHabitsIndex(query,guard));
   assert.ok(calls.some(x=>x.sql==='ROLLBACK'));
   assert.ok(!calls.some(x=>x.sql.startsWith('DELETE')));
 }
 const {query,calls}=fake(failure,1);
 await assert.rejects(recoverDevelopmentHabitsIndex(query,guard),/Existing index/);
 assert.ok(!calls.some(x=>x.sql.startsWith('DELETE')));
});
test('absent or already-applied migration is idempotent and cannot delete ledger',async()=>{
 for(const [row,result] of [[null,'no_failed_entry'],[{...failure,state:'applied'},'already_applied']]){
   const {query,calls}=fake(row);
   assert.equal(await recoverDevelopmentHabitsIndex(query,guard),result);
   assert.ok(!calls.some(x=>x.sql.startsWith('DELETE')));
 }
});
test('psql runner passes the reviewed database URI as positional argument, not PGDATABASE',()=>{
 const calls=[];
 const exec=(...args)=>{calls.push(args);return Buffer.from('ok');};
 const uri='postgresql://fixture:only@127.0.0.1:5432/pack1';
 runNontransactionalPsql('migrations/0071_habits_completed_covering_index.sql',{databaseUrl:uri,exec});
 assert.deepEqual(calls[0][1],[uri,'-X','-v','ON_ERROR_STOP=1','-f','migrations/0071_habits_completed_covering_index.sql']);
 assert.equal(calls[0][2].timeout,600000);
 assert.ok(!Object.hasOwn(calls[0][2],'env'));
 assert.throws(()=>runNontransactionalPsql('dummy',{databaseUrl:'not-a-uri',exec}),/URI/);
 const bad=Object.assign(Error('postgresql://private:secret@db.example/pack1'),{status:2});
 assert.throws(()=>runNontransactionalPsql('migration.sql',{databaseUrl:uri,exec:()=>{throw bad;}}),error=>{
   assert.equal(error.releaseDiagnostic,'concurrent_psql_exit_2');
   assert.doesNotMatch(error.message,/private|secret|db\\.example/);
   return true;
 });
});
