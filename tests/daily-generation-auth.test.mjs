import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {
  DAILY_GENERATION_AUDIENCE,
  DAILY_GENERATION_WORKFLOW,
  verifyDailyGenerationToken,
} from '../worker/daily-generation-auth.mjs';

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'daily-test',use:'sig',alg:'RS256'};
const now=1_800_000_000;
const claims={
  iss:'https://token.actions.githubusercontent.com',
  aud:DAILY_GENERATION_AUDIENCE,
  sub:'repo:killjoy00/mtg-ev-analyzer:ref:refs/heads/main',
  repository:'killjoy00/mtg-ev-analyzer',
  repository_id:'1201587098',
  repository_owner_id:'211694413',
  ref:'refs/heads/main',
  workflow_ref:DAILY_GENERATION_WORKFLOW,
  event_name:'workflow_dispatch',
  iat:now,nbf:now,exp:now+300,
  run_id:'123',sha:'a'.repeat(40),
};
function token(c=claims,alg='RS256') {
  const body=[{alg,typ:'JWT',kid:'daily-test'},c].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  return body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');
}
const getKeys=async()=>[jwk];

test('Daily generation accepts only the exact reviewed main workflow identity',async()=>{
  assert.deepEqual(await verifyDailyGenerationToken(token(),getKeys,now),{
    run_id:'123',sha:'a'.repeat(40),workflow_ref:DAILY_GENERATION_WORKFLOW,
  });
  assert.equal((await verifyDailyGenerationToken(token({...claims,event_name:'schedule'}),getKeys,now)).run_id,'123');
});

test('Daily generation rejects forged or widened GitHub identities',async()=>{
  const invalid=[
    {...claims,aud:'wrong'},
    {...claims,repository:'someone/else'},
    {...claims,repository_id:'999'},
    {...claims,repository_owner_id:'999'},
    {...claims,ref:'refs/heads/feature'},
    {...claims,workflow_ref:'killjoy00/mtg-ev-analyzer/.github/workflows/other.yml@refs/heads/main'},
    {...claims,event_name:'push'},
    {...claims,exp:now-1},
  ];
  for(const row of invalid)await assert.rejects(verifyDailyGenerationToken(token(row),getKeys,now),e=>e?.status===403);
  await assert.rejects(verifyDailyGenerationToken('forged',getKeys,now),e=>e?.status===403);
});
