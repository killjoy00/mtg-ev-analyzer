import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assertHistoryPreserved} from '../scripts/v5-release-state.mjs';

const workflow=fs.readFileSync(new URL('../.github/workflows/release-v5-corpus.yml',import.meta.url),'utf8');
const deployWorkflow=fs.readFileSync(new URL('../.github/workflows/deploy-functions.yml',import.meta.url),'utf8');
const candidateVerifier=fs.readFileSync(new URL('../scripts/verify-v5-release-candidate.mjs',import.meta.url),'utf8');

test('v5 stage loads the exact rebuilt baseline before Premier additions',()=>{
  const capture=workflow.indexOf('v5-release-state.mjs "$RUNNER_TEMP/target.connection" capture');
  const baseline=workflow.indexOf('load_verified_draft_run.mjs "$RUNNER_TEMP/target.connection" --stage-only');
  const supplements=workflow.indexOf('load_all_trophies.mjs "$RUNNER_TEMP/target.connection" generated/v5-candidate/v5-trophy-import --stage-only');
  const preserve=workflow.indexOf('v5-release-state.mjs "$RUNNER_TEMP/target.connection" verify');
  assert.ok(capture>=0&&baseline>capture&&supplements>baseline&&preserve>supplements,
    'stage must capture v8, load v9 baseline, apply exact Premier additions, then prove serving/history preservation');
});

test('v5 readiness records the exact reviewed release commit',()=>{
  assert.match(workflow,/PACK1_RELEASE_COMMIT:\s*\$\{\{ inputs\.release_commit \}\}/);
});

test('rollback emits successor stage evidence only after proving restored pointers and history',()=>{
  const rollback=workflow.slice(workflow.indexOf('Roll back to captured v8 pointers after bridge redeploy'));
  const restored=rollback.indexOf('capture generated/v5-candidate generated/v5-rollback-restored.json');
  const compare=rollback.indexOf('assert.deepEqual(restored[key],before[key]');
  const history=rollback.indexOf('assertHistoryPreserved(before.history,restored.history)');
  const successor=rollback.indexOf("fs.copyFileSync('generated/v5-rollback-restored.json'");
  assert.ok(restored>=0&&compare>restored&&history>compare&&successor>history);
  assert.match(rollback,/BigInt\(restored\.serving_revision\)>BigInt\(before\.serving_revision\)/);
  assert.match(rollback,/preceding_stage_run_id:process\.env\.STAGE_RUN_ID/);
  assert.match(rollback,/inputs\.action == 'stage' \|\| inputs\.action == 'rollback'/);
});

test('rollback evidence rejects changed history, pointers and stale revisions before writing a successor',()=>{
  const rollback=workflow.slice(workflow.indexOf('Roll back to captured v8 pointers after bridge redeploy'));
  const block=rollback.match(/node --input-type=module - <<'NODE'\n([\s\S]*?)\n          NODE/)[1];
  const execute=new Function('fs','assert','assertHistoryPreserved','process',block.replace(/^\s*import .*;$/gm,''));
  const before={sets:['hob'],environment:[{set_id:'hob',active_snapshot_id:'v8'}],
    v8_manifest_hash:'same',serving_revision:'12',history:{scores:[{fingerprint:'score',n:1}]}};
  function run(restored) {
    const writes=[];
    const memory={readFileSync:p=>JSON.stringify(p.endsWith('v5-release-baseline.json')?before:restored),
      copyFileSync:(...args)=>writes.push(args),writeFileSync:(...args)=>writes.push(args)};
    let error;
    try { execute(memory,assert,assertHistoryPreserved,{env:{TARGET:'development',CANDIDATE_RUN_ID:'10000',RELEASE_COMMIT:'release',GITHUB_RUN_ID:'20000',STAGE_RUN_ID:'15000'}}); }
    catch(e){error=e;}
    return {writes,error};
  }
  const restored={...before,serving_revision:'20'};
  const accepted=run(restored);
  assert.equal(accepted.error,undefined);
  assert.equal(accepted.writes.length,2);
  assert.equal(JSON.parse(accepted.writes[1][1]).preceding_stage_run_id,'15000');
  for(const change of [{serving_revision:'12'},{serving_revision:'bad'},{environment:[]},{v8_manifest_hash:'changed'},{history:{}}]) {
    const rejected=run({...restored,...change});
    assert.ok(rejected.error);
    assert.deepEqual(rejected.writes,[]);
  }
});

test('v5 stage stays non-serving until the explicit activation action',()=>{
  const stage=workflow.slice(workflow.indexOf('Stage immutable v9 candidate without switching serving'),workflow.indexOf('Require exact bridge revision before pointer mutation'));
  assert.match(stage,/load_verified_draft_run\.mjs .* --stage-only/);
  assert.match(stage,/load_all_trophies\.mjs .* --stage-only/);
  assert.doesNotMatch(stage,/v5-corpus-cutover\.mjs .* activate/);
});


test('v5 production promotion rechecks development Practice before upload',()=>{
  const gate=deployWorkflow.indexOf('Require the same revision tested in development before production');
  const acceptance=deployWorkflow.indexOf('v5-live-practice-acceptance.mjs br-twilight-hill-ayffyd2b');
  const upload=deployWorkflow.indexOf('Deploy the checked bundles without rebuilding');
  assert.ok(gate>=0&&acceptance>gate&&upload>acceptance,
    'production must re-accept the exact v5 commit in development before any function upload');
});

test('v5 target Practice acceptance runs after exact-revision Daily smoke',()=>{
  const daily=deployWorkflow.indexOf('Verify revision, coverage and complete all three unranked Daily flows');
  const practice=deployWorkflow.indexOf('Verify live v5 account-linked Practice flows');
  assert.ok(daily>=0&&practice>daily);
  assert.match(deployWorkflow,/v5-live-practice-acceptance\.mjs "\$TARGET_BRANCH" "\$RELEASE_COMMIT" "\$RUNNER_TEMP\/target\.connection"/);
});


test('v5 candidate release fails closed on uncapped accounting and source refresh drift',()=>{
  assert.match(candidateVerifier,/training_mode!=='all-qualified'/);
  assert.match(candidateVerifier,/training_cap!==null/);
  assert.match(candidateVerifier,/training_drafts\)!==Number\(s\.qualified_training_drafts/);
  assert.match(candidateVerifier,/total_trained\)!==Number\(accounting\.total_qualified/);
  assert.match(candidateVerifier,/holdout!=='5-fold by draft_id'/);
  assert.match(candidateVerifier,/same\(refreshed,\['hob'\]\)/);
  assert.match(candidateVerifier,/mixed_identities!==false/);
  assert.match(candidateVerifier,/invalid_numerical_outputs/);
});


test('v5 activation requires the bounded bridge revision contract',()=>{
  assert.match(workflow,/modelVersions\.v4\.corpus_version/);
  assert.match(workflow,/modelVersions\.v5\.corpus_version/);
  assert.match(workflow,/next_snapshot\.corpus_version=/);
  assert.doesNotMatch(workflow,/next_snapshot\.corpus_version<>p\.corpus_version/);
});

test('v5 recovery runs full acceptance and records separate environment and finalizer provenance',()=>{
 const rebuild=fs.readFileSync('.github/workflows/rebuild-v5-draft-run-corpus.yml','utf8');
 assert.match(rebuild,/if: inputs\.reuse_run_id == ''/);
 assert.match(rebuild,/verify-v5-rebuild-reuse\.mjs/);
 const assemble=rebuild.indexOf('python scripts/v5_rebuild.py assemble');
 const admission=rebuild.indexOf('node scripts/v5-cube-reroll-admission.mjs');
 const validation=rebuild.indexOf('Validate corpus accounting, source trajectories, models and Traditional gates');
 const upload=rebuild.indexOf('name: validated-v5-candidate-');
 assert.ok(assemble>=0&&admission>assemble&&validation>admission&&upload>validation);
 assert.match(rebuild.slice(validation,upload),/npm test/);
 assert.match(rebuild,/environment_commit/);assert.match(rebuild,/cube_admission_sha256/);
 const replay=rebuild.slice(rebuild.indexOf('Verify every new replay byte against versioned R2'),rebuild.indexOf('Preserve exact validated artifacts and reviewed QA'));
 assert.match(replay,/REPLAY_MODEL_VERSION=strong-player-colour-stage-v5/);
 assert.match(replay,/REPLAY_SETS=.*data\/catalog\.json/);
 assert.doesNotMatch(replay,/Path\('data'\)\.glob/,'retired historical manifests are not active v5 replay inputs');
 assert.match(candidateVerifier,/verifyCubeSessionRerolls/);
 assert.match(candidateVerifier,/Candidate environment provenance differs/);
});
