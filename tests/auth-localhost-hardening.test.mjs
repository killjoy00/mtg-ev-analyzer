import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseAllowLocalhostOutput,
  normalizeConfigSnapshot,
  validateRequestFile,
  socialStart,
  deleteAuthUser,
  PROD_AUTH_BASE,
  PROD_ORIGINS,
  QA_BRANCH,
  PROD_BRANCH,
} from '../scripts/auth-localhost-hardening.mjs';

test('allow-localhost CLI output parser requires a boolean',()=>{
  assert.equal(parseAllowLocalhostOutput('{"allow_localhost":true}'),true);
  assert.equal(parseAllowLocalhostOutput('[{"allow_localhost":false}]'),false);
  assert.throws(()=>parseAllowLocalhostOutput('{"allow_localhost":"false"}'),/boolean allow_localhost/);
});

test('Auth config snapshots normalize domains and OAuth rows deterministically',()=>{
  assert.deepEqual(normalizeConfigSnapshot({
    domains:[{domain:'https://b.example'},{domain:'https://a.example'}],
    emailPassword:{enabled:true},
    oauth:[{id:'google',type:'standard',client_id:'x'},{id:'github',type:'shared'}],
  }),{
    domains:['https://a.example','https://b.example'],
    emailPassword:{enabled:true},
    oauth:[
      {id:'github',type:'shared',client_id:null},
      {id:'google',type:'standard',client_id:'x'},
    ],
  });
});

test('review request permits only the fixed production-localhost operation',()=>{
  const good={operation:'disable-production-localhost',reason:'Issue #245 production Auth hardening.'};
  assert.equal(validateRequestFile(good),good);
  assert.throws(()=>validateRequestFile({...good,operation:'enable'}),/operation/);
  assert.throws(()=>validateRequestFile({...good,extra:true}),/keys/);
});

test('social probe sends an origin-bound Google OAuth start without following redirects',async()=>{
  let call=null;
  const result=await socialStart(async(url,init)=>{
    call={url,init};
    return Response.json({url:'https://accounts.google.com/o/oauth2/v2/auth?state=test'});
  },'https://auth.example.test','http://localhost:4173');
  assert.equal(result.status,200);
  assert.match(result.target,/^https:\/\/accounts\.google\.com\//);
  assert.equal(call.init.headers.origin,'http://localhost:4173');
  assert.equal(call.init.redirect,'manual');
  const body=JSON.parse(call.init.body);
  assert.equal(body.provider,'google');
  assert.equal(body.callbackURL,'http://localhost:4173/?auth=google');
  assert.equal(body.disableRedirect,true);
});

test('deleteAuthUser retries transient outcomes and succeeds without collapsing the type',async()=>{
  const calls=[];
  const waits=[];
  const userId='11111111-1111-4111-8111-111111111111';
  const result=await deleteAuthUser(PROD_BRANCH,userId,{
    removeUser:async options=>{
      calls.push(options);
      if(calls.length<3)return {kind:'transient',code:'PROVIDER_RATE_LIMIT'};
      return {kind:'success'};
    },
    sleepFn:async ms=>{waits.push(ms);},
  });
  assert.deepEqual(result,{kind:'success'});
  assert.equal(calls.length,3);
  assert.deepEqual(waits,[1000,3000]);
  assert.equal(calls[0].authBase,PROD_AUTH_BASE);
  assert.equal(calls[0].authUserId,userId);
  assert.equal(typeof calls[0].validateServicePrincipal,'function');
});

test('deleteAuthUser surfaces operator review distinctly and does not retry it',async()=>{
  let calls=0;
  await assert.rejects(
    deleteAuthUser(PROD_BRANCH,'22222222-2222-4222-8222-222222222222',{
      removeUser:async()=>{calls++;return {kind:'operator_review',code:'PROVIDER_FORBIDDEN'};},
      sleepFn:async()=>{throw Error('operator review must not sleep');},
    }),
    /requires operator review: PROVIDER_FORBIDDEN/
  );
  assert.equal(calls,1);
});

test('deleteAuthUser distinguishes exhausted transient cleanup after bounded retries',async()=>{
  let calls=0;
  const waits=[];
  await assert.rejects(
    deleteAuthUser(PROD_BRANCH,'33333333-3333-4333-8333-333333333333',{
      removeUser:async()=>{calls++;return {kind:'transient',code:'PROVIDER_RATE_LIMIT'};},
      sleepFn:async ms=>{waits.push(ms);},
    }),
    /transient after 3 attempts: PROVIDER_RATE_LIMIT/
  );
  assert.equal(calls,3);
  assert.deepEqual(waits,[1000,3000]);
});

test('hardening contract is QA-first, production-fixed, reversible on failure, and avoids Auth-table mutation',()=>{
  const source=fs.readFileSync(new URL('../scripts/auth-localhost-hardening.mjs',import.meta.url),'utf8');
  const workflow=fs.readFileSync(new URL('../.github/workflows/auth-localhost-hardening.yml',import.meta.url),'utf8');
  assert.equal(QA_BRANCH,'br-twilight-hill-ayffyd2b');
  assert.equal(PROD_BRANCH,'br-orange-feather-ayps8kep');
  assert.deepEqual(PROD_ORIGINS,[
    'https://packone.pro',
    'https://api.packone.pro',
    'https://magic.planitnow.us',
  ]);
  assert.match(source,/setAllowLocalhost\(QA_BRANCH,false\)/);
  assert.match(source,/setAllowLocalhost\(QA_BRANCH,true\)/);
  assert.match(source,/setAllowLocalhost\(PROD_BRANCH,false\)/);
  assert.match(source,/if\(changed\)[\s\S]*setAllowLocalhost\(PROD_BRANCH,true\)/);
  assert.match(source,/sign-up\/email/);
  assert.match(source,/sign-in\/email/);
  assert.match(source,/request-password-reset/);
  assert.match(source,/delivered@resend\.dev/);
  assert.match(source,/removeProviderUser/);
  assert.match(source,/SELECT count\(\*\) FROM account_links WHERE auth_user_id=/);
  assert.doesNotMatch(source,/DATABASE_URL|DELETE\s+FROM|UPDATE\s+neon_auth|INSERT\s+INTO\s+neon_auth/i);
  assert.doesNotMatch(source,/psql[\s\S]{0,400}?\b(DELETE|UPDATE|INSERT|TRUNCATE|ALTER)\b/i);
  assert.match(source,/runNeon\(\['psql',branch,'--project-id',PROJECT_ID,'--database-name','pack1'/);
  const rollbackIndex=source.indexOf('if(coreError){');
  const cleanupErrorIndex=source.indexOf('if(cleanupErrors.length)');
  assert.ok(rollbackIndex>=0&&cleanupErrorIndex>rollbackIndex,'cleanup errors must be thrown only after core rollback handling');
  assert.match(workflow,/pull_request:/);
  assert.match(workflow,/branches:\s*\[main\]/);
  assert.match(workflow,/github\.event_name == 'pull_request'/);
  assert.match(workflow,/NEON_API_KEY: \$\{\{ secrets\.NEON_API_KEY \}\}/);
  assert.match(workflow,/PACK1_DELETION_ADMIN_EMAIL: \$\{\{ secrets\.PACK1_DELETION_ADMIN_EMAIL \}\}/);
  assert.match(workflow,/PACK1_DELETION_ADMIN_PASSWORD: \$\{\{ secrets\.PACK1_DELETION_ADMIN_PASSWORD \}\}/);
  assert.match(workflow,/timeout-minutes: 10\n    env:\n      NEON_API_KEY: \$\{\{ secrets\.NEON_API_KEY \}\}\n    steps:/);
  assert.match(workflow,/timeout-minutes: 12[\s\S]*?PACK1_DELETION_ADMIN_EMAIL: \$\{\{ secrets\.PACK1_DELETION_ADMIN_EMAIL \}\}[\s\S]*?PACK1_DELETION_ADMIN_PASSWORD: \$\{\{ secrets\.PACK1_DELETION_ADMIN_PASSWORD \}\}[\s\S]*?steps:/);
  assert.match(workflow,/name: Prove localhost capability in QA and restore QA[\s\S]*?env:[\s\S]*?NEON_BIN: \$\{\{ runner\.temp \}\}/);
  assert.match(workflow,/name: Disable production localhost allowance and verify auth flows[\s\S]*?env:[\s\S]*?NEON_BIN: \$\{\{ runner\.temp \}\}/);
  assert.match(workflow,/neon@5\.0\.0/);
  assert.match(workflow,/auth-localhost-hardening\.mjs qa/);
  assert.match(workflow,/auth-localhost-hardening\.mjs production/);
});
