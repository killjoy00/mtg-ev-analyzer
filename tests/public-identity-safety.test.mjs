import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PUBLIC_IDENTITY_TERMS_VERSION,
  assertPublicDisplayNameAllowed,
  normalizedReportDetails,
  normalizedReportReason,
  publicDisplayNameProblem,
  publicIdentityEligibility,
  publicIdentityTermsCurrent,
} from '../worker/public-identity-safety.mjs';

test('public identity filter allows ordinary player names and rejects clear abuse/impersonation/contact data',()=>{
  for(const name of ['Ryan','Draft Goblin','P1P1 Enjoyer','Jace Fan']) {
    assert.equal(publicDisplayNameProblem(name),null,name);
    assert.equal(assertPublicDisplayNameAllowed(name),name);
  }
  assert.equal(publicDisplayNameProblem('Pack One Support'),'reserved_identity');
  assert.equal(publicDisplayNameProblem('admin'),'reserved_identity');
  assert.equal(publicDisplayNameProblem('visit https://example.com'),'contact_or_url');
  assert.equal(publicDisplayNameProblem('me@example.com'),'contact_or_url');
  assert.equal(publicDisplayNameProblem('+1 (702) 555-1212'),'contact_or_url');
  assert.equal(publicDisplayNameProblem('Safe\u202EName'),'invisible_or_control');
  assert.equal(publicDisplayNameProblem('n4zi'),'clearly_prohibited');
  assert.throws(()=>assertPublicDisplayNameAllowed('Pack One Admin'),error=>error?.status===400&&error?.code==='USERNAME_NOT_ALLOWED');
});

test('public identity eligibility requires a signed-in owned name and fails closed after moderation',()=>{
  const accepted={
    auth_user_id:'11111111-1111-4111-8111-111111111111',
    username_owned:true,
    display_name:'Ryan',
    is_placeholder:false,
    public_identity_terms_version:PUBLIC_IDENTITY_TERMS_VERSION,
    public_identity_terms_accepted_at:'2026-09-30T00:00:00Z',
    public_identity_hidden_at:null,
  };
  assert.equal(publicIdentityTermsCurrent(accepted),true);
  assert.deepEqual(publicIdentityEligibility(accepted),{eligible:true,reason:null});
  assert.deepEqual(publicIdentityEligibility({...accepted,auth_user_id:null}),{eligible:false,reason:'guest'});
  // Acceptance is recorded at sign-in/save, never a separate ranking gate, so
  // players who predate the rules keep their leaderboard place.
  const legacy={...accepted,public_identity_terms_version:null,public_identity_terms_accepted_at:null};
  assert.equal(publicIdentityTermsCurrent(legacy),false);
  assert.deepEqual(publicIdentityEligibility(legacy),{eligible:true,reason:null});
  assert.deepEqual(publicIdentityEligibility({...accepted,public_identity_terms_version:'old'}),{eligible:true,reason:null});
  assert.deepEqual(publicIdentityEligibility({...accepted,public_identity_hidden_at:'2026-09-30T01:00:00Z'}),{eligible:false,reason:'moderated'});
  assert.deepEqual(publicIdentityEligibility({...accepted,username_owned:false,is_placeholder:true}),{eligible:false,reason:'username_required'});
  assert.deepEqual(publicIdentityEligibility({...accepted,username_owned:false,is_placeholder:false,display_name:'Taken Name'}),{eligible:false,reason:'username_taken'});
  assert.deepEqual(publicIdentityEligibility({...accepted,username_owned:false,is_placeholder:false,display_name:'Pack One Admin'}),{eligible:false,reason:'name_not_allowed'});
});

test('leaderboards rank signed-in owned names without a separate rules-acceptance gate',()=>{
  for(const file of ['../worker/draft-run-function.mjs','../worker/draft-run-season.mjs']) {
    const source=fs.readFileSync(new URL(file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/public_identity_terms/,file);
    assert.match(source,/public_identity_hidden_at IS NULL/,file);
  }
});

test('report reasons and details are bounded and normalized',()=>{
  assert.equal(normalizedReportReason(' IMPERSONATION '),'impersonation');
  assert.throws(()=>normalizedReportReason('anything-goes'),{status:400});
  assert.equal(normalizedReportDetails('  context  '),'context');
  assert.equal(normalizedReportDetails('  '),null);
  assert.throws(()=>normalizedReportDetails('x'.repeat(501)),{status:400});
});


test('public identity migration leaves merged guest nicknames unowned for the application filter to claim',()=>{
  const migration=fs.readFileSync(new URL('../migrations/0046_public_identity_safety.sql',import.meta.url),'utf8');
  assert.match(migration,/CREATE OR REPLACE FUNCTION merge_pack1_player/);
  assert.match(migration,/SET display_name = adopt_name, username_owned = false/);
  assert.doesNotMatch(migration,/SET display_name = adopt_name, username_owned = true/);
});
