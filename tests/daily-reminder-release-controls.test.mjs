// The protected secure-auth workflow is the only activation boundary for
// independently approved Daily email/push channels. Exercise its actual shell
// bodies with synthetic values, without running a deployment or using secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const workflow=readFileSync('.github/workflows/secure-auth-release.yml','utf8');
const lines=workflow.split('\n');
function step(name) {
  const start=lines.findIndex(line=>line==='      - name: '+name);
  assert.ok(start>=0,'Release workflow step not found: '+name);
  let end=start+1;
  while(end<lines.length&&!lines[end].startsWith('      - name: ')&&!lines[end].startsWith('      - uses: '))end++;
  const run=lines.findIndex((line,i)=>i>start&&i<end&&line==='        run: |');
  assert.ok(run>=0,'Release step lacks actual shell: '+name);
  return lines.slice(run+1,end).map(line=>line.startsWith('          ')?line.slice(10):line).join('\n');
}
const validation=step('Validate independently approved Daily reminder channels');
function channelBlock(name) {
  const script=step(name);
  const begin=script.indexOf('# Deploy default-off switches for each channel.');
  const last='if [[ -n "$PACK1_EXPO_PUSH_ACCESS_TOKEN" ]]; then extra+=(--env "PACK1_EXPO_PUSH_ACCESS_TOKEN=$PACK1_EXPO_PUSH_ACCESS_TOKEN"); fi';
  const finish=script.indexOf(last,begin);
  assert.ok(begin>=0&&finish>begin,'Independent activation not wired in: '+name);
  return script.slice(begin,finish+last.length);
}
const dev=channelBlock('Deploy exact revision to development');
const prod=channelBlock('Deploy the development-tested revision to production');
const base={
  PACK1_REMINDER_EMAIL_APPROVED:'',
  PACK1_REMINDER_PUSH_APPROVED:'',
  PACK1_REMINDER_RESEND_API_KEY:'',
  PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'',
  PACK1_REMINDER_RESEND_WEBHOOK_SECRET:'',
  PACK1_REMINDER_TOKEN_KEY:'',
  PACK1_EXPO_PUSH_ACCESS_TOKEN:'',
};
const validEmail={PACK1_REMINDER_RESEND_API_KEY:'re_synthetic_sender',PACK1_REMINDER_RESEND_WEBHOOK_SECRET:'whsec_synthetic_only'};
const validPush={PACK1_REMINDER_TOKEN_KEY:'a'.repeat(64)};
function run(script,overrides={},readArgs=false) {
  const env={PATH:process.env.PATH||'/usr/bin:/bin',...base,...overrides};
  const command=(readArgs?'extra=()\n':'')+script+(readArgs?'\nprintf "%s\\n" "${extra[@]}"':'');
  const result=spawnSync('bash',['-e','-u','-o','pipefail','-c',command],{encoding:'utf8',env,timeout:5000});
  const args=result.stdout.trim()?result.stdout.trim().split('\n'):[];
  const passed=result.status===0;
  if(readArgs&&passed) {
    assert.equal(args.length%2,0);
    const values={};
    for(let i=0;i<args.length;i+=2) {assert.equal(args[i],'--env');const at=args[i+1].indexOf('=');values[args[i+1].slice(0,at)]=args[i+1].slice(at+1);}
    return {passed,values};
  }
  return {passed};
}
test('both release branches use identical, default-off independent channel controls',()=>{
  assert.equal(dev,prod);
  assert.match(workflow,/environment: pack-one-mobile-release/);
  assert.match(workflow,/paths: \['\.github\/secure-auth-release-request\.json'\]/);
  assert.equal((workflow.match(/migrations\/0061_daily_reminders\.sql/g)||[]).length,2);
  assert.equal((workflow.match(/migrations\/0062_daily_email_reminder_admission\.sql/g)||[]).length,2);
  assert.doesNotMatch(workflow,/PACK1_REMINDER_DELIVERY_APPROVED|PACK1_DAILY_REMINDERS_ENABLED/);
  assert.deepEqual(run(dev,{},true).values.PACK1_REMINDER_EMAIL_ENABLED,'0');
  assert.deepEqual(run(prod,{},true).values.PACK1_REMINDER_PUSH_ENABLED,'0');
});
test('email and push activate separately with only their own credentials',()=>{
  for(const script of [dev,prod]) {
    const none=run(script,{},true);
    assert.deepEqual([none.values.PACK1_REMINDER_EMAIL_ENABLED,none.values.PACK1_REMINDER_PUSH_ENABLED],['0','0']);
    const email=run(script,{...validEmail,PACK1_REMINDER_EMAIL_APPROVED:'1'},true);
    assert.deepEqual([email.values.PACK1_REMINDER_EMAIL_ENABLED,email.values.PACK1_REMINDER_PUSH_ENABLED],['1','0']);
    assert.equal(email.values.PACK1_REMINDER_TOKEN_KEY,undefined);
    const push=run(script,{...validPush,PACK1_REMINDER_PUSH_APPROVED:'1'},true);
    assert.deepEqual([push.values.PACK1_REMINDER_EMAIL_ENABLED,push.values.PACK1_REMINDER_PUSH_ENABLED],['0','1']);
    const both=run(script,{...validEmail,...validPush,PACK1_REMINDER_EMAIL_APPROVED:'1',PACK1_REMINDER_PUSH_APPROVED:'1'},true);
    assert.deepEqual([both.values.PACK1_REMINDER_EMAIL_ENABLED,both.values.PACK1_REMINDER_PUSH_ENABLED],['1','1']);
    const fallback=run(script,{PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_synthetic_fallback',PACK1_REMINDER_RESEND_WEBHOOK_SECRET:'whsec_synthetic_only',PACK1_REMINDER_EMAIL_APPROVED:'1'},true);
    assert.equal(fallback.values.PACK1_REMINDER_RESEND_API_KEY,'re_synthetic_fallback');
    assert.equal(fallback.values.PACK1_REMINDER_PUSH_ENABLED,'0');
  }
});
test('protected preflight fails closed on missing or malformed approvals/credentials',()=>{
  assert.equal(run(validation,{}).passed,true);
  assert.equal(run(validation,{...validEmail,PACK1_REMINDER_EMAIL_APPROVED:'1'}).passed,true);
  assert.equal(run(validation,{...validPush,PACK1_REMINDER_PUSH_APPROVED:'1'}).passed,true);
  assert.equal(run(validation,{...validEmail,...validPush,PACK1_REMINDER_EMAIL_APPROVED:'1',PACK1_REMINDER_PUSH_APPROVED:'1'}).passed,true);
  assert.equal(run(validation,{PACK1_REMINDER_EMAIL_APPROVED:'true'}).passed,false);
  assert.equal(run(validation,{PACK1_REMINDER_EMAIL_APPROVED:'1'}).passed,false);
  assert.equal(run(validation,{PACK1_REMINDER_EMAIL_APPROVED:'1',PACK1_REMINDER_RESEND_API_KEY:'re_synthetic_sender'}).passed,false);
  assert.equal(run(validation,{PACK1_REMINDER_PUSH_APPROVED:'1',PACK1_REMINDER_TOKEN_KEY:'short'}).passed,false);
  assert.equal(run(validation,{PACK1_REMINDER_EMAIL_APPROVED:'1',PACK1_ACCOUNT_DELETE_RESEND_API_KEY:'re_synthetic_fallback',PACK1_REMINDER_RESEND_WEBHOOK_SECRET:'whsec_synthetic_only'}).passed,true);
});
