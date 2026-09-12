import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {generateKeyPairSync,sign} from 'node:crypto';
import {verifyImportToken,IMPORT_WORKFLOW,IMAGE_REFRESH_WORKFLOW} from '../worker/trophy-import-auth.mjs';
import {insertTrophyBatch,handleTrophyImport,refreshTrophyImages} from '../worker/trophy-import.mjs';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test',use:'sig'};
const claims={
  iss:'https://token.actions.githubusercontent.com',
  aud:'pack-one-trophy-import',
  sub:'repo:killjoy00/mtg-ev-analyzer:ref:refs/heads/main',
  repository:'killjoy00/mtg-ev-analyzer',
  repository_id:'1201587098',
  repository_owner_id:'211694413',
  ref:'refs/heads/main',
  workflow_ref:IMPORT_WORKFLOW,
  event_name:'push',
  iat:900,nbf:900,exp:1200,run_id:'123',sha:'abc',
};
function token(c=claims,alg='RS256'){
  const body=[{alg,typ:'JWT',kid:'test'},c].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
  return body+'.'+sign('RSA-SHA256',Buffer.from(body),privateKey).toString('base64url');
}

test('only the signed main import or Cube image workflow is authorized',async()=>{
  assert.deepEqual(
    await verifyImportToken(token(),async()=>[jwk],1000),
    {run_id:'123',sha:'abc',workflow_ref:IMPORT_WORKFLOW},
  );
  assert.deepEqual(
    await verifyImportToken(token({...claims,job_workflow_ref:IMPORT_WORKFLOW}),async()=>[jwk],1000),
    {run_id:'123',sha:'abc',workflow_ref:IMPORT_WORKFLOW},
  );
  assert.deepEqual(
    await verifyImportToken(token({...claims,workflow_ref:IMAGE_REFRESH_WORKFLOW,job_workflow_ref:IMAGE_REFRESH_WORKFLOW}),async()=>[jwk],1000),
    {run_id:'123',sha:'abc',workflow_ref:IMAGE_REFRESH_WORKFLOW},
  );
  for(const changed of [
    {repository:'attacker/repo'},
    {repository_id:'2'},
    {repository_owner_id:'3'},
    {ref:'refs/heads/other'},
    {workflow_ref:'killjoy00/mtg-ev-analyzer/.github/workflows/other.yml@refs/heads/main'},
    {event_name:'pull_request'},
    {sub:'repo:killjoy00/mtg-ev-analyzer:pull_request'},
    {aud:'other'},
    {iss:'https://attacker.example'},
    {exp:999},
    {nbf:1100},
    {iat:1100},
    {exp:2000},
    {job_workflow_ref:'reusable'},
  ])await assert.rejects(verifyImportToken(token({...claims,...changed}),async()=>[jwk],1000),/denied/);
  await assert.rejects(verifyImportToken(token(claims,'HS256'),async()=>[jwk],1000),/denied/);
  const parts=token().split('.');
  parts[2]=Buffer.alloc(256).toString('base64url');
  await assert.rejects(verifyImportToken(parts.join('.'),async()=>[jwk],1000),/denied/);
});

test('unsigned callers and invalid batches cannot touch SQL',async()=>{
  const query=()=>{throw Error('SQL must not run');};
  await assert.rejects(handleTrophyImport(new Request('https://example/v1/trophy-import',{method:'POST',body:'{}'}),query),/denied/);
  await assert.rejects(insertTrophyBatch(query,[]),/Invalid batch/);
  await assert.rejects(insertTrophyBatch(query,[{set_id:'hob',puzzle_id:'x'}]),/Invalid verified puzzle/);
});

test('Cube image refresh changes display metadata only',async()=>{
  const rows=JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('../corpus/draft-run/powered-cube.json.gz',import.meta.url))));
  const sample=structuredClone(rows[0]);
  const original=structuredClone(sample);
  let stored=sample;
  const query=async(sql,params=[])=>{
    if(sql.startsWith('SELECT puzzle_id,payload')){
      return {rows:stored.puzzle_id>String(params[2]||'')?[{puzzle_id:stored.puzzle_id,payload:stored}]:[]};
    }
    if(sql.includes('UPDATE draft_run_verified_puzzles')){
      const updates=JSON.parse(params[0]);
      assert.equal(updates.length,1);
      stored=updates[0].payload;
      return {rows:[{puzzle_id:stored.puzzle_id}]};
    }
    throw new Error('Unexpected SQL in image refresh test: '+sql);
  };
  const target=sample.candidates[0];
  const replacement='https://cards.example/standard-readable.jpg';
  const mapping=[{
    name:target.name,
    image_url:replacement,
    mana_cost:target.mana_cost||'',
    rarity:target.rarity||'',
    type_line:target.type_line||'',
  }];
  const result=await refreshTrophyImages(query,'powered-cube',mapping);
  assert.equal(result.puzzles,1);
  assert.equal(result.updated_puzzles,1);
  assert.ok(result.updated_cards>=1);
  assert.equal(stored.candidates.find(card=>card.name===target.name).image_url,replacement);
  assert.equal(stored.puzzle_id,original.puzzle_id);
  assert.equal(stored.source_fingerprint,original.source_fingerprint);
  assert.equal(stored.historical_pick_id,original.historical_pick_id);
  assert.deepEqual(
    stored.candidates.map(card=>({id:card.id,name:card.name,model_probability:card.model_probability})),
    original.candidates.map(card=>({id:card.id,name:card.name,model_probability:card.model_probability})),
  );
  await assert.rejects(refreshTrophyImages(query,'msh',mapping),/limited to Powered Cube/);
  await assert.rejects(refreshTrophyImages(query,'powered-cube',[{name:target.name,image_url:'http://bad.example/card.jpg'}]),/Invalid image mapping/);
});
