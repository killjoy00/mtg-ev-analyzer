import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseAllowLocalhostOutput,
  normalizeConfigSnapshot,
  validateRequestFile,
  socialStart,
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
  assert.doesNotMatch(source,/\bpsql\b|DATABASE_URL|DELETE\s+FROM|UPDATE\s+neon_auth|INSERT\s+INTO\s+neon_auth/i);
  assert.match(workflow,/release\/245-disable-localhost/);
  assert.match(workflow,/branches:\s*\[main, release\/245-disable-localhost\]/);
  assert.match(workflow,/NEON_API_KEY: \$\{\{ secrets\.NEON_API_KEY \}\}/);
  assert.match(workflow,/neon@4\.17\.4/);
  assert.match(workflow,/auth-localhost-hardening\.mjs qa/);
  assert.match(workflow,/auth-localhost-hardening\.mjs production/);
});
