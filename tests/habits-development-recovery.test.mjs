import test from 'node:test';
import assert from 'node:assert/strict';
import {migrationIdentity,runNontransactionalPsql} from '../scripts/apply-release-migrations.mjs';
import {recoverDevelopmentHabitsIndex} from '../scripts/recover-habits-development-migration.mjs';

const migration='0071_habits_completed_covering_index.sql';
const sha=migrationIdentity(migration);
const guard={branchId:'br-twilight-hill-ayffyd2b',reviewToken:'reviewed-1272-dev-ledger-recovery-20261115'};
const exactFailureAt='2026-11-15T16:03:06.221368Z';
const failure={name:migration,sha256:sha,state:'failed',method:'executed',recorded_at:exactFailureAt};
const fake=(row,existing=0)=>{
 const calls=[];
 const query=async(sql,params=[])=>{
   calls.push({sql,params});
   if(sql.includes('FOR UPDATE'))return {rows:row?[{...row,timestamp_exact:row.recorded_at===params[1]}]:[]};
   if(sql.includes('pg_catalog.pg_class'))return {rows:[{n:existing}]};
   if(sql.startsWith('DELETE FROM'))return {rows:row&&row.recorded_at===params[2]&&row.sha256===params[1]&&row.state==='failed'&&row.method==='executed'?[{name:migration}]:[]};
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
 assert.equal(calls.find(x=>x.sql.startsWith('DELETE')).params[2],exactFailureAt);
 const lock=calls.find(x=>x.sql.includes('FOR UPDATE'));
 assert.equal(lock.params[1],exactFailureAt);
 assert.match(lock.sql,/recorded_at=\$2::timestamptz AS timestamp_exact/);
});
test('recovery refuses changed migration identities, later failure and existing invalid index',async()=>{
 for(const changed of [{...failure,sha256:'b'.repeat(64)},
   {...failure,state:'running'},
   {...failure,recorded_at:'2026-11-15T16:03:06.221369Z'},
   {...failure,recorded_at:'2026-11-15T16:03:07Z'},
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
test('a mismatched exact ledger delete rolls back even after an observed locked row',async()=>{
 const {query:original,calls}=fake(failure);
 const query=(sql,params)=>{
   if(sql.startsWith('DELETE FROM')){calls.push({sql,params});return Promise.resolve({rows:[]});}
   return original(sql,params);
 };
 await assert.rejects(recoverDevelopmentHabitsIndex(query,guard),/Migration ledger changed/);
 assert.ok(calls.some(x=>x.sql==='ROLLBACK'));
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
