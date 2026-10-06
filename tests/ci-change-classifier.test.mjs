import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyChanges} from '../scripts/ci-change-classifier.mjs';

const plan=(paths,expected)=>assert.equal(classifyChanges(paths).plan,expected,paths.join(', '));

test('creator and ordinary campaign generated diffs take the publication fast path',()=>{
  let result=classifyChanges(['creator-challenges.json','creator/lola/index.html','creator/lola/creator-card.png']);
  assert.equal(result.plan,'publication');assert.deepEqual(result.publication,{kind:'creator',slug:'lola'});assert.equal(result.hydrate,false);
  result=classifyChanges(['creator-challenges.json','creator/lola/index.html']);
  assert.equal(result.plan,'publication','creator retirement without a card stays publication-only');
  result=classifyChanges(['campaign-links.json','go/newsletter/index.html']);
  assert.equal(result.plan,'publication');assert.deepEqual(result.publication,{kind:'campaign',slug:'newsletter'});
});

test('branch names are irrelevant and mixed publication-like changes lose the fast path',()=>{
  plan(['creator-challenges.json','creator/lola/index.html','worker/index.js'],'full');
  plan(['campaign-links.json','go/newsletter/index.html','README.md'],'full');
  plan(['creator/lola/index.html'],'full');
});

test('documentation, static presentation, mobile, workflow, model/data, shared code and mixed diffs are proportional',()=>{
  plan(['docs/CI-AND-MERGING.md'],'docs');
  plan(['about/index.html','editorial.css'],'presentation');
  plan(['.well-known/apple-app-site-association','_config.yml'],'presentation');
  plan(['mobile/app/index.tsx','docs/mobile-release.md'],'mobile');
  plan(['.github/workflows/cloudflare-audit.yml'],'ci');
  plan(['scoring.mjs'],'heavy');
  plan(['data/msh/catalog.json'],'heavy');
  plan(['worker/core.mjs'],'app');
  assert.deepEqual(classifyChanges(['practice-page.mjs']).browserGroups,['practice']);
  assert.deepEqual(classifyChanges(['profile-product.mjs','progression.mjs']).browserGroups,['profile']);
  assert.deepEqual(classifyChanges(['draft-run-product.mjs','gameplay.mjs']).browserGroups,['draft_run']);
  plan(['README.md','worker/core.mjs'],'app');
  const appWorkflow=classifyChanges(['practice-page.mjs','.github/workflows/cloudflare-audit.yml']);
  assert.equal(appWorkflow.plan,'app');assert.equal(appWorkflow.ciContracts,true);assert.deepEqual(appWorkflow.browserGroups,['practice']);
  const appPresentation=classifyChanges(['profile-product.mjs','editorial.css']);
  assert.equal(appPresentation.plan,'app');assert.equal(appPresentation.browser,'full');
  const presentationWorkflow=classifyChanges(['editorial.css','.github/workflows/cloudflare-audit.yml']);
  assert.equal(presentationWorkflow.plan,'presentation');assert.equal(presentationWorkflow.ciContracts,true);
  plan(['docs/guide.md','mobile/app/index.tsx'],'mobile');
});

test('selection, execution infrastructure and dependencies fail to broad validation',()=>{
  for(const paths of [['.github/workflows/test.yml'],['.github/workflows/e2e.yml'],['.github/workflows/backend-gate.yml'],['scripts/backend-gate-scope.mjs'],['scripts/ci-change-classifier.mjs'],['scripts/check-creator-social-card.py'],['scripts/run-js-tests.mjs'],['scripts/hydrate-replay-shards.sh'],['package.json'],[]])plan(paths,'full');
});

test('unknown paths fail closed to broad validation',()=>{plan(['future/new-surface.xyz'],'full');});

test('worker model, selection, corpus and import paths require heavy validation',()=>{
  for(const path of ['worker/path-model.mjs','worker/draft-run-selection.mjs','worker/corpus-components.mjs',
    'worker/corpus-admin.mjs','worker/corpus-readiness.mjs','worker/trophy-import.mjs']){
    const result=classifyChanges([path]);
    assert.equal(result.plan,'heavy',path);assert.equal(result.hydrate,true,path);
    assert.equal(result.dataset,true,path);assert.equal(result.browser,'full',path);
  }
  const mixed=classifyChanges(['worker/path-model.mjs','.github/workflows/cloudflare-audit.yml']);
  assert.equal(mixed.plan,'heavy');assert.equal(mixed.ciContracts,true);
  assert.equal(classifyChanges(['worker/account-session.mjs']).hydrate,false,'ordinary account changes stay lightweight');
});
