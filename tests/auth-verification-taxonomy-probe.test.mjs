import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  PROJECT,
  BRANCH,
  safeEmailConfig,
  verificationConfigForMode,
} from '../scripts/auth-verification-taxonomy-probe.mjs';
import {sanitizedPayload} from '../edge/auth-webhook-probe.mjs';

test('verification taxonomy probe is pinned to one disposable non-serving Pack One Auth branch',()=>{
  assert.equal(PROJECT,'patient-shadow-91417882');
  assert.equal(BRANCH,'br-square-water-ay71uef3');
  const source=fs.readFileSync(new URL('../scripts/auth-verification-taxonomy-probe.mjs',import.meta.url),'utf8');
  const stage=fs.readFileSync(new URL('../scripts/auth-webhook-probe-stage.mjs',import.meta.url),'utf8');
  for(const forbidden of ['br-orange-feather-ayps8kep','br-twilight-hill-ayffyd2b','ep-hidden-bonus-ayfmcpys','ep-spring-dream-ayq2a5qt']){
    assert.ok(!source.includes(forbidden));
    assert.ok(!stage.includes(forbidden));
  }
  assert.match(source,/br-square-water-ay71uef3/);
  assert.match(source,/ep-weathered-surf-ay5urlmr/);
  assert.match(stage,/ep-weathered-surf-ay5urlmr/);
  assert.match(source,/finally\s*\{/);
  assert.match(source,/updateEmailConfig\(neon,originalEmail\)/);
  assert.match(source,/webhookUpdate\(neon,originalWebhook\)/);
  assert.match(source,/neon-auth','config','email-password','update/);
  assert.match(source,/origin:'https:\/\/packone\.pro'/);
  assert.doesNotMatch(source,/origin:'http:\/\/localhost/);
  assert.match(source,/delivered@resend\.dev/);
  assert.doesNotMatch(source,/await probeMode\('otp'/);
  assert.match(source,/await probeMode\('link'/);
});

test('verification state fallback is read-only and never emits credential contents',()=>{
  const source=fs.readFileSync(new URL('../scripts/auth-verification-taxonomy-probe.mjs',import.meta.url),'utf8');
  assert.match(source,/run\(neon,\['psql',BRANCH,'--project-id',PROJECT,'--database-name','pack1','--','-XAtc',sql\]\)/);
  assert.match(source,/SELECT json_build_object\(/);
  assert.match(source,/FROM neon_auth\."user"/);
  assert.match(source,/LEFT JOIN neon_auth\.verification/);
  assert.match(source,/replace\(v\.identifier,lower\(u\.email\),'<email>'\)/);
  assert.doesNotMatch(source,/\b(?:DELETE|UPDATE|INSERT|TRUNCATE|ALTER)\s+(?:TABLE\s+)?neon_auth\./i);
  const passwordLogs=source.match(/console\.log\([^\n]*password[^\n]*\)/gi)||[];
  assert.deepEqual(passwordLogs,["console.log('::add-mask::'+password)"]);
  assert.doesNotMatch(source,/console\.log\([^\n]*(?:email\s*[,+]|v\.value)/i);
});

test('verification modes change only the intended email/password policy fields',()=>{
  const original=safeEmailConfig({
    enabled:true,
    email_verification_method:'otp',
    require_email_verification:false,
    auto_sign_in_after_verification:true,
    send_verification_email_on_sign_up:false,
    send_verification_email_on_sign_in:false,
    disable_sign_up:false,
  });
  assert.deepEqual(verificationConfigForMode(original,'otp'),{
    ...original,
    email_verification_method:'otp',
    require_email_verification:true,
    send_verification_email_on_sign_up:true,
  });
  assert.deepEqual(verificationConfigForMode(original,'link'),{
    ...original,
    email_verification_method:'link',
    require_email_verification:true,
    send_verification_email_on_sign_up:true,
  });
  assert.throws(()=>verificationConfigForMode(original,'other'),/Unsupported verification probe mode/);
});

test('sanitized webhook evidence records OTP/link shape without retaining secret values',async()=>{
  const payload={
    event_type:'send.otp',
    event_id:'evt_test',
    user:{email:'secret@example.com'},
    event_data:{
      link_type:'email-verification',
      link_url:'https://example.test/verify?token=secret-token',
      token:'secret-token',
      otp:'123456',
      template:{subject:'secret subject',html:'secret body'},
    },
  };
  const evidence=await sanitizedPayload(new TextEncoder().encode(JSON.stringify(payload)));
  assert.equal(evidence.event_type_payload,'send.otp');
  assert.equal(evidence.link_type,'email-verification');
  assert.equal(evidence.link_host,'example.test');
  assert.equal(evidence.token_present,true);
  assert.equal(evidence.token_length,'secret-token'.length);
  assert.equal(evidence.otp_present,true);
  assert.equal(evidence.otp_length,6);
  assert.deepEqual(evidence.event_data_keys,['link_type','link_url','otp','template','token']);
  assert.deepEqual(evidence.template_shape,{subject:'string',html:'string'});
  const serialized=JSON.stringify(evidence);
  for(const secret of ['secret@example.com','secret-token','123456','secret subject','secret body'])
    assert.ok(!serialized.includes(secret));
});

test('Auth probe staging waits for Workers.dev propagation before failing',()=>{
  const source=fs.readFileSync(new URL('../scripts/auth-webhook-probe-stage.mjs',import.meta.url),'utf8');
  assert.match(source,/for\(let i=0;i<20;i\+=1\)/);
  assert.match(source,/await sleep\(750\)/);
  assert.match(source,/if\(response\.ok\)return/);
  assert.match(source,/Temporary Auth probe Worker health check failed/);
});
