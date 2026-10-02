import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow=fs.readFileSync(new URL('../.github/workflows/release-v5-corpus.yml',import.meta.url),'utf8');

test('v5 stage loads the exact rebuilt baseline before Premier additions',()=>{
  const capture=workflow.indexOf('v5-release-state.mjs "$RUNNER_TEMP/target.connection" capture');
  const baseline=workflow.indexOf('load_verified_draft_run.mjs "$RUNNER_TEMP/target.connection" --stage-only');
  const supplements=workflow.indexOf('load_all_trophies.mjs "$RUNNER_TEMP/target.connection" generated/v5-candidate/v5-trophy-import --stage-only');
  const preserve=workflow.indexOf('v5-release-state.mjs "$RUNNER_TEMP/target.connection" verify');
  assert.ok(capture>=0&&baseline>capture&&supplements>baseline&&preserve>supplements,
    'stage must capture v8, load v9 baseline, apply exact Premier additions, then prove serving/history preservation');
});

test('v5 stage stays non-serving until the explicit activation action',()=>{
  const stage=workflow.slice(workflow.indexOf('Stage immutable v9 candidate without switching serving'),workflow.indexOf('Require exact bridge revision before pointer mutation'));
  assert.match(stage,/load_verified_draft_run\.mjs .* --stage-only/);
  assert.match(stage,/load_all_trophies\.mjs .* --stage-only/);
  assert.doesNotMatch(stage,/v5-corpus-cutover\.mjs .* activate/);
});
