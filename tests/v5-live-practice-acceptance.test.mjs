import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import catalog from '../corpus/draft-run/catalog.json' with {type:'json'};
import {assertPracticeReleaseCoverage} from '../scripts/practice-release-coverage.mjs';

const smoke=fs.readFileSync(new URL('./v5-live-practice-acceptance.mjs',import.meta.url),'utf8');
const deploy=fs.readFileSync(new URL('../.github/workflows/deploy-functions.yml',import.meta.url),'utf8');

test('v5 live Practice acceptance uses the protected connection file boundary',()=>{
  assert.match(smoke,/corpusDatabase\(connectionFile\)/);
  assert.doesNotMatch(smoke,/corpusDatabase\(connection\)/);
  assert.match(deploy,/printf '%s' "\$connection" > "\$RUNNER_TEMP\/target\.connection"/);
  assert.match(deploy,/v5-live-practice-acceptance\.mjs "\$TARGET_BRANCH" "\$RELEASE_COMMIT" "\$RUNNER_TEMP\/target\.connection"/);
  assert.match(deploy,/v5-live-practice-acceptance\.mjs br-twilight-hill-ayffyd2b "\$RELEASE_COMMIT" "\$RUNNER_TEMP\/development\.connection"/);
});

test('v5 live Practice acceptance completes and persists every required Practice family',()=>{
  assert.match(smoke,/mixed=await finish\(mixed,owner\)/);
  assert.match(smoke,/replay=await finish\(replay,peer\)/);
  assert.match(smoke,/cube=await finish\(cube,owner\)/);
  assert.match(smoke,/latestRun=await finish\(latestRun,owner\)/);
  assert.match(smoke,/archiveRun=await finish\(archiveRun,owner\)/);
  assert.match(smoke,/lateRun=await finish\(lateRun,owner\)/);
  assert.match(smoke,/mixedLateRun=await finish\(mixedLateRun,owner\)/);
  assert.match(smoke,/customPracticeCoverage\(servingGroups\)/);
  assert.doesNotMatch(smoke,/'(tmt|ecl|tla)'/,'P1P2 openings are found from coverage, not set names');
  assert.match(smoke,/client_result_id=\$2/);
  assert.match(smoke,/Number\(ranked\.n\),0/);
  assert.match(smoke,/assertPracticeReleaseCoverage\(coverage/);
});

const options={requiredSetIds:catalog.sets.map(set=>set.id),corpusVersion:catalog.corpus_version};
const baseline=()=>catalog.sets.map(set=>({set_id:set.id,corpus_version:catalog.corpus_version,lifecycle_status:'Approved'}));
const additional={set_id:'later-set',corpus_version:catalog.corpus_version,lifecycle_status:'Approved'};

test('release coverage retains every rebuilt identity and accepts a later approved set',()=>{
  const rows=baseline();
  rows[0].lifecycle_status='Candidate'; // Retired baseline sets retain their existing version requirement.
  assert.deepEqual(assertPracticeReleaseCoverage(rows,options),{required:rows.length,covered:rows.length,additional:0});
  assert.deepEqual(assertPracticeReleaseCoverage([...rows,additional],options),{required:rows.length,covered:rows.length+1,additional:1});
});

test('an approved addition cannot hide a missing or duplicated rebuilt environment',()=>{
  const rows=baseline();
  assert.throws(()=>assertPracticeReleaseCoverage([...rows.slice(1),additional],options),/Missing rebuilt environment/);
  assert.throws(()=>assertPracticeReleaseCoverage([...rows.slice(1),rows[1]],options),/Duplicate environment/);
});

test('release coverage rejects missing pointers, wrong corpus versions and unapproved additions',()=>{
  for(const corpus_version of [null,'other-corpus']) {
    const rows=baseline();rows[0]={...rows[0],corpus_version};
    assert.throws(()=>assertPracticeReleaseCoverage(rows,options),/must point at the released corpus/);
    assert.throws(()=>assertPracticeReleaseCoverage([...baseline(),{...additional,corpus_version}],options),/must point at the released corpus/);
  }
  assert.throws(()=>assertPracticeReleaseCoverage([...baseline(),{...additional,lifecycle_status:'Candidate'}],options),/must have an approved snapshot/);
});
