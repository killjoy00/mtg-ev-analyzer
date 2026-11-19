import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PREVIOUS,TARGET,databaseOnlyEnvironments,carriedManifest,carryDatabaseEnvironments} from '../scripts/v6-carry-database-environments.mjs';

const v9={id:'fra',name:'Reality Fracture',discovered:true,regular_run:true,release_date:'2026-10-02',source_event_type:'PremierDraft',full_import:{corpus_version:PREVIOUS}};

function database({active=PREVIOUS,stored}={}) {
  const writes=[];
  const query=async(sql,params)=>{
    if(sql.includes('FROM draft_run_environment_policy p'))return {rows:active?[{manifest:JSON.stringify(v9),active_corpus_version:active}]:[]};
    if(sql.startsWith('INSERT INTO corpus_set_versions')){writes.push(params);return {rows:[]};}
    if(sql.startsWith('SELECT manifest FROM corpus_set_versions'))return {rows:[{manifest:stored??JSON.parse(writes.at(-1)[2])}]};
    throw Error('Unexpected SQL: '+sql);
  };
  return {query,writes};
}

test('only environments without a checked-in baseline are carried',()=>{
  assert.deepEqual(databaseOnlyEnvironments({sets:[{id:'fra'},{id:'blb'},{id:'hob'}]},{sets:[{id:'blb'},{id:'hob'}]}),['fra']);
  assert.deepEqual(databaseOnlyEnvironments({sets:[{id:'blb'}]},{sets:[{id:'blb'}]}),[]);
});

test('the v9 baseline is carried to v10 without its v9 import evidence',async()=>{
  const {full_import,...expected}=v9;
  assert.deepEqual(carriedManifest(JSON.stringify(v9),'fra'),expected);
  assert.throws(()=>carriedManifest(v9,'hob'),/different environment identity/);
  const {query,writes}=database();
  assert.deepEqual(await carryDatabaseEnvironments(query,['fra']),['fra']);
  assert.deepEqual(writes.map(([id,version,manifest])=>[id,version,JSON.parse(manifest)]),[['fra',TARGET,expected]]);
});

test('a resumed stage keeps its v10 evidence but refuses a different baseline or an inactive parent',async()=>{
  const resumed=database({stored:{...v9,full_import:{corpus_version:TARGET}}});
  assert.deepEqual(await carryDatabaseEnvironments(resumed.query,['fra']),['fra']);
  const changed=database({stored:{...v9,name:'Other'}});
  await assert.rejects(carryDatabaseEnvironments(changed.query,['fra']),/differs/);
  await assert.rejects(carryDatabaseEnvironments(database({active:TARGET}).query,['fra']),/must be active/);
  await assert.rejects(carryDatabaseEnvironments(database({active:null}).query,['fra']),/must be active/);
});

test('staging carries database-only environments before the v10 trophy import',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/release-v6-corpus.yml',import.meta.url),'utf8');
  const baseline=workflow.indexOf('node scripts/load_verified_draft_run.mjs');
  const carry=workflow.indexOf('node scripts/v6-carry-database-environments.mjs');
  const trophies=workflow.indexOf('node scripts/load_all_trophies.mjs "$RUNNER_TEMP/target.connection"');
  assert.ok(baseline>0&&baseline<carry&&carry<trophies,'baseline, then carried environments, then trophies');
});
