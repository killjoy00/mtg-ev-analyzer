import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const repair=read('migrations/0070_v6_bridge_baseline_membership.sql');
const workflow=read('.github/workflows/release-v6-corpus.yml');
const cutover=read('scripts/v6-corpus-cutover.mjs');

test('builder and carry check bridge a superseded first-class snapshot instead of the baseline',()=>{
  const functions=repair.split('CREATE OR REPLACE FUNCTION ').slice(1);
  assert.deepEqual(functions.map(f=>f.slice(0,f.indexOf('('))),['pack1_build_serving_snapshot','pack1_serving_snapshot_matches_current']);
  for(const body of functions) {
    // 0049's historical bridge stays for sets whose baseline was what they served.
    assert.match(body,/has_historical_parent/);
    assert.match(body,/f\.schema_version<>'historical-frozen' AND f\.superseded_by=e\.active_snapshot_id\s*\) superseded_first_class/);
    assert.match(body,/e\.has_historical_parent AND NOT e\.superseded_first_class AND e\.active_corpus_version<>p\.corpus_version/);
    assert.match(body,/previous\.superseded_by=e\.active_snapshot_id/);
  }
});

test('0070 follows 0069 wherever the release plans apply it',()=>{
  const manifest=JSON.parse(read('migrations/manifest.json'));
  const lists=[manifest.ordered,...Object.values(manifest.release_paths).map(p=>p.migrations)].filter(l=>l.includes('0069_v6_colour_components.sql'));
  assert.ok(lists.length>1);
  for(const list of lists)assert.equal(list[list.indexOf('0069_v6_colour_components.sql')+1],'0070_v6_bridge_baseline_membership.sql');
});

test('the release applies the repair before any readiness or pointer change',()=>{
  const at=text=>{const i=workflow.indexOf(text);assert.ok(i>0,text);return i;};
  assert.ok(at('-f migrations/0069_v6_colour_components.sql')<at('-f migrations/0070_v6_bridge_baseline_membership.sql'));
  const repairStep=at('Apply the reviewed bridge membership repair before readiness changes');
  assert.match(workflow.slice(repairStep,repairStep+400),/if: inputs\.action == 'activate' \|\| inputs\.action == 'resume-activation'/);
  for(const later of ['Require exact bridge revision before pointer mutation','Atomically activate all v10 parent snapshots','Reverify committed parents and recover readiness'])
    assert.ok(repairStep<at(later),later);
});

test('resume recovers the bridge only by exact equivalence, after v10 is ready',()=>{
  const resume=cutover.slice(cutover.indexOf("if(action==='resume-activation')"),cutover.indexOf("if(action==='activate')"));
  const recovery=resume.indexOf('const recovered=(await query(');
  assert.ok(resume.indexOf("Published v10 parents are not ready")<recovery&&recovery<resume.indexOf('parentReady(PREVIOUS)'));
  assert.match(resume,/pack1_serving_snapshot_matches_current\(k\.corpus_version,k\.difficulty_version,k\.serving_policy_version,prior\.cache_snapshot_id\)/);
  assert.match(resume,/j\.evidence->'inventory'->>'verified'='true'/);
  // Activation and rollback remain the only pointer statements the contract executes.
  assert.equal([...cutover.matchAll(/const result=\(await query\(`/g)].length,2);
});

test('a resumed publication accepts components it already published',()=>{
  const step=workflow.slice(workflow.indexOf('Reverify committed parents and recover readiness'),workflow.indexOf('Publish only eligible v6 Traditional components'));
  assert.match(step,/verify-puzzle-components\.mjs "\$RUNNER_TEMP\/target\.connection" generated\/v6-candidate\/v6-traditional staged/);
  // First activation still requires every component to be an unpublished Candidate.
  const activate=workflow.slice(workflow.indexOf('Reverify staged bytes and preservation immediately before activation'),workflow.indexOf('Atomically activate all v10 parent snapshots'));
  assert.match(activate,/v6-traditional Candidate/);
});
