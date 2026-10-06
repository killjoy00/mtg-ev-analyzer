import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyChangedPaths,detectPublicationChange} from '../scripts/ci-change-scope.mjs';

const creatorPublished={
  id:'11111111-1111-4111-8111-111111111111',slug:'lola-rft',status:'published',
  creator_name:'Lola',headline:'Can you beat Lola?',score:87,environment:'latest',
  source_type:'daily',source_day:'2026-10-08',source:'creator',campaign:'beat-the-creator',medium:'creator',
};
const creatorRetired={id:creatorPublished.id,slug:creatorPublished.slug,status:'retired'};
const campaign={slug:'newsletter-launch',destination:'/',source:'newsletter',campaign:'launch-week',medium:'email'};

function publication(paths,options) {
  const head=new Set(options.head||paths);
  const base=new Set(options.base||[]);
  return detectPublicationChange(paths,{
    campaignBefore:options.campaignBefore??[],
    campaignAfter:options.campaignAfter??[],
    creatorBefore:options.creatorBefore??[],
    creatorAfter:options.creatorAfter??[],
    headHas:file=>head.has(file),
    baseHas:file=>base.has(file),
  });
}

test('creator publication requires the exact registry, route, and card diff',()=>{
  const paths=['creator-challenges.json','creator/lola-rft/index.html','creator/lola-rft/creator-card.png'];
  const pub=publication(paths,{creatorAfter:[creatorPublished]});
  assert.deepEqual({kind:pub.kind,slug:pub.slug,action:pub.action},{kind:'creator',slug:'lola-rft',action:'publish'});
  assert.equal(classifyChangedPaths(paths,{publication:pub}).profile,'publication');

  assert.equal(publication([...paths,'worker/index.js'],{creatorAfter:[creatorPublished]}),null);
  assert.equal(publication(paths,{creatorAfter:[creatorPublished],head:['creator-challenges.json','creator/lola-rft/index.html']}),null);
});

test('creator retirement and privacy tombstone stay publication-only only when the personalized card is gone',()=>{
  const paths=['creator-challenges.json','creator/lola-rft/index.html','creator/lola-rft/creator-card.png'];
  const retired=publication(paths,{
    creatorBefore:[creatorPublished],creatorAfter:[creatorRetired],
    base:['creator/lola-rft/index.html','creator/lola-rft/creator-card.png'],
    head:['creator/lola-rft/index.html'],
  });
  assert.equal(retired.action,'retire');
  assert.equal(classifyChangedPaths(paths,{publication:retired}).profile,'publication');

  const privacyPaths=['creator-challenges.json','creator/lola-rft/index.html'];
  const privacy=publication(privacyPaths,{
    creatorBefore:[],creatorAfter:[creatorRetired],head:['creator/lola-rft/index.html'],
  });
  assert.equal(privacy.action,'retire');

  const staleCard=publication(privacyPaths,{
    creatorBefore:[],creatorAfter:[creatorRetired],head:['creator/lola-rft/index.html','creator/lola-rft/creator-card.png'],
  });
  assert.equal(staleCard,null);
});

test('ordinary campaign publication and removal require one immutable registry delta',()=>{
  const publishPaths=['campaign-links.json','go/newsletter-launch/index.html'];
  const pub=publication(publishPaths,{campaignAfter:[campaign],head:['go/newsletter-launch/index.html']});
  assert.deepEqual({kind:pub.kind,action:pub.action},{kind:'campaign',action:'publish'});

  const retire=publication(publishPaths,{campaignBefore:[campaign],campaignAfter:[],head:[]});
  assert.equal(retire.action,'retire');

  assert.equal(publication(publishPaths,{
    campaignBefore:[campaign],campaignAfter:[{...campaign,source:'reddit'}],head:['go/newsletter-launch/index.html'],
  }),null,'changing attribution is not generated publication');
});

test('documentation, mobile, workflow helpers, static presentation, and application code select proportional checks',()=>{
  assert.equal(classifyChangedPaths(['docs/CI-AND-MERGING.md']).profile,'docs');
  assert.equal(classifyChangedPaths(['mobile/src/app.tsx','docs/mobile-release.md']).profile,'mobile');
  assert.equal(classifyChangedPaths(['.github/workflows/cloudflare-audit.yml']).profile,'ci');
  assert.equal(classifyChangedPaths(['about/index.html','editorial.css']).profile,'static');
  assert.equal(classifyChangedPaths(['draft-run-product.mjs']).profile,'standard');
  assert.equal(classifyChangedPaths(['worker/creator-challenges.mjs']).profile,'standard');
});

test('model, replay, scoring, and data changes retain hydrated heavy validation',()=>{
  for(const paths of [
    ['data/msh/catalog.json'],
    ['corpus/draft-run/catalog.json'],
    ['path-model.mjs'],
    ['scoring.mjs'],
    ['scripts/build_replays.py'],
    ['tests/scoring-distribution.test.mjs'],
  ]) {
    const scope=classifyChangedPaths(paths);
    assert.equal(scope.profile,'heavy',paths.join(','));
    assert.equal(scope.hydrate_replays,true);
    assert.equal(scope.audit_datasets,true);
    assert.equal(scope.browser_mode,'full');
  }
});

test('CI selection infrastructure, dependency changes, empty diffs, and unknown paths fail closed',()=>{
  for(const paths of [
    ['.github/workflows/test.yml'],
    ['scripts/ci-change-scope.mjs'],
    ['tests/ci-change-scope.test.mjs'],
    ['package.json'],
    [],
    ['mystery.bin'],
  ]) {
    const scope=classifyChangedPaths(paths);
    assert.equal(scope.profile,'broad',paths.join(','));
    assert.equal(scope.hydrate_replays,true);
    assert.equal(scope.browser_mode,'full');
  }
});

test('mixed diffs receive a conservative union instead of a publication shortcut',()=>{
  const paths=['creator-challenges.json','creator/lola-rft/index.html','creator/lola-rft/creator-card.png','README.md'];
  const pub=publication(paths,{creatorAfter:[creatorPublished]});
  assert.equal(pub,null,'extra files disqualify the publication fast path');
  assert.equal(classifyChangedPaths(paths).profile,'standard');

  assert.equal(classifyChangedPaths(['docs/guide.md','about/index.html']).profile,'static');
  assert.equal(classifyChangedPaths(['.github/workflows/cloudflare-audit.yml','about/index.html']).profile,'standard');
});
