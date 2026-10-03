import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

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
