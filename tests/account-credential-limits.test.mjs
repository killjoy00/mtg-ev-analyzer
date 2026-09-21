import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {consumeCredentialLimit,clearCredentialLimit,credentialNetworkProof,trustedCredentialNetwork} from '../worker/account-credential-limits.mjs';

const USER='11111111-1111-4111-8111-111111111111';
const NETWORK='a'.repeat(64);

function fakeQuery(attempts=1) {
  const calls=[];
  const query=async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.includes('INSERT INTO account_credential_rate_limits'))
      return {rows:[{attempts:String(attempts),expires_at:'2099-01-01T00:00:00Z',retry_after:'900'}],rowCount:1};
    return {rows:[],rowCount:1};
  };
  return {query,calls};
}

test('account limiter stores authenticated Auth UUID directly and no target email identity',async()=>{
  const {query,calls}=fakeQuery(2);
  const result=await consumeCredentialLimit(query,{authUserId:USER,purpose:'current_password',limit:5,seconds:900});
  assert.equal(result.limited,false);
  const insert=calls.find(row=>row.sql.includes('INSERT INTO account_credential_rate_limits'));
  assert.deepEqual(insert.params,[USER,'current_password','',900]);
  assert.doesNotMatch(JSON.stringify(calls),/@|example|target/i);
});

test('network limiter persists only a 64-hex trusted digest',async()=>{
  const {query,calls}=fakeQuery(6);
  const result=await consumeCredentialLimit(query,{authUserId:USER,purpose:'password_change_network',networkHash:NETWORK,limit:5,seconds:900});
  assert.equal(result.limited,true);
  const insert=calls.find(row=>row.sql.includes('INSERT INTO account_credential_rate_limits'));
  assert.deepEqual(insert.params,[USER,'password_change_network',NETWORK,900]);
  await assert.rejects(
    consumeCredentialLimit(query,{authUserId:USER,purpose:'password_change_network',networkHash:'192.0.2.5',limit:5,seconds:900}),
    error=>error.status===503,
  );
});

test('account limiter works without network configuration while sensitive network identity fails closed',async()=>{
  const {query}=fakeQuery(1);
  assert.equal((await consumeCredentialLimit(query,{authUserId:USER,purpose:'current_password',limit:5,seconds:900})).limited,false);
  const secret='b'.repeat(64);
  const request=new Request('https://origin.test/v1/account/password-change',{headers:{'x-pack1-network-id':NETWORK}});
  assert.throws(()=>trustedCredentialNetwork(request,{}),error=>error.status===503);
  assert.throws(()=>trustedCredentialNetwork(request,{PACK1_RATE_LIMIT_SECRET:secret}),error=>error.status===503);
  const proved=new Request('https://origin.test/v1/account/password-change',{headers:{
    'x-pack1-network-id':NETWORK,
    'x-pack1-network-proof':credentialNetworkProof(NETWORK,secret),
  }});
  assert.equal(trustedCredentialNetwork(proved,{PACK1_RATE_LIMIT_SECRET:secret}),NETWORK);
});

test('spoofable client network headers and forged internal digests cannot select credential identity',()=>{
  const secret='c'.repeat(64);
  const proof=credentialNetworkProof(NETWORK,secret);
  const request=new Request('https://origin.test/v1/account/password-change',{headers:{
    'x-pack1-network-id':NETWORK,
    'x-pack1-network-proof':proof,
    'x-forwarded-for':'203.0.113.99',
    'cf-connecting-ip':'203.0.113.100',
  }});
  assert.equal(trustedCredentialNetwork(request,{PACK1_RATE_LIMIT_SECRET:secret}),NETWORK);
  const forged=new Request('https://origin.test/v1/account/password-change',{headers:{
    'x-pack1-network-id':'d'.repeat(64),
    'x-pack1-network-proof':proof,
  }});
  assert.throws(()=>trustedCredentialNetwork(forged,{PACK1_RATE_LIMIT_SECRET:secret}),error=>error.status===503);
});

test('account deletion limiter purposes are accepted and remain UUID/network scoped',async()=>{
  for (const purpose of ['account_delete_verify','account_delete_init']) {
    const {query,calls}=fakeQuery(1);
    const result=await consumeCredentialLimit(query,{authUserId:USER,purpose,limit:8,seconds:900});
    assert.equal(result.limited,false);
    const insert=calls.find(row=>row.sql.includes('INSERT INTO account_credential_rate_limits'));
    assert.deepEqual(insert.params,[USER,purpose,'',900]);
  }
  const {query,calls}=fakeQuery(1);
  await consumeCredentialLimit(query,{authUserId:USER,purpose:'account_delete_network',networkHash:NETWORK,limit:5,seconds:900});
  const insert=calls.find(row=>row.sql.includes('INSERT INTO account_credential_rate_limits'));
  assert.deepEqual(insert.params,[USER,'account_delete_network',NETWORK,900]);
});

test('credential limiter writes fail closed once account deletion is tombstoned',async()=>{
  let seen='';
  await assert.rejects(
    consumeCredentialLimit(async(sql)=>{seen=sql;return {rows:[],rowCount:0};},{
      authUserId:USER,purpose:'account_delete_init',limit:3,seconds:900,
    }),
    error=>error?.code==='ACCOUNT_DELETING'&&error?.status===409,
  );
  assert.match(seen,/pack1_identity_attachment_allowed\(\$1::uuid\)/);
});

test('only successful callers explicitly clear a selected limiter bucket',async()=>{
  const {query,calls}=fakeQuery();
  await clearCredentialLimit(query,{authUserId:USER,purpose:'current_password'});
  const row=calls.at(-1);
  assert.match(row.sql,/DELETE FROM account_credential_rate_limits WHERE auth_user_id/);
  assert.deepEqual(row.params,[USER,'current_password','']);
});

test('migration 0030 is applied in both secure-auth release schema stages and verified everywhere',()=>{
  const workflow=readFileSync('.github/workflows/secure-auth-release.yml','utf8');
  const migration='migrations/0030_account_credential_limits.sql';
  assert.equal(workflow.split(migration).length-1,2,'0030 must appear once in development and once in production');
  const schema=readFileSync('worker/schema.sql','utf8');
  const verify=readFileSync('scripts/verify-neon-schema.mjs','utf8');
  assert.match(schema,/CREATE TABLE IF NOT EXISTS account_credential_rate_limits/);
  assert.match(verify,/account_credential_rate_limits/);
});


test('gateway allowlist and production control preserve authenticated credential network identity',()=>{
  const gateway=readFileSync('edge/gateway.mjs','utf8');
  const control=readFileSync('scripts/edge-production-control.mjs','utf8');
  assert.match(gateway,/\/v1\/account\/password-change/);
  assert.match(gateway,/CF-Connecting-IP|cf-connecting-ip/i);
  assert.match(gateway,/CREDENTIAL_PROOF_KEY/);
  assert.match(gateway,/x-pack1-network-proof/);
  assert.match(control,/CREDENTIAL_PROOF_KEY:credentialProof/);
  assert.match(control,/PACK1_RATE_LIMIT_SECRET/);
});

test('request-integrity docs distinguish signed-in credentials from signed-out recovery',()=>{
  const docs=readFileSync('docs/REQUEST-INTEGRITY.md','utf8');
  assert.match(docs,/first-party account session/);
  assert.match(docs,/allowLegacy:false/);
  assert.match(docs,/account-global failure budget/);
  assert.doesNotMatch(docs,/Provider capability gate/);
});
