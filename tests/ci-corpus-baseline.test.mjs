import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {clonedCorpusMatchesCatalog} from '../scripts/ci-corpus-baseline.mjs';
import {DRAFT_RUN_CORPUS_VERSION} from '../draft-run.mjs';

const version=DRAFT_RUN_CORPUS_VERSION;
const legacy='a'.repeat(64),upgraded='b'.repeat(64);
const catalog={corpus_version:version,sets:[{id:'ktk',sha256:legacy},{id:'mom',sha256:legacy}]};
const legacyRow=(set_id)=>({set_id,checksum:legacy,active_version:version});
const upgradedRow=(set_id)=>({
  set_id,checksum:'c'.repeat(64),active_version:version,
  import_version:version,import_verified:'true',
  import_snapshot:upgraded,active_snapshot:upgraded,
});

test('current legacy corpus is accepted only with its exact catalog checksums',()=>{
  assert.equal(clonedCorpusMatchesCatalog(catalog,[legacyRow('ktk'),legacyRow('mom')]),true);
  assert.equal(clonedCorpusMatchesCatalog(catalog,[legacyRow('ktk'),{...legacyRow('mom'),checksum:'x'}]),false);
  assert.equal(clonedCorpusMatchesCatalog(catalog,[legacyRow('ktk')]),false);
  assert.equal(clonedCorpusMatchesCatalog({corpus_version:version,sets:[]},[]),false);
});

test('verified upgraded import tied to its active snapshot is a current corpus baseline',()=>{
  assert.equal(clonedCorpusMatchesCatalog(catalog,[upgradedRow('ktk'),upgradedRow('mom')]),true);
  assert.equal(clonedCorpusMatchesCatalog(catalog,[legacyRow('ktk'),upgradedRow('mom')]),true);
  assert.equal(clonedCorpusMatchesCatalog(catalog,[upgradedRow('ktk'),upgradedRow('mom'),{set_id:'fra'}]),true,
    'an added live set should not invalidate otherwise verified catalog sets');
});

test('upgraded import cannot pass on mismatched version, unverified schema or changed snapshot',()=>{
  const bad=[
    {import_version:'previous-corpus'},
    {active_version:'previous-corpus'},
    {import_verified:'false'},
    {import_verified:null},
    {import_snapshot:'d'.repeat(64)},
    {active_snapshot:'d'.repeat(64)},
    {import_snapshot:'invalid'},
    {import_snapshot:null},
  ];
  for(const change of bad)
    assert.equal(clonedCorpusMatchesCatalog(catalog,[upgradedRow('ktk'),{...upgradedRow('mom'),...change}]),false,
      JSON.stringify(change));
});

test('backend CI imports the validator in the same heredoc that uses it',()=>{
  const workflow=fs.readFileSync(new URL('../.github/workflows/backend-gate.yml',import.meta.url),'utf8');
  const marker="current_baseline=$(node --input-type=module - <<'NODE'";
  assert.ok(workflow.includes(marker));
  const script=workflow.split(marker)[1].split('\n          NODE')[0];
  assert.match(script,/import \{clonedCorpusMatchesCatalog\} from '\.\/scripts\/ci-corpus-baseline\.mjs'/);
  assert.match(script,/console\.log\(clonedCorpusMatchesCatalog\(catalog,rows\)\)/);
});
