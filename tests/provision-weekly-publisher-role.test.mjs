import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publisherPassword,developmentPassword,scramVerifier,scopedConnection,provisionRole,verifyRole,ROLE,MIGRATION} from '../scripts/provision-weekly-publisher-role.mjs';
const password='fixture-only-secret-0123456789abcdef';
const owner='postgresql://pack1_owner:owner-fixture@ep-fixture.us-east-2.aws.neon.tech/pack1?sslmode=require';

test('credentials are restricted and derived development secret differs from production',()=>{
 assert.equal(publisherPassword(password),password);
 assert.throws(()=>publisherPassword('weak'),/credential-format/);
 assert.throws(()=>publisherPassword(password+"'"),/credential-format/);
 assert.notEqual(developmentPassword(password),password);
 assert.equal(developmentPassword(password),developmentPassword(password));
 assert.match(scramVerifier(password,Buffer.alloc(16,2)),/^SCRAM-SHA-256\$16384:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
 assert.ok(!scramVerifier(password).includes(password));
 const scoped=new URL(scopedConnection(owner,password));
 assert.equal(scoped.username,ROLE);
 assert.equal(scoped.password,password);
 assert.equal(scoped.searchParams.get('sslmode'),'verify-full');
 assert.throws(()=>scopedConnection(owner.replace('pack1_owner','other'),password));
 assert.throws(()=>scopedConnection(owner.replace('.neon.tech','.example.org'),password));
});
function mock({installed=true,existing=false,failGrant=false}={}){
 const statements=[];
 const owner={query:async(sql,params)=>{
  statements.push([sql,params]);
  if(sql.includes('pack1_applied_migrations'))return {rows:installed?[{state:'applied'}]:[]};
  if(sql.includes('FROM pg_roles'))return {rows:existing?[{rolname:ROLE}]:[]};
  if(sql==='scoped grants'&&failGrant)throw Error('grant fixture');
  return {rows:[]};
 }};
 let connects=0,closes=0,verified=0;
 return {owner,statements,connect:async()=>{connects++;return {query:async()=>({rows:[]}),end:async()=>{closes++}}},verify:async()=>{verified++},counts:()=>[connects,closes,verified]};
}
test('provision requires applied migration; only new role creates password verifier; verifies real connection',async()=>{
 const f=mock();await provisionRole(f.owner,f.connect,{password,grants:'scoped grants',verify:f.verify});
 assert.ok(f.statements[0][1].includes(MIGRATION));
 assert.match(f.statements.find(([sql])=>sql.startsWith('CREATE ROLE'))[0],/LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD 'SCRAM-SHA-256/);
 assert.ok(!JSON.stringify(f.statements).includes(password));
 assert.deepEqual(f.counts(),[1,1,1]);
 const existing=mock({existing:true});await provisionRole(existing.owner,existing.connect,{password,grants:'scoped grants',verify:existing.verify});
 assert.ok(!existing.statements.some(([sql])=>/^(CREATE|ALTER|DROP) ROLE/.test(sql)));
 const missing=mock({installed:false});await assert.rejects(()=>provisionRole(missing.owner,missing.connect,{password,grants:'scoped grants',verify:missing.verify}),/schema-not-released/);
 assert.deepEqual(missing.counts(),[0,0,0]);assert.equal(missing.statements.length,1);
 const bad=mock({failGrant:true});await assert.rejects(()=>provisionRole(bad.owner,bad.connect,{password,grants:'scoped grants',verify:bad.verify}));
 assert.equal(bad.statements.at(-1)[0],'ROLLBACK');assert.deepEqual(bad.counts(),[0,0,0]);
});
test('unsafe role fails before any data read; release workflow is protected, serialized, main-only and dev first',async()=>{
 let calls=0;await assert.rejects(()=>verifyRole(async()=>{calls++;return {rows:[{scoped:true,restricted:true,no_memberships:true,pending_access:true}]}}),/verification-failed/);assert.equal(calls,1);
 const yaml=readFileSync(new URL('../.github/workflows/provision-weekly-publisher.yml',import.meta.url),'utf8');
 assert.match(yaml,/workflow_dispatch:/);assert.match(yaml,/environment: pack-one-mobile-release/);assert.match(yaml,/group: pack1-secure-auth-release/);
 assert.match(yaml,/github\.ref == 'refs\/heads\/main'/);
 assert.ok(yaml.indexOf('provision-weekly-publisher-role.mjs development')<yaml.indexOf('provision-weekly-publisher-role.mjs production'));
 assert.doesNotMatch(yaml,/upload-artifact|pull_request_target|reset-password/);
});
