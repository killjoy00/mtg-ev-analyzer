import test from 'node:test';import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyImportToken} from '../worker/trophy-import-auth.mjs';
import {insertTrophyBatch,handleTrophyImport} from '../worker/trophy-import.mjs';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test',use:'sig'};
const claims={iss:'https://token.actions.githubusercontent.com',aud:'pack-one-trophy-import',sub:'repo:killjoy00/mtg-ev-analyzer:ref:refs/heads/main',repository:'killjoy00/mtg-ev-analyzer',repository_id:'1201587098',repository_owner_id:'211694413',ref:'refs/heads/main',workflow_ref:'killjoy00/mtg-ev-analyzer/.github/workflows/import-all-trophies.yml@refs/heads/main',event_name:'push',iat:900,nbf:900,exp:1200,run_id:'123',sha:'abc'};
function token(c=claims,alg='RS256'){const body=[{alg,typ:'JWT',kid:'test'},c].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');}
test('only the signed main import workflow is authorized',async()=>{
  assert.deepEqual(await verifyImportToken(token(),async()=>[jwk],1000),{run_id:'123',sha:'abc'});
  for(const changed of [{repository:'attacker/repo'},{repository_id:'2'},{repository_owner_id:'3'},{ref:'refs/heads/other'},{workflow_ref:claims.workflow_ref.replace('import-all-trophies','other')},{event_name:'pull_request'},{sub:'repo:killjoy00/mtg-ev-analyzer:pull_request'},{aud:'other'},{iss:'https://attacker.example'},{exp:999},{nbf:1100},{iat:1100},{exp:2000},{job_workflow_ref:'reusable'}])await assert.rejects(verifyImportToken(token({...claims,...changed}),async()=>[jwk],1000),/denied/);
  await assert.rejects(verifyImportToken(token(claims,'HS256'),async()=>[jwk],1000),/denied/);
  const parts=token().split('.');parts[2]=Buffer.alloc(256).toString('base64url');await assert.rejects(verifyImportToken(parts.join('.'),async()=>[jwk],1000),/denied/);
});
test('unsigned callers and invalid batches cannot touch SQL',async()=>{
  const query=()=>{throw Error('SQL must not run');};
  await assert.rejects(handleTrophyImport(new Request('https://example/v1/trophy-import',{method:'POST',body:'{}'}),query),/denied/);
  await assert.rejects(insertTrophyBatch(query,[]),/Invalid batch/);
  await assert.rejects(insertTrophyBatch(query,[{set_id:'hob',puzzle_id:'x'}]),/Invalid verified puzzle/);
});
