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

test('verification taxonomy probe is pinned to the disposable QA Auth project',()=>{
  assert.equal(PROJECT,'late-fire-55708539');
  assert.equal(BRANCH,'br-super-snow-b5ufhq30');
  const source=fs.readFileSync(new URL('../scripts/auth-verification-taxonomy-probe.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/patient-shadow-91417882|br-orange-feather-ayps8kep|br-twilight-hill-ayffyd2b/);
  assert.match(source,/finally\s*\{/);
  assert.match(source,/updateEmailConfig\(originalEmail\)/);
  assert.match(source,/webhookUpdate\(neon,originalWebhook\)/);
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
